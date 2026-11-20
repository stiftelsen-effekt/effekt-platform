import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import crypto from "crypto";
import express from "express";
import request from "supertest";
import { DAO } from "../custom_modules/DAO";
import * as mail from "../custom_modules/mail";

const config = require("../config");

function buildServer(mountPath: string, routerPath: string) {
  const app = express();
  app.use(
    express.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString();
      },
    }),
  );
  delete require.cache[require.resolve(routerPath)];
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-require.detect-non-literal-require -- router modules are a fixed list in this spec
  const mod = require(routerPath);
  app.use(mountPath, mod.default || mod);
  return app;
}

describe("webhook authentication", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("POST /logging/auth0", () => {
    let sendStub: MockInstance;
    let app: express.Express;
    const body = {
      logs: [{ data: { type: "fcpr", details: { body: { email: "victim@example.test" } } } }],
    };

    beforeEach(() => {
      sendStub = vi.spyOn(mail, "sendPasswordResetNoUserEmail").mockResolvedValue(undefined);
      app = buildServer("/logging", "../routes/logging");
    });

    it("rejects requests when the token is not configured", async () => {
      vi.spyOn(config, "auth0_log_stream_token", "get").mockReturnValue(undefined);
      await request(app)
        .post("/logging/auth0")
        .set("Authorization", "anything")
        .send(body)
        .expect(401);
      expect(sendStub).not.toHaveBeenCalled();
    });

    it("rejects requests without the correct token", async () => {
      vi.spyOn(config, "auth0_log_stream_token", "get").mockReturnValue("s3cret");
      await request(app).post("/logging/auth0").send(body).expect(401);
      await request(app)
        .post("/logging/auth0")
        .set("Authorization", "Bearer wrong")
        .send(body)
        .expect(401);
      expect(sendStub).not.toHaveBeenCalled();
    });

    it("accepts requests with the token, raw or as Bearer", async () => {
      vi.spyOn(config, "auth0_log_stream_token", "get").mockReturnValue("s3cret");
      await request(app)
        .post("/logging/auth0")
        .set("Authorization", "s3cret")
        .send(body)
        .expect(200);
      await request(app)
        .post("/logging/auth0")
        .set("Authorization", "Bearer s3cret")
        .send(body)
        .expect(200);
      expect(sendStub).toHaveBeenCalledTimes(2);
      expect(sendStub.mock.calls[0][0]).toBe("victim@example.test");
    });
  });

  describe("POST /donors/auth0/register", () => {
    let lookupStub: MockInstance;
    let addStub: MockInstance;
    let app: express.Express;
    const body = { email: "new@example.test" };

    beforeEach(() => {
      lookupStub = vi.spyOn(DAO.donors, "getIDbyEmail").mockResolvedValue(42);
      addStub = vi.spyOn(DAO.donors, "add").mockResolvedValue(43);
      app = buildServer("/donors", "../routes/donors");
    });

    it("allows requests when the token is not configured (Swedish API)", async () => {
      vi.spyOn(config, "auth0_register_token", "get").mockReturnValue(undefined);
      await request(app).post("/donors/auth0/register").send(body).expect(200);
      expect(lookupStub).toHaveBeenCalledOnce();
    });

    it("rejects requests without the correct token", async () => {
      vi.spyOn(config, "auth0_register_token", "get").mockReturnValue("s3cret");
      await request(app).post("/donors/auth0/register").send(body).expect(401);
      await request(app)
        .post("/donors/auth0/register")
        .set("Authorization", "Bearer wrong")
        .send(body)
        .expect(401);
      expect(lookupStub).not.toHaveBeenCalled();
      expect(addStub).not.toHaveBeenCalled();
    });

    it("returns the donor ID with the correct token", async () => {
      vi.spyOn(config, "auth0_register_token", "get").mockReturnValue("s3cret");
      const res = await request(app)
        .post("/donors/auth0/register")
        .set("Authorization", "Bearer s3cret")
        .send(body)
        .expect(200);
      expect(res.body.content).toBe(42);
      expect(addStub).not.toHaveBeenCalled();
    });
  });

  describe("POST /mail/mailersend/survey/response", () => {
    let saveStub: MockInstance;
    let app: express.Express;
    const payload = JSON.stringify({ data: { recipient: "x@example.test" } });

    beforeEach(() => {
      saveStub = vi
        .spyOn(DAO.mail, "saveMailerSendSurveyResponse")
        .mockResolvedValue(undefined as any);
      vi.spyOn(DAO.donors, "getIDbyEmail").mockResolvedValue(1);
      app = buildServer("/mail", "../routes/mail");
    });

    const sign = (secret: string, raw: string) =>
      crypto.createHmac("sha256", secret).update(raw).digest("hex");

    it("rejects unsigned requests", async () => {
      vi.spyOn(config, "mailersend_survey_webhook_secret", "get").mockReturnValue("whsec");
      await request(app)
        .post("/mail/mailersend/survey/response")
        .set("Content-Type", "application/json")
        .send(payload)
        .expect(401);
      expect(saveStub).not.toHaveBeenCalled();
    });

    it("rejects requests with a wrong signature", async () => {
      vi.spyOn(config, "mailersend_survey_webhook_secret", "get").mockReturnValue("whsec");
      await request(app)
        .post("/mail/mailersend/survey/response")
        .set("Content-Type", "application/json")
        .set("Signature", sign("other", payload))
        .send(payload)
        .expect(401);
    });

    it("rejects all requests when the secret is not configured", async () => {
      vi.spyOn(config, "mailersend_survey_webhook_secret", "get").mockReturnValue(undefined);
      await request(app)
        .post("/mail/mailersend/survey/response")
        .set("Content-Type", "application/json")
        .set("Signature", sign("", payload))
        .send(payload)
        .expect(401);
    });

    it("accepts correctly signed requests", async () => {
      vi.spyOn(config, "mailersend_survey_webhook_secret", "get").mockReturnValue("whsec");
      await request(app)
        .post("/mail/mailersend/survey/response")
        .set("Content-Type", "application/json")
        .set("Signature", sign("whsec", payload))
        .send(payload)
        .expect(200);
    });

    const answerPayload = (recipient: string) =>
      JSON.stringify({
        data: {
          recipient,
          meta: {
            surveys: [
              { survey_id: 4, question_id: 5, answers: [{ answer: "Fint", answer_id: "7" }] },
            ],
          },
        },
      });

    const postAnswer = (raw: string) =>
      request(app)
        .post("/mail/mailersend/survey/response")
        .set("Content-Type", "application/json")
        .set("Signature", sign("whsec", raw))
        .send(raw)
        .expect(200);

    it("skips recent duplicates for a known donor", async () => {
      vi.spyOn(config, "mailersend_survey_webhook_secret", "get").mockReturnValue("whsec");
      await postAnswer(answerPayload("x@example.test"));
      expect(saveStub).toHaveBeenCalledOnce();
      expect(saveStub.mock.calls[0][0]).to.include({ DonorID: 1, answer: "Fint" });
      expect(saveStub.mock.calls[0][1]).toStrictEqual({ skipRecentDuplicate: true });
    });

    it("keeps every answer that falls back to the anonymous donor", async () => {
      vi.spyOn(config, "mailersend_survey_webhook_secret", "get").mockReturnValue("whsec");
      vi.mocked(DAO.donors.getIDbyEmail).mockResolvedValue(null);
      await postAnswer(answerPayload("unknown@example.test"));
      expect(saveStub.mock.calls[0][0]).to.include({ DonorID: 1464 });
      expect(saveStub.mock.calls[0][1]).toStrictEqual({ skipRecentDuplicate: false });
    });

    it("still answers 200 when every answer was a duplicate", async () => {
      vi.spyOn(config, "mailersend_survey_webhook_secret", "get").mockReturnValue("whsec");
      saveStub.mockResolvedValue(false);
      const res = await postAnswer(answerPayload("x@example.test"));
      expect(res.body.content).toBe("OK");
    });
  });
});
