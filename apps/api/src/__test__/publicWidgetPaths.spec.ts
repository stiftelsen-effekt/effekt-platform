import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import crypto from "crypto";
import express from "express";
import request from "supertest";
import { DAO } from "../custom_modules/DAO";
import * as mail from "../custom_modules/mail";
import {
  createRegistrationToken,
  registrationFor,
  REGISTRATION_TOKEN_TTL_MS,
  verifyRegistrationToken,
} from "../custom_modules/registrationToken";
import { createPublicMutationLimiter } from "../middleware/publicMutationRateLimit";
import { mountTrpc } from "../trpc/express";
import methods from "../enums/methods";

const config = require("../config");
const vipps = require("../custom_modules/vipps");

/** An app like server.ts: JSON bodies with the raw body kept for webhook signatures */
const appWith = (path: string, router: express.Router) => {
  const app = express();
  app.use(
    express.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString();
      },
    }),
  );
  app.use(path, router);
  app.use((err, req, res, _next) => res.status(err.status ?? 500).end());
  return app;
};

describe("public widget paths", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("registration tokens", () => {
    const claims = { kid: "12345678", method: methods.AVTALEGIRO, donorId: 42, amount: 300 };

    it("round-trips its claims until it expires", () => {
      const now = Date.parse("2026-10-30T12:00:00Z");
      const token = createRegistrationToken(claims, now);
      expect(verifyRegistrationToken(token, now)).toStrictEqual({
        ...claims,
        exp: now + REGISTRATION_TOKEN_TTL_MS,
      });
      expect(verifyRegistrationToken(token, now + REGISTRATION_TOKEN_TTL_MS + 1)).toBe(null);
    });

    it("is only good for its KID and method", () => {
      const token = createRegistrationToken(claims);
      expect(registrationFor(token, "12345678", [methods.AVTALEGIRO])).not.toBe(null);
      expect(registrationFor(token, "12345679", [methods.AVTALEGIRO])).toBe(null);
      expect(registrationFor(token, "12345678", [methods.BANK, methods.VIPPS])).toBe(null);
    });

    it("refuses tokens not signed with the key", () => {
      const token = createRegistrationToken(claims);
      const [version, payload] = token.split(".");
      // nosemgrep: javascript.lang.security.audit.hardcoded-hmac-key.hardcoded-hmac-key -- a wrong key on purpose, to forge a signature the API must refuse
      const forged = crypto.createHmac("sha256", "guess").update(`${version}.${payload}`);
      for (const bad of [
        `${version}.${payload}.${forged.digest("base64url")}`,
        `${version}.${payload}.`,
        `v2.${payload}.${token.split(".")[2]}`,
        token + "x",
        "",
        null,
        { kid: "12345678" },
      ]) {
        expect(verifyRegistrationToken(bad)).toBe(null);
      }
    });

    it("uses WIDGET_REGISTRATION_TOKEN_SECRET when it is set", () => {
      const token = createRegistrationToken(claims);
      vi.spyOn(config, "widget_registration_token_secret", "get").mockReturnValue("another key");
      expect(verifyRegistrationToken(token)).toBe(null);
      expect(verifyRegistrationToken(createRegistrationToken(claims))).not.toBe(null);
    });
  });

  describe("GET /avtalegiro/:KID/redirect", () => {
    let app: express.Express;
    let send: MockInstance;
    let claim: MockInstance;

    beforeEach(() => {
      app = appWith("/avtalegiro", require("../routes/avtalegiro"));
      vi.spyOn(DAO.avtalegiroagreements, "getByKID").mockResolvedValue({
        id: 1,
        KID: "12345678",
        amount: 30000,
        paymentDate: 20,
        notice: true,
      });
      vi.spyOn(DAO.fundraisers, "getFundraiserTransactionByKID").mockResolvedValue(null);
      claim = vi
        .spyOn(DAO.avtalegiroagreements, "claimRegisteredMail")
        .mockReturnValue(undefined as any);
      claim.mockResolvedValueOnce(true);
      claim.mockResolvedValue(false);
      send = vi.spyOn(mail, "sendAvtalegiroRegistered").mockResolvedValue(undefined as any);
    });

    it("sends the registered email the first time only", async () => {
      for (let i = 0; i < 3; i++) {
        const res = await request(app).get("/avtalegiro/12345678/redirect?status=OK").expect(302);
        expect(res.headers.location).toMatch(/^https:\/\/gieffektivt\.no\/opprettet\?plausible=/);
      }
      expect(send).toHaveBeenCalledOnce();
      expect(claim).toHaveBeenCalled();
      expect(claim.mock.calls.every(([kid]) => kid === "12345678")).toBe(true);
    });

    it("sends nothing for a KID without an agreement", async () => {
      vi.mocked(DAO.avtalegiroagreements.getByKID).mockResolvedValue(null);
      const res = await request(app).get("/avtalegiro/999/redirect?status=OK").expect(302);
      expect(res.headers.location).toBe("https://gieffektivt.no/avtale-feilet");
      expect(claim).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe("POST /mail/mailersend/security/sanitynotification", () => {
    const secret = "sanity-test-secret";
    let app: express.Express;
    let send: MockInstance;
    const body = {
      document: "bank",
      sanityUser: "p-user",
      fields: [
        { name: "kontonr", prev: "1234.56.78903", new: "9876.54.32101" },
        { name: "account_number", prev: null, new: null },
      ],
    };

    const sign = (raw: string, timestamp = Date.now(), key = secret) =>
      `t=${timestamp},v1=${crypto
        .createHmac("sha256", key)
        .update(`${timestamp}.${raw}`)
        .digest("base64url")}`;

    beforeEach(() => {
      vi.spyOn(config, "sanity_security_webhook_secret", "get").mockReturnValue(secret);
      app = appWith("/mail", require("../routes/mail"));
      send = vi.spyOn(mail, "sendSanitySecurityNotice").mockResolvedValue(true as any);
    });

    const post = (signature?: string, payload: unknown = body) => {
      const raw = JSON.stringify(payload);
      const req = request(app)
        .post("/mail/mailersend/security/sanitynotification")
        .set("Content-Type", "application/json");
      if (signature !== undefined) req.set("sanity-webhook-signature", signature);
      return req.send(raw);
    };

    it("sends the notice for a signed webhook, with only the changed fields", async () => {
      await post(sign(JSON.stringify(body))).expect(200);
      expect(send).toHaveBeenCalledOnce();
      expect(send.mock.calls[0][0]).toStrictEqual({
        document: "bank",
        sanityUser: "p-user",
        fields: [{ name: "kontonr", prev: "1234.56.78903", new: "9876.54.32101" }],
      });
    });

    for (const [what, signature] of [
      ["no signature", undefined],
      ["a signature with another key", sign(JSON.stringify(body), Date.now(), "wrong")],
      ["a signature of another body", sign(JSON.stringify({ ...body, document: "x" }))],
      ["an old signature", sign(JSON.stringify(body), Date.now() - 10 * 60 * 1000)],
      ["a malformed signature", "v1=abc"],
    ] as Array<[string, string | undefined]>) {
      it(`refuses ${what}`, async () => {
        await post(signature).expect(401);
        expect(send).not.toHaveBeenCalled();
      });
    }

    it("refuses everything when the secret is not configured", async () => {
      vi.spyOn(config, "sanity_security_webhook_secret", "get").mockReturnValue(undefined);
      await post(sign(JSON.stringify(body))).expect(401);
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe("Vipps REST routes", () => {
    let app: express.Express;

    beforeEach(() => {
      app = appWith("/vipps", require("../routes/vipps"));
    });

    it("need an admin token for the Vipps API passthrough routes", async () => {
      const getAgreements = vi.spyOn(vipps, "getAgreements").mockResolvedValue([]);
      const createCharge = vi.spyOn(vipps, "createCharge").mockResolvedValue({});
      const refundOrder = vi.spyOn(vipps, "refundOrder").mockResolvedValue(true);
      await request(app).get("/vipps/agreement/agr_1").expect(401);
      await request(app)
        .post("/vipps/agreement/charge/create")
        .send({ agreementId: "agr_1", amount: 1 })
        .expect(401);
      await request(app).post("/vipps/refund/order-1").expect(401);
      expect(
        getAgreements.mock.calls.length > 0 ||
          createCharge.mock.calls.length > 0 ||
          refundOrder.mock.calls.length > 0,
      ).toBe(false);
    });

    it("no longer take problem reports", async () => {
      const report = vi.spyOn(mail, "sendVippsProblemReport").mockResolvedValue(true);
      await request(app)
        .post("/vipps/agreement/report/problem")
        .send({ email: "a@b.no", donorMessage: "x" })
        .expect(404);
      expect(report).not.toHaveBeenCalled();
    });
  });

  describe("public mutation rate limit", () => {
    it("limits the widget's tRPC mutations per IP, with a tRPC error", async () => {
      const app = express();
      mountTrpc(app, { publicMutationLimiter: createPublicMutationLimiter(2) });
      const send = vi.spyOn(mail, "sendDonationRegistered").mockResolvedValue(true);
      const input = { KID: "12345", sum: 100, registrationToken: "x" };

      await request(app).post("/trpc/widget.registerBankPending").send(input).expect(400);
      await request(app).post("/trpc/widget.registerBankPending").send(input).expect(400);
      const res = await request(app)
        .post("/trpc/widget.registerBankPending")
        .send(input)
        .expect(429);
      expect(res.body.error.data).toStrictEqual({ code: "TOO_MANY_REQUESTS", httpStatus: 429 });
      expect(send).not.toHaveBeenCalled();
    });

    it("doesn't count the widget's queries", async () => {
      const app = express();
      mountTrpc(app, { publicMutationLimiter: createPublicMutationLimiter(1) });
      vi.spyOn(DAO.referrals, "getTypes").mockResolvedValue([]);
      for (let i = 0; i < 3; i++) {
        await request(app).get("/trpc/widget.referralTypes").expect(200);
      }
    });
  });
});
