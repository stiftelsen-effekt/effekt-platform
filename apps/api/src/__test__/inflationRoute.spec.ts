import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import express from "express";
import request from "supertest";
import config from "../config";
import { DAO } from "../custom_modules/DAO";
import { inflationRouter } from "../routes/inflation";

const vipps = require("../custom_modules/vipps");

const token = "a".repeat(64);
const path = `/inflation/agreement-update/${token}`;

function adjustment(overrides: Record<string, unknown> = {}) {
  return {
    ID: 1,
    agreement_ID: "42",
    agreement_type: "avtaleGiro",
    current_amount: 30000,
    proposed_amount: 33000,
    inflation_percentage: 0.1,
    token,
    status: "pending",
    created: new Date(),
    updated: null,
    expires: new Date(Date.now() + 24 * 3600 * 1000),
    ...overrides,
  } as any;
}

describe("inflation agreement update", () => {
  let server: express.Express;
  let getByTokenStub: MockInstance;
  let acceptStub: MockInstance;
  let releaseStub: MockInstance;
  let updateAmountStub: MockInstance;

  beforeEach(() => {
    vi.spyOn(config, "frontend_url", "get").mockReturnValue("https://example.org");
    vi.spyOn(config, "inflation_adjustment_success_slug", "get").mockReturnValue("ok");
    vi.spyOn(config, "inflation_adjustment_error_slug", "get").mockReturnValue("failed");
    server = express();
    server.use("/inflation", inflationRouter);
    getByTokenStub = vi
      .spyOn(DAO.inflationadjustments, "getByToken")
      .mockReturnValue(undefined as any);
    acceptStub = vi
      .spyOn(DAO.inflationadjustments, "acceptAdjustment")
      .mockReturnValue(undefined as any);
    releaseStub = vi
      .spyOn(DAO.inflationadjustments, "releaseAcceptedAdjustment")
      .mockResolvedValue(true);
    vi.spyOn(DAO.avtalegiroagreements, "getByID").mockResolvedValue({ KID: "123" } as any);
    updateAmountStub = vi.spyOn(DAO.avtalegiroagreements, "updateAmount").mockResolvedValue(true);
  });

  afterEach(() => vi.restoreAllMocks());

  describe("GET (the email link)", () => {
    it("shows a confirmation page that posts back, without changing anything", async () => {
      getByTokenStub.mockResolvedValue(adjustment());

      const res = await request(server).get(path).expect(200);

      expect(res.text).toContain('<form method="post">');
      expect(res.text).toContain("300 kr");
      expect(res.text).toContain("330 kr");
      expect(res.headers["content-security-policy"]).toContain("form-action 'self'");
      expect(acceptStub).not.toHaveBeenCalled();
      expect(updateAmountStub).not.toHaveBeenCalled();
    });

    it("redirects to the success page if already accepted", async () => {
      getByTokenStub.mockResolvedValue(adjustment({ status: "accepted" }));
      const res = await request(server).get(path).expect(302);
      expect(res.headers.location).toBe("https://example.org/ok");
    });

    it("says the offer has expired when its time ran out", async () => {
      getByTokenStub.mockResolvedValue(adjustment({ expires: new Date(Date.now() - 1000) }));
      const res = await request(server).get(path).expect(200);
      expect(res.text).toContain("Tilbudet har utløpt");
      expect(res.text).not.toContain("<form");
      expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    });

    it("says the offer has expired when it is marked expired", async () => {
      getByTokenStub.mockResolvedValue(adjustment({ status: "expired" }));
      const res = await request(server).get(path).expect(200);
      expect(res.text).toContain("Tilbudet har utløpt");
    });

    it("redirects to the error page for offers that were never sent", async () => {
      for (const status of ["new", "sending", "cancelled", "failed"]) {
        getByTokenStub.mockResolvedValue(adjustment({ status }));
        const res = await request(server).get(path).expect(302);
        expect(res.headers.location).toBe("https://example.org/failed");
      }
    });

    it("redirects to the error page for an unknown or malformed token", async () => {
      getByTokenStub.mockResolvedValue(null);
      await request(server).get(path).expect(302);
      const res = await request(server).get("/inflation/agreement-update/x").expect(302);
      expect(res.headers.location).toBe("https://example.org/failed");
    });
  });

  describe("POST (the confirmation)", () => {
    it("claims the adjustment, then updates the AvtaleGiro amount", async () => {
      acceptStub.mockResolvedValue(true);
      getByTokenStub.mockResolvedValue(adjustment({ status: "accepted" }));

      const res = await request(server).post(path).expect(303);

      expect(res.headers.location).toBe("https://example.org/ok");
      expect(acceptStub).toHaveBeenCalledExactlyOnceWith(token);
      expect(updateAmountStub).toHaveBeenCalledExactlyOnceWith("123", 33000);
      expect(releaseStub).not.toHaveBeenCalled();
    });

    it("does not apply an adjustment twice", async () => {
      acceptStub.mockResolvedValue(false);
      getByTokenStub.mockResolvedValue(adjustment({ status: "accepted" }));

      const res = await request(server).post(path).expect(303);

      expect(res.headers.location).toBe("https://example.org/ok");
      expect(updateAmountStub).not.toHaveBeenCalled();
    });

    it("says the offer has expired instead of applying it", async () => {
      acceptStub.mockResolvedValue(false);
      getByTokenStub.mockResolvedValue(adjustment({ status: "expired" }));

      const res = await request(server).post(path).expect(200);

      expect(res.text).toContain("Tilbudet har utløpt");
      expect(updateAmountStub).not.toHaveBeenCalled();
    });

    it("does not apply a non-pending adjustment", async () => {
      acceptStub.mockResolvedValue(false);
      getByTokenStub.mockResolvedValue(adjustment({ status: "pending" }));

      const res = await request(server).post(path).expect(303);

      expect(res.headers.location).toBe("https://example.org/failed");
      expect(updateAmountStub).not.toHaveBeenCalled();
    });

    it("releases the claim if the agreement could not be updated", async () => {
      acceptStub.mockResolvedValue(true);
      getByTokenStub.mockResolvedValue(adjustment({ status: "accepted" }));
      updateAmountStub.mockResolvedValue(false);

      const res = await request(server).post(path).expect(303);

      expect(res.headers.location).toBe("https://example.org/failed");
      expect(releaseStub).toHaveBeenCalledExactlyOnceWith(token);
    });

    it("releases the claim if Vipps rejects the price change", async () => {
      acceptStub.mockResolvedValue(true);
      getByTokenStub.mockResolvedValue(adjustment({ status: "accepted", agreement_type: "vipps" }));
      vi.spyOn(vipps, "updateAgreementPrice").mockResolvedValue(false);

      await request(server).post(path).expect(303);

      expect(releaseStub).toHaveBeenCalledOnce();
    });

    it("does not apply adjustments of unsupported agreement types", async () => {
      acceptStub.mockResolvedValue(true);
      getByTokenStub.mockResolvedValue(
        adjustment({ status: "accepted", agreement_type: "autoGiro" }),
      );

      const res = await request(server).post(path).expect(303);

      expect(res.headers.location).toBe("https://example.org/failed");
      expect(releaseStub).toHaveBeenCalledOnce();
    });
  });
});
