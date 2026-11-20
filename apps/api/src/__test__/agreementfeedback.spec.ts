import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import express from "express";
import request from "supertest";
import * as authMiddleware from "../custom_modules/authorization/authMiddleware";
import { DAO } from "../custom_modules/DAO";

describe("agreementfeedback routes", () => {
  let server: express.Express;
  let deleteStub: MockInstance;
  let addStub: MockInstance;
  let belongsStub: MockInstance;
  let recordForKidStub: MockInstance;

  beforeEach(() => {
    vi.spyOn(authMiddleware, "auth").mockReturnValue([] as any);
    vi.spyOn(authMiddleware, "checkDonorOwnsDistribution").mockImplementation(
      (_KID, _req, _res, next) => next(),
    );
    delete require.cache[require.resolve("../routes/agreementfeedback")];
    const { agreementfeedbackRouter } = require("../routes/agreementfeedback");
    server = express();
    server.use(express.json());
    server.use("/agreementfeedback", agreementfeedbackRouter);

    recordForKidStub = vi
      .spyOn(DAO.agreementfeedback, "getStoppedAgreementReasonRecordExistsForKID")
      .mockReturnValue(undefined as any);
    deleteStub = vi
      .spyOn(DAO.agreementfeedback, "deleteStoppedAgreementReasonRecord")
      .mockResolvedValue(5);
    belongsStub = vi
      .spyOn(DAO.agreementfeedback, "agreementBelongsToKID")
      .mockReturnValue(undefined as any);
    vi.spyOn(DAO.agreementfeedback, "getStoppedAgreementReasonById").mockResolvedValue({
      ID: 1,
      isOther: false,
    } as any);
    vi.spyOn(
      DAO.agreementfeedback,
      "getStoppedAgreementReasonRecordForAgreementWithin24Hours",
    ).mockResolvedValue(null);
    addStub = vi
      .spyOn(DAO.agreementfeedback, "addStoppedAgreementReasonRecord")
      .mockResolvedValue(7);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete require.cache[require.resolve("../routes/agreementfeedback")];
  });

  describe("DELETE /stopped/:KID/:id", () => {
    it("deletes a record belonging to the KID", async () => {
      recordForKidStub.withArgs(5, "12345678").resolves(true);
      const res = await request(server).delete("/agreementfeedback/stopped/12345678/5");
      expect(res.status).toBe(200);
      expect(deleteStub).toHaveBeenCalledExactlyOnceWith(5);
    });

    it("returns 404 and does not delete a record belonging to another KID", async () => {
      recordForKidStub.mockResolvedValue(false);
      const res = await request(server).delete("/agreementfeedback/stopped/12345678/6");
      expect(res.status).toBe(404);
      expect(deleteStub).not.toHaveBeenCalled();
    });
  });

  describe("POST /stopped/:KID", () => {
    const body = { reasonId: 1, agreementId: "3", agreementType: "AvtaleGiro" };

    it("adds feedback for an agreement with the KID", async () => {
      belongsStub.withArgs("AvtaleGiro", "3", "12345678").resolves(true);
      const res = await request(server).post("/agreementfeedback/stopped/12345678").send(body);
      expect(res.status).toBe(200);
      expect(addStub).toHaveBeenCalledOnce();
    });

    it("rejects feedback for an agreement with a different KID", async () => {
      belongsStub.mockResolvedValue(false);
      const res = await request(server).post("/agreementfeedback/stopped/12345678").send(body);
      expect(res.status).toBe(403);
      expect(addStub).not.toHaveBeenCalled();
    });
  });
});
