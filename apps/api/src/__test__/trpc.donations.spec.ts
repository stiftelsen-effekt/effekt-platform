import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { DAO } from "../custom_modules/DAO";
import { donationHelpers } from "../custom_modules/donationHelpers";
import * as mail from "../custom_modules/mail";
import { appRouter } from "../trpc/router";
import { createCallerFactory } from "../trpc/trpc";

const config = require("../config");

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

const distribution = {
  donorId: 7,
  taxUnitId: null,
  causeAreas: [
    {
      id: 1,
      percentageShare: "100",
      standardSplit: false,
      organizations: [
        { id: 2, percentageShare: "60" },
        { id: 3, percentageShare: "40" },
      ],
    },
  ],
};

const existingDonation = {
  id: 42,
  donorId: 7,
  KID: "12345678",
  sum: "100.00",
  paymentExternalRef: null,
};

/** Stubs the lookups the procedures validate references against */
const stubLookups = () => ({
  methods: vi.spyOn(DAO.payment, "getMethods").mockResolvedValue([{ id: 5 }] as any),
  owners: vi
    .spyOn(DAO.meta, "getDataOwners")
    .mockResolvedValue([{ id: 3, name: "Owner", default: true }] as any),
  externalRefExists: vi.spyOn(DAO.donations, "externalRefExists").mockResolvedValue(false),
  donor: vi.spyOn(DAO.donors, "getByID").mockResolvedValue({ id: 7 } as any),
  organizations: vi.spyOn(DAO.organizations, "getByIDs").mockResolvedValue([
    { ID: 2, cause_area_ID: 1 },
    { ID: 3, cause_area_ID: 1 },
  ] as any),
});

