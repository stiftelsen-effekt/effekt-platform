import { describe, it } from "vitest";
import { expect } from "chai";
import express from "express";
import request from "supertest";
import { corsHeaders } from "../middleware/cors";
import { mountTrpc } from "../trpc/express";

const appWith = (env: string, allowedProductionOrigins: string[] = []) => {
  const app = express();
  app.use(corsHeaders({ env, allowedProductionOrigins }));
  mountTrpc(app);
  app.get("/donors/1", (_req, res) => res.json({ ok: true }));
  return app;
};

describe("CORS headers", () => {
  const prod = () => appWith("production", ["https://gieffektivt.no"]);

  it("lets browsers cache preflights for two hours", async () => {
    const res = await request(prod())
      .options("/trpc/minside.profile,minside.donations")
      .set("Origin", "https://gieffektivt.no")
      .expect(204);
    expect(res.headers["access-control-max-age"]).to.equal("7200");
    expect(res.headers["access-control-allow-origin"]).to.equal("https://gieffektivt.no");
    expect(res.headers["access-control-allow-headers"]).to.equal(
      "Content-Type, Authorization, baggage, sentry-trace, trpc-accept",
    );
    expect(res.headers["access-control-allow-methods"]).to.equal(
      "GET,PUT,POST,DELETE,PATCH,OPTIONS",
    );
  });

  it("allows the listed origins and the website's Vercel previews in production", async () => {
    for (const origin of [
      "https://gieffektivt.no",
      "https://main-site-abc123-effective-altruism-norway.vercel.app",
    ]) {
      const res = await request(prod()).get("/donors/1").set("Origin", origin).expect(200);
      expect(res.headers["access-control-allow-origin"]).to.equal(origin);
      expect(res.headers["vary"]).to.match(/Origin/);
    }
  });

  it("gives other origins no Access-Control-Allow-Origin in production", async () => {
    for (const origin of [
      "https://evil.example",
      "https://gieffektivt.no.evil.example",
      "https://main-site-x-effective-altruism-norway.vercel.app.evil.example",
    ]) {
      const res = await request(prod()).get("/donors/1").set("Origin", origin).expect(200);
      expect(res.headers["access-control-allow-origin"]).to.equal(undefined);
    }
    const noOrigin = await request(prod()).get("/donors/1").expect(200);
    expect(noOrigin.headers["access-control-allow-origin"]).to.equal(undefined);
  });

  it("answers any origin for the public cached reads in production", async () => {
    const res = await request(prod())
      .options("/trpc/site.impactCosts")
      .set("Origin", "https://giveffektivt.dk")
      .expect(204);
    expect(res.headers["access-control-allow-origin"]).to.equal("*");
    expect(res.headers["access-control-max-age"]).to.equal("7200");
  });

  it("allows every origin outside production", async () => {
    const res = await request(appWith("development"))
      .get("/donors/1")
      .set("Origin", "http://localhost:3000")
      .expect(200);
    expect(res.headers["access-control-allow-origin"]).to.equal("*");
  });
});
