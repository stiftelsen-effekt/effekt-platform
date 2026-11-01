import { describe, it } from "vitest";
import { expect } from "chai";
import express from "express";
import apicache from "apicache";
import request from "supertest";
import errorHandler from "../handlers/errorHandler";
import { mountTrpc } from "../trpc/express";
import { defaultEmptyBody, skipForTrpc } from "../trpc/reportsMultipart";

/**
 * Behaviour that Express 5 changed and that server.ts relies on: route syntax (path-to-regexp 8),
 * req.body defaults, status codes, trust proxy and the query parser.
 */
describe("Express 5 behaviour the API relies on", () => {
  it("answers CORS preflights for any /trpc path (named wildcard)", async () => {
    const app = express();
    mountTrpc(app);
    await request(app).options("/trpc/site.impactCosts").expect(204);
    await request(app).options("/trpc/minside.profile,minside.donations").expect(204);
  });

  it("still serves tRPC calls through the Express adapter", async () => {
    const app = express();
    app.use(express.json());
    mountTrpc(app);
    const res = await request(app).get("/trpc/no.such.procedure").expect(404);
    expect(res.body.error.data.code).to.equal("NOT_FOUND");
  });

  it("matches a route defined with a trailing slash with or without it", async () => {
    const app = express();
    const router = express.Router();
    // Defined with a trailing slash, like /avtalegiro/missing/ and /donors/list/
    router.get("/missing/", (_req, res) => res.json({ ok: true }));
    app.use("/avtalegiro", router);
    await request(app).get("/avtalegiro/missing").expect(200);
    await request(app).get("/avtalegiro/missing/").expect(200);
  });

  describe("req.body", () => {
    const app = () => {
      const app = express();
      app.use(express.json());
      app.use(skipForTrpc(defaultEmptyBody));
      app.get("/rest", (req, res) => res.json({ body: req.body }));
      app.post("/rest", (req, res) => res.json({ body: req.body }));
      app.post("/form", express.urlencoded({ extended: false }), (req, res) =>
        res.json({ body: req.body }),
      );
      app.post("/trpc/x", (req, res) =>
        res.json({ hasBody: "body" in req, body: req.body ?? null }),
      );
      return app;
    };

    it("is {} on REST requests without a parsed body, as in Express 4", async () => {
      expect((await request(app()).get("/rest")).body).to.deep.equal({ body: {} });
      expect((await request(app()).post("/rest")).body).to.deep.equal({ body: {} });
    });

    it("is the parsed JSON body", async () => {
      const res = await request(app()).post("/rest").send({ a: 1 });
      expect(res.body).to.deep.equal({ body: { a: 1 } });
    });

    it("is parsed by a route's urlencoded parser after the default", async () => {
      const res = await request(app()).post("/form").type("form").send("a=1&b=two");
      expect(res.body).to.deep.equal({ body: { a: "1", b: "two" } });
    });

    it("is left unset for /trpc so tRPC reads the stream", async () => {
      const res = await request(app()).post("/trpc/x").type("text").send("raw");
      expect(res.body).to.deep.equal({ hasBody: true, body: null });
    });
  });

  describe("error handler", () => {
    const app = (status: unknown) => {
      const app = express();
      app.get("/boom", async () => {
        const err: any = new Error("boom");
        err.status = status;
        throw err;
      });
      app.use(errorHandler);
      return app;
    };

    it("keeps a valid status from the error", async () => {
      await request(app(404)).get("/boom").expect(404);
    });

    it("answers 500 instead of throwing when the status is not a valid code", async () => {
      await request(app("not a status")).get("/boom").expect(500);
      await request(app(1000)).get("/boom").expect(500);
      await request(app(undefined)).get("/boom").expect(500);
    });
  });

  it("takes the client IP behind the load balancer and GFE (trust proxy 2)", async () => {
    const app = express();
    app.set("trust proxy", 2);
    app.get("/ip", (req, res) => res.json({ ip: req.ip }));
    // A client-supplied (spoofed) entry, the real client as the LB saw it, the LB as the GFE saw it
    const res = await request(app)
      .get("/ip")
      .set("X-Forwarded-For", "203.0.113.9, 198.51.100.7, 35.191.0.1");
    expect(res.body.ip).to.equal("198.51.100.7");
  });

  it("parses query strings flat (no nested objects), repeated keys as arrays", async () => {
    const app = express();
    app.get("/q", (req, res) => res.json(req.query));
    const res = await request(app).get("/q?a[b]=c&x=1&x=2&pretty");
    expect(res.body).to.deep.equal({ "a[b]": "c", x: ["1", "2"], pretty: "" });
  });

  it("caches responses with apicache", async () => {
    const app = express();
    let calls = 0;
    app.get("/cached", apicache.middleware("5 minutes"), (_req, res) => {
      calls++;
      res.json({ calls });
    });
    const first = await request(app).get("/cached").expect(200);
    const second = await request(app).get("/cached").expect(200);
    expect(second.body).to.deep.equal(first.body);
    expect(calls).to.equal(1);
    apicache.clear();
  });
});
