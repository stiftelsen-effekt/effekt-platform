import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import type { Request, Response } from "express";
import { DAO } from "../custom_modules/DAO";
import { donationHelpers } from "../custom_modules/donationHelpers";
import * as mail from "../custom_modules/mail";
import { appRouter } from "../trpc/router";
import { createCallerFactory } from "../trpc/trpc";

const vipps = require("../custom_modules/vipps");

const createCaller = createCallerFactory(appRouter);

const callerWith = (permissions?: string[]) =>
  createCaller({
    req: {} as Request,
    res: {} as Response,
    auth: permissions ? { permissions } : undefined,
  });

const admin = () => callerWith(["admin"]);

const expectTrpcError = async (promise: Promise<unknown>, code: string) => {
  try {
    await promise;
    expect.unreachable(`expected ${code}`);
  } catch (err: any) {
    expect(err.code).toBe(code);
  }
};

const dbAgreement = {
  ID: "agr_TEST1",
  donorID: 42,
  KID: "12345678",
  amount: 300,
  status: "ACTIVE",
  monthly_charge_day: 5,
  timestamp_created: "2026-01-01 10:00:00",
  agreement_url_code: "urlcode-abc",
  paused_until_date: null,
  force_charge_date: null,
} as any;

const distribution = {
  taxUnitId: null,
  causeAreas: [
    {
      id: 1,
      standardSplit: false,
      percentageShare: "100",
      organizations: [
        { id: 5, percentageShare: "60" },
        { id: 6, percentageShare: "40" },
      ],
    },
  ],
};

