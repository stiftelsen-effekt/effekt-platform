import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import express from "express";
import request from "supertest";
import * as authMiddleware from "../custom_modules/authorization/authMiddleware";
import { DAO } from "../custom_modules/DAO";

describe("Vipps agreement url codes", () => {
  let server: express.Express;
  let queryStub: MockInstance;

  beforeEach(function () {
    // This must be stubbed before importing the routes
    vi.spyOn(authMiddleware, "auth").mockReturnValue([]);

    server = express();
    server.use("/vipps", require("../routes/vipps"));
    server.use((err, req, res, _next) => res.status(err.status ?? 500).end());

    vi.spyOn(DAO.vipps, "getAgreementIdByUrlCode").mockResolvedValue(false);
    // An unknown code must never reach the agreements table: `ID = false` matches every row
    queryStub = vi.spyOn(DAO, "query").mockRejectedValue(new Error("unexpected query"));
  });

  afterEach(function () {
    vi.restoreAllMocks();
  });

  it("returns 404 from the Min Side redirect for an unknown code", async function () {
    await request(server).get("/vipps/agreement/minside/not-a-code").expect(404);
    expect(queryStub).not.toHaveBeenCalled();
  });

  it("has no routes that read or edit an agreement by url code", async function () {
    const code = "0123456789abcdef0123456789abcdef";
    await request(server).get(`/vipps/agreement/anonymous/${code}`).expect(404);
    for (const path of ["cancel", "price", "pause", "pause/end", "chargeday", "forcedcharge"]) {
      await request(server).put(`/vipps/agreement/${code}/${path}`).expect(404);
    }
    await request(server).put(`/vipps/agreement/${code}/distribution`).expect(404);
    await request(server).post(`/vipps/agreement/${code}/charges/cancel`).expect(404);
    expect(vi.mocked(DAO.vipps.getAgreementIdByUrlCode)).not.toHaveBeenCalled();
  });

  describe("Min Side redirect", function () {
    const code = "0123456789abcdef0123456789abcdef";

    const stubAgreementOwner = (email: string) => {
      vi.mocked(DAO.vipps.getAgreementIdByUrlCode).mockImplementation(async (c) =>
        c === code ? "agr_TEST" : false,
      );
      vi.spyOn(DAO.vipps, "getAgreement").mockResolvedValue({ ID: "agr_TEST", donorID: 42 } as any);
      vi.spyOn(DAO.donors, "getByID").mockResolvedValue({ id: 42, email } as any);
    };

    it("sends donors to the Vipps agreement login page without their details", async function () {
      stubAgreementOwner("donor@example.com");
      const res = await request(server).get(`/vipps/agreement/minside/${code}`).expect(302);
      expect(res.headers.location).toMatch(/\/vippsagreement$/);
      expect(res.headers.location).not.toContain("@");
      expect(res.headers.location).not.toContain(code);
    });

    it("sends anonymous donors to the anonymous agreement page without the code", async function () {
      stubAgreementOwner("anon@gieffektivt.no");
      const res = await request(server).get(`/vipps/agreement/minside/${code}`).expect(302);
      expect(res.headers.location).toMatch(/\/min-side\/vipps-anonym$/);
      expect(res.headers.location).not.toContain("@");
      expect(res.headers.location).not.toContain(code);
    });
  });

  it("does not query for an agreement without an ID", async function () {
    expect(await DAO.vipps.getAgreement(false)).toBe(false);
    expect(queryStub).not.toHaveBeenCalled();
  });
});