describe("tRPC donations router", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("auth and validation", () => {
    it("rejects anonymous callers", async () => {
      const stub = vi.spyOn(DAO.donations, "getHistogramBySum").mockResolvedValue([]);
      await expectTrpcError(callerWith().donations.histogram(), "UNAUTHORIZED");
      await expectTrpcError(callerWith().donations.distributions.get({ kid: "1" }), "UNAUTHORIZED");
      expect(stub).not.toHaveBeenCalled();
    });

    it("rejects non-admin callers", async () => {
      const stub = vi.spyOn(DAO.donations, "remove").mockResolvedValue(true);
      await expectTrpcError(callerWith(["read:profile"]).donations.delete({ id: 1 }), "FORBIDDEN");
      expect(stub).not.toHaveBeenCalled();
    });

    it("rejects invalid input", async () => {
      const getAll = vi.spyOn(DAO.donations, "getAll").mockReturnValue(undefined as any);
      await expectTrpcError(admin().donations.list({ page: -1, limit: 10 }), "BAD_REQUEST");
      await expectTrpcError(
        admin().donations.list({ page: 0, limit: 10, sort: { id: "nope" as any, desc: true } }),
        "BAD_REQUEST",
      );
      await expectTrpcError(
        admin().donations.list({ page: 0, limit: 10, filter: { date: { from: "yesterday" } } }),
        "BAD_REQUEST",
      );
      expect(getAll).not.toHaveBeenCalled();
    });

    it("rejects distributions whose shares do not sum to 100", async () => {
      const add = vi.spyOn(DAO.distributions, "add").mockReturnValue(undefined as any);
      await expectTrpcError(
        admin().donations.distributions.create({
          ...distribution,
          metaOwnerId: 1,
          causeAreas: [
            {
              ...distribution.causeAreas[0],
              organizations: [
                { id: 2, percentageShare: "60" },
                { id: 3, percentageShare: "30" },
              ],
            },
          ],
        }),
        "BAD_REQUEST",
      );
      await expectTrpcError(
        admin().donations.distributions.create({
          ...distribution,
          metaOwnerId: 1,
          causeAreas: [{ ...distribution.causeAreas[0], percentageShare: "90" }],
        }),
        "BAD_REQUEST",
      );
      expect(add).not.toHaveBeenCalled();
    });
  });

  describe("donations", () => {
    it("lists donations with converted filter, default sort and locale", async () => {
      const row = {
        id: 1,
        donor: "A",
        paymentMethod: "Bank",
        sum: "10.00",
        transactionCost: null,
        kid: "1",
        timestamp: new Date(),
        taxUnitType: "person",
      };
      const getAll = vi.spyOn(DAO.donations, "getAll").mockResolvedValue({
        rows: [row],
        pages: 1,
        statistics: { numDonations: 1, sumDonations: "10.00", avgDonation: "10.000000" },
      } as any);

      vi.spyOn(DAO.distributions, "getOrgSharesByKIDs").mockResolvedValue(new Map());
      const res = await admin().donations.list({
        page: 2,
        limit: 25,
        filter: {
          date: { from: "2025-01-01", to: "2025-12-31T23:59:59Z" },
          taxUnitTypes: ["person" as any, null],
          paymentMethodIDs: [4],
        },
      });

      expect(res).toStrictEqual({
        rows: [{ ...row, orgSplit: [] }],
        pages: 1,
        statistics: { numDonations: 1, sumDonations: "10.00", avgDonation: "10.000000" },
      });
      const [sort, page, limit, filter, locale] = getAll.mock.calls[0];
      expect(sort).toStrictEqual({ id: "timestamp", desc: true });
      expect(page).toBe(2);
      expect(limit).toBe(25);
      // A date is the whole Oslo day; a date-time is the exact (inclusive) instant
      expect(filter!.date).toStrictEqual({
        from: new Date("2024-12-31T23:00:00.000Z"),
        before: new Date("2025-12-31T23:59:59.001Z"),
      });
      expect(filter!.taxUnitTypes).toStrictEqual(["person", null]);
      expect(locale).toBe("NO");
    });

    it("returns string statistics when the page is empty", async () => {
      vi.spyOn(DAO.donations, "getAll").mockResolvedValue({
        rows: [],
        pages: 0,
        statistics: { numDonations: 0, sumDonations: 0, avgDonation: 0 },
      });
      const res = await admin().donations.list({ page: 0, limit: 10 });
      expect(res.statistics).toStrictEqual({
        numDonations: 0,
        sumDonations: "0",
        avgDonation: "0",
      });
    });

    it("exports donations as csv", async () => {
      const getAll = vi.spyOn(DAO.donations, "getAll").mockResolvedValue({
        rows: [{ id: 1, donor: "A, B", sum: 10 }],
        pages: 1,
        statistics: { numDonations: 1, sumDonations: "10", avgDonation: "10" },
      } as any);

      const res = await admin().donations.export({ locale: "SV" as any });

      expect(getAll.mock.calls[0][2]).toBe(Number.MAX_SAFE_INTEGER);
      expect(getAll.mock.calls[0][4]).toBe("SV");
      expect(res.filename).toMatch(/^donations-.*\.csv$/);
      expect(res.csv).toBe('﻿id,donor,sum\n1,"A, B",10');
    });

    it("gets a donation and maps missing ones to NOT_FOUND", async () => {
      const getByID = vi.spyOn(DAO.donations, "getByID").mockReturnValue(undefined as any);
      getByID.withArgs(42).resolves(existingDonation as any);
      getByID.withArgs(43).rejects(new Error("Could not find donation with ID 43"));

      expect(await admin().donations.get({ id: 42 })).toBe(existingDonation);
      await expectTrpcError(admin().donations.get({ id: 43 }), "NOT_FOUND");
    });

    it("updates fields and moves the donation to a matching KID", async () => {
      stubLookups();
      vi.spyOn(DAO.donations, "getByID").mockResolvedValue(existingDonation as any);
      const update = vi.spyOn(DAO.donations, "update").mockResolvedValue(undefined);
      vi.spyOn(DAO.distributions, "getSplitByKID").mockResolvedValue({} as any);
      vi.spyOn(DAO.distributions, "getKIDbySplit").mockResolvedValue("87654321");
      const updateKID = vi.spyOn(DAO.donations, "updateKIDById").mockResolvedValue(true);
      const updateDonor = vi.spyOn(DAO.donations, "updateDonorId").mockResolvedValue(undefined);

      await admin().donations.update({
        id: 42,
        sum: 200,
        timestamp: "2025-03-01T10:00:00Z",
        transactionCost: 0,
        distribution: { ...distribution, donorId: 8 },
      });

      expect(update.mock.calls[0][0]).toEqual(
        expect.objectContaining({ id: 42, sum: 200, transactionCost: 0 }),
      );
      expect(update.mock.calls[0][0].timestamp!.toISOString()).toBe("2025-03-01T10:00:00.000Z");
      expect(update.mock.calls[0][0].paymentId).toBeUndefined();
      expect(updateKID).toHaveBeenCalledExactlyOnceWith(42, "87654321");
      expect(updateDonor).toHaveBeenCalledExactlyOnceWith(42, 8);
    });

    it("sets a new tax unit on a fundraiser donation's own KID", async () => {
      stubLookups();
      vi.spyOn(DAO.tax, "getById").mockResolvedValue({ id: 9, donorId: 7, archived: null } as any);
      vi.spyOn(DAO.donations, "getByID").mockResolvedValue(existingDonation as any);
      vi.spyOn(DAO.donations, "update").mockResolvedValue(undefined);
      const getSplit = vi
        .spyOn(DAO.distributions, "getSplitByKID")
        .mockResolvedValue({ fundraiserTransactionId: 5, taxUnitId: null } as any);
      const causeAreas = vi
        .spyOn(DAO.distributions, "updateCauseAreas")
        .mockResolvedValue(undefined);
      const setTaxUnit = vi
        .spyOn(DAO.distributions, "setDistributionTaxUnit")
        .mockResolvedValue(undefined);
      const updateKID = vi.spyOn(DAO.donations, "updateKIDById").mockResolvedValue(true);

      await admin().donations.update({ id: 42, distribution: { ...distribution, taxUnitId: 9 } });

      expect(causeAreas).toHaveBeenCalledOnce();
      expect(setTaxUnit).toHaveBeenCalledExactlyOnceWith("12345678", 9);
      expect(updateKID).not.toHaveBeenCalled();

      // Unchanged (0 and null both mean none): the KID's tax unit is left alone
      setTaxUnit.mockClear();
      getSplit.mockResolvedValue({ fundraiserTransactionId: 5, taxUnitId: 0 } as any);
      await admin().donations.update({ id: 42, distribution });
      expect(setTaxUnit).not.toHaveBeenCalled();
    });

    it("validates references and amounts before updating", async () => {
      const lookups = stubLookups();
      vi.spyOn(DAO.donations, "getByID").mockResolvedValue(existingDonation as any);
      const update = vi.spyOn(DAO.donations, "update").mockResolvedValue(undefined);

      await expectTrpcError(admin().donations.update({ id: 42, sum: 1.234 }), "BAD_REQUEST");
      await expectTrpcError(admin().donations.update({ id: 42, sum: 0 }), "BAD_REQUEST");
      await expectTrpcError(
        admin().donations.update({ id: 42, paymentExternalRef: "x".repeat(33) }),
        "BAD_REQUEST",
      );
      await expectTrpcError(admin().donations.update({ id: 42, paymentId: 6 }), "BAD_REQUEST");
      await expectTrpcError(admin().donations.update({ id: 42, metaOwnerId: 4 }), "BAD_REQUEST");
      // Organization 3 does not belong to cause area 1
      lookups.organizations.mockResolvedValue([
        { ID: 2, cause_area_ID: 1 },
        { ID: 3, cause_area_ID: 2 },
      ] as any);
      await expectTrpcError(admin().donations.update({ id: 42, distribution }), "BAD_REQUEST");

      lookups.externalRefExists.withArgs("taken").resolves(true);
      await expectTrpcError(
        admin().donations.update({ id: 42, paymentExternalRef: "taken" }),
        "CONFLICT",
      );
      expect(update).not.toHaveBeenCalled();
    });

    it("deletes a donation", async () => {
      const remove = vi.spyOn(DAO.donations, "remove").mockReturnValue(undefined as any);
      remove.withArgs(42).resolves(true);
      remove.withArgs(43).resolves(false);

      await admin().donations.delete({ id: 42 });
      await expectTrpcError(admin().donations.delete({ id: 43 }), "NOT_FOUND");
    });

    it("refuses to delete a donation a regranting round holds", async () => {
      vi.spyOn(DAO.donations, "remove").mockRejectedValue(
        Object.assign(new Error("ER_ROW_IS_REFERENCED_2"), { errno: 1451 }),
      );
      await expectTrpcError(admin().donations.delete({ id: 42 }), "CONFLICT");
    });

    it("resends a receipt, optionally to another address", async () => {
      const getByID = vi.spyOn(DAO.donations, "getByID").mockResolvedValue(existingDonation as any);
      getByID.withArgs(43).rejects(new Error("Could not find donation with ID 43"));
      const send = vi.spyOn(mail, "sendDonationReceipt").mockResolvedValue(true);

      await admin().donations.resendReceipt({ id: 42 });
      await admin().donations.resendReceipt({ id: 42, email: "other@example.org" });

      expect(send.mock.calls[0]).toStrictEqual([42, null]);
      expect(send.mock.calls[1]).toStrictEqual([42, "other@example.org"]);

      // A failed send is a mail service error with a message the admin can show
      send.mockResolvedValue(401 as any);
      await expectTrpcError(admin().donations.resendReceipt({ id: 42 }), "BAD_GATEWAY");
      send.mockResolvedValue(false as any);
      await expectTrpcError(admin().donations.resendReceipt({ id: 42 }), "BAD_GATEWAY");

      send.mockClear();
      await expectTrpcError(admin().donations.resendReceipt({ id: 43 }), "NOT_FOUND");
      expect(send).not.toHaveBeenCalled();
    });

    it("builds log-scale histogram buckets", async () => {
      const log = vi.spyOn(DAO.donations, "getLogHistogramBySum").mockResolvedValue([]);
      await admin().donations.histogram({ scale: "log" });
      await admin().donations.histogram({ scale: "log", buckets: 30 });
      expect(log.mock.calls).toStrictEqual([[20], [30]]);
      await expectTrpcError(
        admin().donations.histogram({ scale: "log", buckets: 4 }),
        "BAD_REQUEST",
      );
      await expectTrpcError(
        admin().donations.histogram({ scale: "fixed", buckets: 20 } as any),
        "BAD_REQUEST",
      );

      const query = vi.spyOn(DAO, "query").mockReturnValue(undefined as any);
      query.mockResolvedValueOnce([
        [{ min: "-100.00", minPositive: "10.00", max: "1000000.00" }],
      ] as any);
      query.mockResolvedValueOnce([
        [
          { idx: 0, items: 2 },
          { idx: 1, items: 50 },
          { idx: 5, items: 1 },
          // Sums equal to the last edge
          { idx: 6, items: 2 },
        ],
      ] as any);
      log.mockRestore();
      const buckets = await admin().donations.histogram({ scale: "log", buckets: 5 });
      expect(query.mock.calls[1][0]).toMatch(/INTERVAL\(sum_confirmed, \?, \?, \?, \?, \?, \?\)/);
      expect(query.mock.calls[1][1]).toStrictEqual([10, 100, 1000, 10000, 100000, 1000000]);
      expect(buckets).toStrictEqual([
        { bucket: -100, bucketEnd: 10, items: 2, bar: 69 },
        { bucket: 10, bucketEnd: 100, items: 50, bar: 391 },
        { bucket: 100, bucketEnd: 1000, items: 0, bar: 0 },
        { bucket: 1000, bucketEnd: 10000, items: 0, bar: 0 },
        { bucket: 10000, bucketEnd: 100000, items: 0, bar: 0 },
        { bucket: 100000, bucketEnd: 1000000, items: 3, bar: 110 },
      ]);
    });

    it("returns histogram, transaction cost report, totals and donations by KID", async () => {
      const bucket = { bucket: "5000", items: 1, bar: 0 } as any;
      const report = { donationsCount: 1, costYTD: "1" } as any;
      const aggregate = { id: 1, orgName: "Org", chartColor: null, sum: "1.00" };
      const month = { year: 2025, month: 1, sum: "1.00" };
      vi.spyOn(DAO.donations, "getHistogramBySum").mockResolvedValue([bucket]);
      vi.spyOn(DAO.donations, "getTransactionCostsReport").mockResolvedValue(report);
      const total = vi.spyOn(DAO.donations, "getAggregateByTime").mockResolvedValue([aggregate]);
      vi.spyOn(DAO.donations, "getAggregateLastYearByMonth").mockResolvedValue([month]);
      const byKid = vi.spyOn(DAO.donations, "getAllByKID").mockResolvedValue([{ id: 1 }] as any);

      expect(await admin().donations.histogram()).toStrictEqual([
        { bucket: 5000, bucketEnd: 10000, items: 1, bar: 0 },
      ]);
      expect(await admin().donations.transactionCostsReport()).toStrictEqual(report);
      expect(
        await admin().donations.total({ fromDate: "2025-01-01", toDate: "2025-02-01" }),
      ).toStrictEqual([aggregate]);
      expect(total.mock.calls[0][0]).toBeInstanceOf(Date);
      expect(await admin().donations.totalMonthly()).toStrictEqual([month]);
      expect(await admin().donations.byKid({ kid: "123" })).toStrictEqual([{ id: 1 }]);
      expect(byKid).toHaveBeenCalledExactlyOnceWith("123");
    });
  });

  describe("register", () => {
    const base = {
      sum: 500,
      timestamp: "2025-05-05T12:00:00Z",
      paymentId: 5,
      paymentExternalRef: "ext-1",
      metaOwnerId: 3,
      sendReceipt: true,
    };
    let originalEnv: string;

    let lookups: ReturnType<typeof stubLookups>;

    beforeEach(() => {
      originalEnv = config.env;
      lookups = stubLookups();
    });

    afterEach(() => {
      config.env = originalEnv;
    });

    it("registers a donation on an existing KID and sends a receipt in production", async () => {
      config.env = "production";
      const add = vi.spyOn(DAO.donations, "add").mockResolvedValue(99);
      const send = vi.spyOn(mail, "sendDonationReceipt").mockResolvedValue(true);

      const res = await admin().donations.register({ ...base, KID: "12345678" });

      expect(res).toStrictEqual({ donationId: 99, KID: "12345678", newDistribution: false });
      const [kid, method, sum, timestamp, ref, owner] = add.mock.calls[0];
      expect([kid, method, sum, ref, owner]).toStrictEqual(["12345678", 5, 500, "ext-1", 3]);
      expect((timestamp as Date).toISOString()).toBe("2025-05-05T12:00:00.000Z");
      expect(send).toHaveBeenCalledExactlyOnceWith(99);
    });

    it("does not send receipts outside production", async () => {
      config.env = "development";
      vi.spyOn(DAO.donations, "add").mockResolvedValue(99);
      const send = vi.spyOn(mail, "sendDonationReceipt").mockResolvedValue(true);

      await admin().donations.register({ ...base, KID: "12345678" });

      expect(send).not.toHaveBeenCalled();
    });

    it("creates a distribution first when no KID is given", async () => {
      vi.spyOn(DAO.distributions, "getKIDbySplit").mockResolvedValue(null);
      vi.spyOn(donationHelpers, "createKID").mockResolvedValue("11112222");
      const addDistribution = vi.spyOn(DAO.distributions, "add").mockResolvedValue(true);
      const add = vi.spyOn(DAO.donations, "add").mockResolvedValue(100);

      const res = await admin().donations.register({
        ...base,
        sendReceipt: false,
        distribution,
      });

      expect(res).toStrictEqual({ donationId: 100, KID: "11112222", newDistribution: true });
      expect(addDistribution.mock.calls[0][0]).toEqual(
        expect.objectContaining({ kid: "11112222", donorId: 7 }),
      );
      expect(addDistribution.mock.calls[0][1]).toBe(3);
      expect(addDistribution).toHaveBeenCalledBefore(add);
      expect(add.mock.calls[0][0]).toBe("11112222");
    });

    it("requires exactly one of KID and distribution", async () => {
      const add = vi.spyOn(DAO.donations, "add").mockReturnValue(undefined as any);
      await expectTrpcError(admin().donations.register(base), "BAD_REQUEST");
      await expectTrpcError(
        admin().donations.register({ ...base, KID: "1", distribution }),
        "BAD_REQUEST",
      );
      expect(add).not.toHaveBeenCalled();
    });

    it("rejects unknown payment methods and data owners, and bad amounts and refs", async () => {
      const add = vi.spyOn(DAO.donations, "add").mockReturnValue(undefined as any);
      const register = (
        input: Partial<Parameters<ReturnType<typeof admin>["donations"]["register"]>[0]>,
      ) => admin().donations.register({ ...base, KID: "12345678", ...input });
      await expectTrpcError(register({ paymentId: 6 }), "BAD_REQUEST");
      await expectTrpcError(register({ metaOwnerId: 4 }), "BAD_REQUEST");
      await expectTrpcError(register({ sum: 10.001 }), "BAD_REQUEST");
      await expectTrpcError(register({ paymentExternalRef: "x".repeat(33) }), "BAD_REQUEST");
      expect(add).not.toHaveBeenCalled();
    });

    it("checks the distribution's references before creating it", async () => {
      lookups.donor.mockResolvedValue(null);
      const addDistribution = vi.spyOn(DAO.distributions, "add").mockReturnValue(undefined as any);
      await expectTrpcError(admin().donations.register({ ...base, distribution }), "BAD_REQUEST");
      expect(addDistribution).not.toHaveBeenCalled();
    });

    it("returns CONFLICT for an external ref used by any payment method", async () => {
      lookups.externalRefExists.withArgs("ext-1").resolves(true);
      const add = vi.spyOn(DAO.donations, "add").mockReturnValue(undefined as any);
      await expectTrpcError(admin().donations.register({ ...base, KID: "12345678" }), "CONFLICT");
      expect(add).not.toHaveBeenCalled();
    });

    it("maps duplicate external refs to CONFLICT", async () => {
      vi.spyOn(DAO.donations, "add").mockRejectedValue(
        new Error("EXISTING_DONATION | Already a donation with ExternalPaymentID"),
      );
      await expectTrpcError(admin().donations.register({ ...base, KID: "12345678" }), "CONFLICT");
    });
  });

  describe("free text query", () => {
    it("matches id, KID, donor name or email, escaping wildcards", async () => {
      const query = vi.spyOn(DAO, "query").mockReturnValue(undefined as any);
      query.mockResolvedValue([[{ abbriv: "AMF" }], []] as any);
      await DAO.donations.getAll(
        { id: "timestamp", desc: true },
        0,
        10,
        { query: " 1234 ", paymentMethodIDs: [4] },
        "NO" as any,
      );
      const donationSql = query.mock.lastCall![0] as string;
      expect(donationSql).toContain(
        "(Donations.ID = 1234 OR Donations.KID_fordeling LIKE '%1234%' OR Donors.full_name LIKE '%1234%' OR Donors.email LIKE '%1234%')",
      );
      expect(donationSql).toContain("Donations.Payment_ID IN (4)");

      await DAO.distributions.getAll(0, 10, { id: "KID", desc: true }, { query: "50%_ola" });
      const distributionSql = query.mock.lastCall![0] as string;
      expect(distributionSql).toContain(
        "(D.KID LIKE '%50\\\\%\\\\_ola%' OR Donors.full_name LIKE '%50\\\\%\\\\_ola%' OR Donors.email LIKE '%50\\\\%\\\\_ola%')",
      );
    });

    it("accepts query in the procedure filters", async () => {
      const getAll = vi.spyOn(DAO.distributions, "getAll").mockResolvedValue({
        rows: [],
        statistics: { numDistributions: 0 },
        pages: 0,
      });
      await admin().donations.distributions.list({ page: 0, limit: 10, filter: { query: " 77 " } });
      expect(getAll.mock.calls[0][3]).toStrictEqual({ query: "77" });
    });
  });

  describe("distributions", () => {
    it("lists and exports distributions", async () => {
      const getAll = vi.spyOn(DAO.distributions, "getAll").mockResolvedValue({
        rows: [{ KID: "1", full_name: "A", email: "a@b", donation_sum: "1.00", donation_count: 1 }],
        statistics: { numDistributions: 1 },
        pages: 1,
      });

      vi.spyOn(DAO.distributions, "getOrgSharesByKIDs").mockResolvedValue(new Map());
      const list = await admin().donations.distributions.list({
        page: 0,
        limit: 10,
        filter: { donor: "a" },
      });
      expect(list.pages).toBe(1);
      expect(getAll.mock.calls[0]).toStrictEqual([
        0,
        10,
        { id: "KID", desc: true },
        { donor: "a" },
      ]);

      const exported = await admin().donations.distributions.export({});
      expect(exported.csv).toBe("﻿KID,full_name,email,donation_sum,donation_count\n1,A,a@b,1.00,1");
    });

    it("gets a distribution with donor and tax unit", async () => {
      const split = { kid: "123", donorId: 7, taxUnitId: 9, causeAreas: [] };
      const getSplit = vi
        .spyOn(DAO.distributions, "getSplitByKID")
        .mockReturnValue(undefined as any);
      getSplit.withArgs("123").resolves(split as any);
      getSplit.withArgs("404").rejects(new Error("NOT FOUND | No distribution with the KID 404"));
      vi.spyOn(DAO.donors, "getByID").mockResolvedValue({ id: 7 } as any);
      vi.spyOn(DAO.tax, "getById").mockResolvedValue({ id: 9 } as any);

      const res = await admin().donations.distributions.get({ kid: "123" });
      expect(res).toStrictEqual({ ...split, donor: { id: 7, trash: false }, taxUnit: { id: 9 } });

      await expectTrpcError(admin().donations.distributions.get({ kid: "404" }), "NOT_FOUND");
    });

    it("rejects a distribution whose references do not exist", async () => {
      const lookups = stubLookups();
      const add = vi.spyOn(DAO.distributions, "add").mockReturnValue(undefined as any);
      await expectTrpcError(
        admin().donations.distributions.create({ ...distribution, metaOwnerId: 4 }),
        "BAD_REQUEST",
      );
      lookups.organizations.mockResolvedValue([{ ID: 2, cause_area_ID: 1 }] as any);
      await expectTrpcError(
        admin().donations.distributions.create({ ...distribution, metaOwnerId: 3 }),
        "BAD_REQUEST",
      );
      expect(add).not.toHaveBeenCalled();
    });

    it("creates a distribution or returns the KID of an existing split", async () => {
      stubLookups();
      const bySplit = vi.spyOn(DAO.distributions, "getKIDbySplit").mockResolvedValue("55556666");
      const add = vi.spyOn(DAO.distributions, "add").mockResolvedValue(true);

      expect(
        await admin().donations.distributions.create({ ...distribution, metaOwnerId: 3 }),
      ).toStrictEqual({ KID: "55556666", newDistribution: false });
      expect(add).not.toHaveBeenCalled();

      bySplit.mockResolvedValue(null);
      vi.spyOn(donationHelpers, "createKID").mockResolvedValue("77778888");
      expect(
        await admin().donations.distributions.create({ ...distribution, metaOwnerId: 3 }),
      ).toStrictEqual({ KID: "77778888", newDistribution: true });
      expect(add.mock.calls[0][0]).toEqual(
        expect.objectContaining({ kid: "77778888", taxUnitId: null }),
      );
      expect(add.mock.calls[0][1]).toBe(3);
    });
  });
});