describe("tRPC vipps router", () => {
  let changeMailStub: MockInstance;

  beforeEach(() => {
    changeMailStub = vi.spyOn(mail, "sendVippsAgreementChange").mockResolvedValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("auth and validation", () => {
    it("rejects anonymous callers", async () => {
      const stub = vi.spyOn(DAO.vipps, "getAgreementReport").mockReturnValue(undefined as any);
      await expectTrpcError(callerWith().vipps.agreements.report(), "UNAUTHORIZED");
      expect(stub).not.toHaveBeenCalled();
    });

    it("rejects callers without the admin permission", async () => {
      const stub = vi.spyOn(vipps, "refundCharge").mockReturnValue(undefined);
      await expectTrpcError(
        callerWith(["read:profile"]).vipps.charges.refund({ agreementId: "a", chargeId: "c" }),
        "FORBIDDEN",
      );
      expect(stub).not.toHaveBeenCalled();
    });

    it("rejects invalid input", async () => {
      const stub = vi.spyOn(DAO.vipps, "getAgreement").mockReturnValue(undefined as any);
      await expectTrpcError(
        admin().vipps.agreements.updateChargeDay({ id: "agr_TEST1", chargeDay: 29 }),
        "BAD_REQUEST",
      );
      await expectTrpcError(
        admin().vipps.agreements.list({
          page: 0,
          limit: 10,
          sort: { id: "pausedUntilDate" as any, desc: true },
        }),
        "BAD_REQUEST",
      );
      expect(stub).not.toHaveBeenCalled();
    });
  });

  describe("agreements", () => {
    it("lists an agreement's charges and donations across KIDs", async () => {
      const query = vi.spyOn(DAO, "query").mockReturnValue(undefined as any);
      query.mockResolvedValueOnce([[{ KID: "200" }], []] as any);
      query.mockResolvedValueOnce([
        [
          {
            chargeID: "chr-2",
            amountNOK: 300,
            KID: "200",
            dueDate: "2026-02-01",
            status: "CHARGED",
            type: "RECURRING",
            timestamp_created: null,
          },
          {
            chargeID: "chr-1",
            amountNOK: 200,
            KID: "100",
            dueDate: "2026-01-01",
            status: "CHARGED",
            type: "RECURRING",
            timestamp_created: null,
          },
        ],
        [],
      ] as any);
      query.mockResolvedValueOnce([
        [
          {
            ID: 2,
            sum_confirmed: "300.00",
            transaction_cost: null,
            timestamp_confirmed: new Date("2026-02-01"),
            payment_name: "Vipps Recurring",
            KID_fordeling: "200",
            PaymentExternal_ID: "agr_1.chr-2",
          },
          {
            ID: 1,
            sum_confirmed: "200.00",
            transaction_cost: null,
            timestamp_confirmed: new Date("2026-01-01"),
            payment_name: "Vipps Recurring",
            KID_fordeling: "100",
            PaymentExternal_ID: null,
          },
        ],
        [],
      ] as any);

      const result = await admin().vipps.agreements.payments({ id: "agr_1" });

      expect(result.KIDs).toStrictEqual(["200", "100"]);
      expect(query.mock.calls[2][1]).toStrictEqual([["200", "100"], "agr\\_1.%"]);
      expect(result.donations.map((d) => [d.id, d.chargeId])).toStrictEqual([
        [2, "chr-2"],
        [1, null],
      ]);
      expect(result.charges.map((c) => [c.chargeId, c.donationId])).toStrictEqual([
        ["chr-2", 2],
        ["chr-1", null],
      ]);

      query.mockReset();
      query.mockResolvedValue([[], []] as any);
      await expectTrpcError(admin().vipps.agreements.payments({ id: "agr_x" }), "NOT_FOUND");
    });

    it("lists agreements with the filter converted for the DAO", async () => {
      const result = { rows: [], statistics: {}, pages: 0 } as any;
      const stub = vi.spyOn(DAO.vipps, "getAgreements").mockResolvedValue(result);

      const res = await admin().vipps.agreements.list({
        page: 1,
        limit: 25,
        sort: { id: "created", desc: true },
        filter: {
          amount: { from: 100, to: 500 },
          created: { from: "2026-01-01", to: "2026-01-31" },
          statuses: ["ACTIVE"],
          donor: "Ola",
        },
      });

      expect(res).toBe(result);
      const [sort, page, limit, filter] = stub.mock.calls[0];
      expect(sort).toStrictEqual({ id: "created", desc: true });
      expect(page).toBe(1);
      expect(limit).toBe(25);
      expect(filter!.createdRange).toStrictEqual({
        from: new Date("2025-12-31T23:00:00Z"),
        before: new Date("2026-01-31T23:00:00Z"),
      });
      expect(filter!.statuses).toStrictEqual(["ACTIVE"]);
      expect(filter!.donor).toBe("Ola");
    });

    it("exports agreements as CSV", async () => {
      vi.spyOn(DAO.vipps, "getAgreements").mockResolvedValue({
        rows: [{ ID: "agr_1", full_name: "Ola Nordmann", amount: 300 } as any],
        statistics: {} as any,
        pages: 1,
      });

      const res = await admin().vipps.agreements.export({});

      expect(res.filename).toMatch(/^vipps-agreements-.*\.csv$/);
      expect(res.csv).toBe("\uFEFFID,full_name,amount\nagr_1,Ola Nordmann,300");
    });

    it("gets an agreement synced with Vipps", async () => {
      vi.spyOn(DAO.vipps, "getAgreement").mockResolvedValue(dbAgreement);
      vi.spyOn(vipps, "getAgreement").mockResolvedValue({
        id: "agr_TEST1",
        status: "ACTIVE",
        pricing: { amount: 30000 },
      });
      const statusStub = vi.spyOn(DAO.vipps, "updateAgreementStatus").mockResolvedValue(true);
      const priceStub = vi.spyOn(DAO.vipps, "updateAgreementPrice").mockResolvedValue(true);

      const res = await admin().vipps.agreements.get({ id: "agr_TEST1" });

      expect(statusStub).toHaveBeenCalledWith("agr_TEST1", "ACTIVE");
      expect(priceStub).toHaveBeenCalledWith("agr_TEST1", 300);
      expect(res.agreement_url_code).toBe("urlcode-abc");
      expect(res.pricing.amount).toBe(30000);
    });

    it("returns NOT_FOUND for unknown agreements without calling Vipps", async () => {
      vi.spyOn(DAO.vipps, "getAgreement").mockResolvedValue(false);
      const vippsStub = vi.spyOn(vipps, "getAgreement").mockReturnValue(undefined);

      await expectTrpcError(admin().vipps.agreements.get({ id: "agr_NOPE" }), "NOT_FOUND");
      expect(vippsStub).not.toHaveBeenCalled();
    });

    it("does not touch the DB when Vipps cannot be reached", async () => {
      vi.spyOn(DAO.vipps, "getAgreement").mockResolvedValue(dbAgreement);
      vi.spyOn(vipps, "getAgreement").mockResolvedValue(false);
      const statusStub = vi
        .spyOn(DAO.vipps, "updateAgreementStatus")
        .mockReturnValue(undefined as any);

      await expectTrpcError(admin().vipps.agreements.get({ id: "agr_TEST1" }), "BAD_GATEWAY");
      expect(statusStub).not.toHaveBeenCalled();
    });

    it("returns BAD_GATEWAY without the upstream error text when Vipps fails", async () => {
      vi.spyOn(DAO.vipps, "getAgreement").mockResolvedValue(dbAgreement);
      vi.spyOn(console, "error").mockReturnValue(undefined);
      vi.spyOn(vipps, "getAgreement").mockRejectedValue(new Error("401 client_secret=hunter2"));

      try {
        await admin().vipps.agreements.get({ id: "agr_TEST1" });
        expect.unreachable("expected BAD_GATEWAY");
      } catch (err: any) {
        expect(err.code).toBe("BAD_GATEWAY");
        expect(err.message).toBe("Vipps could not fetch the agreement");
      }
    });

    it("returns the agreement report", async () => {
      vi.spyOn(DAO.vipps, "getAgreementReport").mockResolvedValue({
        activeAgreementCount: 3,
      } as any);
      const res = await admin().vipps.agreements.report();
      expect(res).toStrictEqual({ activeAgreementCount: 3 });
    });

    it("returns the agreement histogram", async () => {
      const buckets = [{ bucket: 0, items: 2, bar: 69 }];
      vi.spyOn(DAO.vipps, "getAgreementSumHistogram").mockResolvedValue(buckets);
      const res = await admin().vipps.agreements.histogram();
      expect(res).toStrictEqual(buckets);
    });

    it("updates the price in øre with Vipps and in NOK in the DB", async () => {
      vi.spyOn(DAO.vipps, "getAgreement").mockResolvedValue(dbAgreement);
      const vippsStub = vi.spyOn(vipps, "updateAgreementPrice").mockResolvedValue(true);
      const dbStub = vi.spyOn(DAO.vipps, "updateAgreementPrice").mockResolvedValue(true);

      await admin().vipps.agreements.updatePrice({ id: "agr_TEST1", amountNok: 250 });

      expect(vippsStub).toHaveBeenCalledWith("agr_TEST1", 25000);
      expect(dbStub).toHaveBeenCalledWith("agr_TEST1", 250);
      expect(changeMailStub).toHaveBeenCalledWith("agr_TEST1", "AMOUNT", 250);
    });

    it("does not update the DB price when Vipps rejects it", async () => {
      vi.spyOn(DAO.vipps, "getAgreement").mockResolvedValue(dbAgreement);
      vi.spyOn(vipps, "updateAgreementPrice").mockResolvedValue(false);
      const dbStub = vi.spyOn(DAO.vipps, "updateAgreementPrice").mockReturnValue(undefined as any);

      await expectTrpcError(
        admin().vipps.agreements.updatePrice({ id: "agr_TEST1", amountNok: 250 }),
        "BAD_GATEWAY",
      );
      expect(dbStub).not.toHaveBeenCalled();
      expect(changeMailStub).not.toHaveBeenCalled();
    });

    it("returns BAD_GATEWAY when Vipps throws on a price update", async () => {
      vi.spyOn(DAO.vipps, "getAgreement").mockResolvedValue(dbAgreement);
      vi.spyOn(console, "error").mockReturnValue(undefined);
      vi.spyOn(vipps, "updateAgreementPrice").mockRejectedValue(
        new Error("Vipps is not configured"),
      );

      await expectTrpcError(
        admin().vipps.agreements.updatePrice({ id: "agr_TEST1", amountNok: 250 }),
        "BAD_GATEWAY",
      );
    });

    it("rejects cancelling an agreement that is already stopped", async () => {
      vi.spyOn(DAO.vipps, "getAgreement").mockResolvedValue({ ...dbAgreement, status: "STOPPED" });
      const vippsStub = vi.spyOn(vipps, "updateAgreementStatus").mockReturnValue(undefined);

      await expectTrpcError(admin().vipps.agreements.cancel({ id: "agr_TEST1" }), "BAD_REQUEST");
      expect(vippsStub).not.toHaveBeenCalled();
    });

    it("returns BAD_GATEWAY when Vipps does not cancel", async () => {
      vi.spyOn(DAO.vipps, "getAgreement").mockResolvedValue(dbAgreement);
      vi.spyOn(vipps, "updateAgreementStatus").mockResolvedValue(false);
      const statusStub = vi
        .spyOn(DAO.vipps, "updateAgreementStatus")
        .mockReturnValue(undefined as any);

      await expectTrpcError(admin().vipps.agreements.cancel({ id: "agr_TEST1" }), "BAD_GATEWAY");
      expect(statusStub).not.toHaveBeenCalled();
    });

    it("cancels an agreement", async () => {
      vi.spyOn(DAO.vipps, "getAgreement").mockResolvedValue(dbAgreement);
      const vippsStub = vi.spyOn(vipps, "updateAgreementStatus").mockResolvedValue(true);
      const statusStub = vi.spyOn(DAO.vipps, "updateAgreementStatus").mockResolvedValue(true);
      const cancelDateStub = vi
        .spyOn(DAO.vipps, "updateAgreementCancellationDate")
        .mockResolvedValue(true);

      await admin().vipps.agreements.cancel({ id: "agr_TEST1" });

      expect(vippsStub).toHaveBeenCalledWith("agr_TEST1", "STOPPED");
      expect(statusStub).toHaveBeenCalledWith("agr_TEST1", "STOPPED");
      expect(cancelDateStub).toHaveBeenCalledWith("agr_TEST1");
      expect(changeMailStub).toHaveBeenCalledWith("agr_TEST1", "STOPPED");
    });

    it("updates the charge day", async () => {
      vi.spyOn(DAO.vipps, "getAgreement").mockResolvedValue(dbAgreement);
      const stub = vi.spyOn(DAO.vipps, "updateAgreementChargeDay").mockResolvedValue(true);

      await admin().vipps.agreements.updateChargeDay({ id: "agr_TEST1", chargeDay: 0 });

      expect(stub).toHaveBeenCalledWith("agr_TEST1", 0);
      expect(changeMailStub).toHaveBeenCalledWith("agr_TEST1", "CHARGEDAY", 0);
    });

    const stubReferences = () => {
      vi.spyOn(DAO.donors, "getByID").mockResolvedValue({ id: 42 } as any);
      vi.spyOn(DAO.organizations, "getByIDs").mockResolvedValue([
        { ID: 5, cause_area_ID: 1 },
        { ID: 6, cause_area_ID: 1 },
      ] as any);
    };

    it("updates the distribution, creating a new KID for the agreement's donor", async () => {
      vi.spyOn(DAO.vipps, "getAgreement").mockResolvedValue(dbAgreement);
      stubReferences();
      vi.spyOn(DAO.distributions, "getKIDbySplit").mockResolvedValue(null);
      vi.spyOn(donationHelpers, "createKID").mockResolvedValue("87654321");
      const addStub = vi.spyOn(DAO.distributions, "add").mockResolvedValue(true as any);
      const kidStub = vi.spyOn(DAO.vipps, "updateAgreementKID").mockResolvedValue(true);

      const res = await admin().vipps.agreements.updateDistribution({
        id: "agr_TEST1",
        distribution,
      });

      expect(res).toStrictEqual({ KID: "87654321" });
      expect(addStub.mock.calls[0][0]).toEqual(
        expect.objectContaining({ donorId: 42, kid: "87654321" }),
      );
      expect(kidStub).toHaveBeenCalledWith("agr_TEST1", "87654321");
      expect(changeMailStub).toHaveBeenCalledWith("agr_TEST1", "SHARES", "87654321");
    });

    it("rejects another donor's tax unit", async () => {
      vi.spyOn(DAO.vipps, "getAgreement").mockResolvedValue(dbAgreement);
      stubReferences();
      vi.spyOn(DAO.tax, "getById").mockResolvedValue({ id: 9, donorId: 7, archived: null } as any);
      const kidStub = vi.spyOn(DAO.vipps, "updateAgreementKID").mockReturnValue(undefined as any);
      const addStub = vi.spyOn(DAO.distributions, "add").mockReturnValue(undefined as any);

      await expectTrpcError(
        admin().vipps.agreements.updateDistribution({
          id: "agr_TEST1",
          distribution: { ...distribution, taxUnitId: 9 },
        }),
        "BAD_REQUEST",
      );
      expect(kidStub).not.toHaveBeenCalled();
      expect(addStub).not.toHaveBeenCalled();
    });

    it("rejects an organization outside its cause area", async () => {
      vi.spyOn(DAO.vipps, "getAgreement").mockResolvedValue(dbAgreement);
      vi.spyOn(DAO.donors, "getByID").mockResolvedValue({ id: 42 } as any);
      vi.spyOn(DAO.organizations, "getByIDs").mockResolvedValue([
        { ID: 5, cause_area_ID: 1 },
        { ID: 6, cause_area_ID: 2 },
      ] as any);
      const kidStub = vi.spyOn(DAO.vipps, "updateAgreementKID").mockReturnValue(undefined as any);

      await expectTrpcError(
        admin().vipps.agreements.updateDistribution({ id: "agr_TEST1", distribution }),
        "BAD_REQUEST",
      );
      expect(kidStub).not.toHaveBeenCalled();
    });

    it("rejects a distribution that does not sum to 100", async () => {
      vi.spyOn(DAO.vipps, "getAgreement").mockResolvedValue(dbAgreement);
      const kidStub = vi.spyOn(DAO.vipps, "updateAgreementKID").mockReturnValue(undefined as any);

      await expectTrpcError(
        admin().vipps.agreements.updateDistribution({
          id: "agr_TEST1",
          distribution: {
            ...distribution,
            causeAreas: [{ ...distribution.causeAreas[0], percentageShare: "90" }],
          },
        }),
        "BAD_REQUEST",
      );
      expect(kidStub).not.toHaveBeenCalled();
    });
  });

  describe("charges", () => {
    it("lists charges with the default sort, without the window aggregates", async () => {
      const row = {
        full_count: 1,
        full_sum: "300",
        full_avg: "300.0000",
        chargeID: "chr1",
        amountNOK: 300,
      } as any;
      const statistics = { numCharges: 1, sumCharges: "300", avgCharge: "300.0000" };
      const stub = vi
        .spyOn(DAO.vipps, "getCharges")
        .mockResolvedValue({ rows: [row], statistics, pages: 1 });

      const res = await admin().vipps.charges.list({
        page: 0,
        limit: 25,
        filter: { dueDate: { from: "2026-01-01" }, statuses: ["CHARGED"] },
      });

      expect(res).toStrictEqual({
        rows: [{ chargeID: "chr1", amountNOK: 300 }],
        statistics,
        pages: 1,
      });
      expect(stub.mock.calls[0]).toStrictEqual([
        { id: "dueDate", desc: true },
        0,
        25,
        { dueDate: { from: "2026-01-01" }, statuses: ["CHARGED"] },
      ]);
    });

    it("exports charges as CSV without the window aggregates", async () => {
      vi.spyOn(DAO.vipps, "getCharges").mockResolvedValue({
        rows: [
          { full_count: 1, full_sum: "300", full_avg: "300", chargeID: "chr1", amountNOK: 300 },
        ] as any,
        statistics: {} as any,
        pages: 1,
      });

      const res = await admin().vipps.charges.export({});

      expect(res.filename).toMatch(/^vipps-charges-.*\.csv$/);
      expect(res.csv).toBe("\uFEFFchargeID,amountNOK\nchr1,300");
    });

    it("returns the charge histogram", async () => {
      const buckets = [{ bucket: 500, items: 1, bar: 0 }];
      vi.spyOn(DAO.vipps, "getChargeSumHistogram").mockResolvedValue(buckets);
      const res = await admin().vipps.charges.histogram();
      expect(res).toStrictEqual(buckets);
    });

    const charge = (status: string) => ({
      chargeID: "chr1",
      agreementID: "agr_TEST1",
      status,
      amountNOK: 300,
    });

    it("refunds a charge and marks it REFUNDED", async () => {
      vi.spyOn(DAO.vipps, "getCharge").mockResolvedValue(charge("CHARGED"));
      vi.spyOn(vipps, "refundCharge").mockResolvedValue(true);
      const statusStub = vi.spyOn(DAO.vipps, "updateChargeStatus").mockResolvedValue(true);

      await admin().vipps.charges.refund({ agreementId: "agr_TEST1", chargeId: "chr1" });

      expect(statusStub).toHaveBeenCalledWith("REFUNDED", "agr_TEST1", "chr1");
    });

    it("reports a refund Vipps refused", async () => {
      vi.spyOn(DAO.vipps, "getCharge").mockResolvedValue(charge("CHARGED"));
      vi.spyOn(vipps, "refundCharge").mockResolvedValue(false);
      const statusStub = vi
        .spyOn(DAO.vipps, "updateChargeStatus")
        .mockReturnValue(undefined as any);

      await expectTrpcError(
        admin().vipps.charges.refund({ agreementId: "agr_TEST1", chargeId: "chr1" }),
        "BAD_GATEWAY",
      );
      expect(statusStub).not.toHaveBeenCalled();
    });

    it("returns NOT_FOUND for an unknown charge", async () => {
      vi.spyOn(DAO.vipps, "getCharge").mockResolvedValue(false);
      const refundStub = vi.spyOn(vipps, "refundCharge").mockReturnValue(undefined);

      await expectTrpcError(
        admin().vipps.charges.refund({ agreementId: "agr_TEST1", chargeId: "chr1" }),
        "NOT_FOUND",
      );
      expect(refundStub).not.toHaveBeenCalled();
    });

    it("only refunds CHARGED charges", async () => {
      vi.spyOn(DAO.vipps, "getCharge").mockResolvedValue(charge("PENDING"));
      const refundStub = vi.spyOn(vipps, "refundCharge").mockReturnValue(undefined);

      await expectTrpcError(
        admin().vipps.charges.refund({ agreementId: "agr_TEST1", chargeId: "chr1" }),
        "BAD_REQUEST",
      );
      expect(refundStub).not.toHaveBeenCalled();
    });
  });

  describe("matching rules", () => {
    const rules = [
      {
        id: 1,
        salesLocation: "Stand",
        message: null,
        periodFrom: new Date(2026, 0, 1),
        periodTo: new Date(2026, 0, 31),
        resolveKID: "111",
        precedence: 1,
      },
      {
        id: 2,
        salesLocation: null,
        message: "Julegave",
        periodFrom: new Date(2026, 11, 1),
        periodTo: new Date(2026, 11, 31),
        resolveKID: "222",
        precedence: null,
      },
    ];

    it("lists all rules", async () => {
      vi.spyOn(DAO.vipps, "getMatchingRules").mockResolvedValue(rules);
      const res = await admin().vipps.matchingRules.list();
      expect(res.map((r) => r.id)).toStrictEqual([1, 2]);
    });

    it("lists rules overlapping a period", async () => {
      vi.spyOn(DAO.vipps, "getMatchingRules").mockResolvedValue(rules);
      const res = await admin().vipps.matchingRules.list({
        period: { from: "2026-01-31", to: "2026-02-15" },
      });
      expect(res.map((r) => r.id)).toStrictEqual([1]);
    });

    it("creates a rule", async () => {
      vi.spyOn(DAO.distributions, "KIDexists").mockResolvedValue(true);
      const addStub = vi.spyOn(DAO.vipps, "addMatchingRule").mockResolvedValue(9);

      const res = await admin().vipps.matchingRules.create({
        salesLocation: "Stand",
        message: null,
        periodFrom: "2026-03-01",
        periodTo: "2026-03-31",
        resolveKID: "111",
        precedence: 2,
      });

      expect(res).toStrictEqual({ id: 9 });
      expect(addStub.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          resolveKID: "111",
          periodFrom: "2026-03-01",
        }),
      );
    });

    it("rejects a rule for an unknown KID", async () => {
      vi.spyOn(DAO.distributions, "KIDexists").mockResolvedValue(false);
      const addStub = vi.spyOn(DAO.vipps, "addMatchingRule").mockReturnValue(undefined as any);

      await expectTrpcError(
        admin().vipps.matchingRules.create({
          salesLocation: null,
          message: null,
          periodFrom: "2026-03-01",
          periodTo: "2026-03-31",
          resolveKID: "999",
          precedence: null,
        }),
        "BAD_REQUEST",
      );
      expect(addStub).not.toHaveBeenCalled();
    });

    it("updates a rule with the create validation, NOT_FOUND when missing", async () => {
      const kidExists = vi.spyOn(DAO.distributions, "KIDexists").mockResolvedValue(true);
      const update = vi
        .spyOn(DAO.vipps, "updateMatchingRule")
        .mockImplementation(async (ruleId) => ruleId === 4);
      const rule = {
        id: 4,
        salesLocation: "Stand",
        message: "gave",
        periodFrom: "2026-03-01",
        periodTo: "2026-03-31",
        resolveKID: "111",
        precedence: 2,
      };

      expect(await admin().vipps.matchingRules.update(rule)).toStrictEqual({ id: 4 });
      const { id, ...fields } = rule;
      expect(update.mock.calls[0]).toStrictEqual([id, fields]);

      await expectTrpcError(admin().vipps.matchingRules.update({ ...rule, id: 5 }), "NOT_FOUND");
      await expectTrpcError(
        admin().vipps.matchingRules.update({ ...rule, periodTo: "2026-03-01" }),
        "BAD_REQUEST",
      );
      kidExists.mockResolvedValue(false);
      await expectTrpcError(admin().vipps.matchingRules.update(rule), "BAD_REQUEST");
      await expectTrpcError(
        admin().vipps.matchingRules.update({ ...rule, salesLocation: "x".repeat(46) }),
        "BAD_REQUEST",
      );
      await expectTrpcError(
        admin().vipps.matchingRules.update({ ...rule, id: undefined } as any),
        "BAD_REQUEST",
      );
      expect(update).toHaveBeenCalledTimes(2);
    });

    it("deletes a rule, NOT_FOUND when missing", async () => {
      const stub = vi.spyOn(DAO.vipps, "deleteMatchingRule").mockReturnValue(undefined as any);
      stub.withArgs(1).resolves(true);
      stub.withArgs(2).resolves(false);

      await admin().vipps.matchingRules.delete({ id: 1 });
      await expectTrpcError(admin().vipps.matchingRules.delete({ id: 2 }), "NOT_FOUND");
    });
  });
});
