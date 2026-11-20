import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import type { Request, Response } from "express";
import { DAO } from "../custom_modules/DAO";
import { parseClaimFile } from "../custom_modules/DAO_modules/avtalegiroagreements";
import { donationHelpers } from "../custom_modules/donationHelpers";
import * as avtalegiroDeletions from "../custom_modules/avtalegiro/deletions";
import * as mail from "../custom_modules/mail";
import { appRouter } from "../trpc/router";
import { createCallerFactory } from "../trpc/trpc";

const createCaller = createCallerFactory(appRouter);

const callerWith = (permissions?: string[]) =>
  createCaller({
    req: {} as Request,
    res: {} as Response,
    auth: permissions ? { permissions } : undefined,
  });

const admin = () => callerWith(["admin"]);

const expectTRPCError = async (promise: Promise<unknown>, code: string) => {
  try {
    await promise;
    expect.unreachable(`expected ${code}`);
  } catch (err: any) {
    expect(err.code).toBe(code);
  }
};

/** An agreement split: the donor is always the agreement's */
const distribution = {
  taxUnitId: null,
  causeAreas: [
    {
      id: 1,
      standardSplit: true,
      percentageShare: "100",
      organizations: [{ id: 5, percentageShare: "100" }],
    },
  ],
};

/** Stubs the lookups assertDistributionReferences checks the split against */
const stubReferences = () => ({
  donor: vi.spyOn(DAO.donors, "getByID").mockResolvedValue({ id: 12 } as any),
  organizations: vi
    .spyOn(DAO.organizations, "getByIDs")
    .mockResolvedValue([{ ID: 5, cause_area_ID: 1 }] as any),
});

describe("tRPC giro router", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("auth and input validation", () => {
    it("rejects anonymous callers", async () => {
      const stub = vi
        .spyOn(DAO.avtalegiroagreements, "getAgreementSumHistogram")
        .mockResolvedValue([]);
      await expectTRPCError(callerWith().giro.avtalegiro.histogram(), "UNAUTHORIZED");
      await expectTRPCError(callerWith().giro.avtalegiro.report(), "UNAUTHORIZED");
      expect(stub).not.toHaveBeenCalled();
    });

    it("rejects authenticated callers without the admin permission", async () => {
      const stub = vi
        .spyOn(DAO.avtalegiroagreements, "getAgreementSumHistogram")
        .mockResolvedValue([]);
      await expectTRPCError(callerWith(["read:profile"]).giro.avtalegiro.histogram(), "FORBIDDEN");
      await expectTRPCError(
        callerWith(["read:profile", "write:agreements"]).giro.avtalegiro.updateStatus({
          KID: "123",
          active: false,
        }),
        "FORBIDDEN",
      );
      expect(stub).not.toHaveBeenCalled();
    });

    it("rejects invalid input before touching the DAO", async () => {
      const agStub = vi
        .spyOn(DAO.avtalegiroagreements, "getAgreements")
        .mockReturnValue(undefined as any);
      const avStub = vi
        .spyOn(DAO.avtalegiroagreements, "updatePaymentDate")
        .mockReturnValue(undefined as any);
      await expectTRPCError(
        admin().giro.avtalegiro.list({
          page: 0,
          limit: 10,
          sort: { id: "ID; DROP TABLE Donors" as any, desc: true },
        }),
        "BAD_REQUEST",
      );
      await expectTRPCError(admin().giro.avtalegiro.list({ page: -1, limit: 10 }), "BAD_REQUEST");
      await expectTRPCError(
        admin().giro.avtalegiro.updatePaymentDate({ KID: "123", paymentDate: 29 }),
        "BAD_REQUEST",
      );
      await expectTRPCError(admin().giro.avtalegiro.missing({ date: "2026-13-01" }), "BAD_REQUEST");
      await expectTRPCError(
        admin().giro.avtalegiro.list({ page: 0, limit: 10, unknown: true } as any),
        "BAD_REQUEST",
      );
      await expectTRPCError(
        admin().giro.avtalegiro.list({ page: 0, limit: 10, filter: { amont: {} } } as any),
        "BAD_REQUEST",
      );
      await expectTRPCError(
        admin().giro.avtalegiro.updateAmount({ KID: "123", amount: 100.5 }),
        "BAD_REQUEST",
      );
      await expectTRPCError(
        admin().giro.avtalegiro.updateAmount({ KID: "123", amount: 21_474_837 }),
        "BAD_REQUEST",
      );
      expect(agStub).not.toHaveBeenCalled();
      expect(avStub).not.toHaveBeenCalled();
    });
  });

  describe("avtalegiro", () => {
    const agreement = {
      id: 1,
      KID: "002345678901234",
      amount: 50000,
      paymentDate: 5,
      notice: true,
    };
    let changeStub: MockInstance;

    beforeEach(() => {
      changeStub = vi.spyOn(mail, "sendAvtaleGiroChange").mockResolvedValue(false);
    });

    it("lists agreements with converted filter dates and boolean flags", async () => {
      const row = {
        ID: 1,
        active: 1 as const,
        KID: "123",
        payment_date: 5,
        created: new Date(),
        cancelled: null,
        last_updated: new Date(),
        notice: 0 as const,
        full_name: "Ola",
        amount: 500,
      };
      const statistics = { numAgreements: 1, sumAgreements: 500, avgAgreement: 500 };
      const stub = vi
        .spyOn(DAO.avtalegiroagreements, "getAgreements")
        .mockResolvedValue({ rows: [row], statistics, pages: 1 });
      const res = await admin().giro.avtalegiro.list({
        page: 2,
        limit: 25,
        sort: { id: "paymentDate", desc: false },
        filter: {
          amount: { from: 100 },
          created: { from: "2026-01-02" },
          statuses: [1],
          donor: "Ola",
        },
      });
      expect(res).toStrictEqual({
        rows: [{ ...row, active: true, notice: false }],
        statistics,
        pages: 1,
      });
      const [sort, page, limit, filter] = stub.mock.calls[0];
      expect(sort).toStrictEqual({ id: "paymentDate", desc: false });
      expect(page).toBe(2);
      expect(limit).toBe(25);
      expect(filter!.amount).toStrictEqual({ from: 100 });
      expect(filter!.createdRange).toStrictEqual({
        from: new Date("2026-01-01T23:00:00Z"),
        before: undefined,
      });
      expect(filter!.statuses).toStrictEqual([1]);
    });

    it("exports agreements as csv", async () => {
      const stub = vi.spyOn(DAO.avtalegiroagreements, "getAgreements").mockResolvedValue({
        rows: [
          {
            ID: 1,
            KID: "123",
            amount: 500,
            full_name: "Ola, Nordmann",
            active: 1,
            notice: 0,
          } as any,
        ],
        statistics: { numAgreements: 1, sumAgreements: 500, avgAgreement: 500 },
        pages: 1,
      });
      const res = await admin().giro.avtalegiro.export({});
      expect(stub.mock.calls[0][2]).toBe(Number.MAX_SAFE_INTEGER);
      expect(res.filename).toMatch(/^avtalegiro-agreements-.*\.csv$/);
      // Flags are booleans like the list (and the AutoGiro export)
      expect(res.csv).toBe(
        '\uFEFFID,KID,amount,full_name,active,notice\n1,123,500,"Ola, Nordmann",Yes,No',
      );
    });

    it("gets an agreement with its distribution, amount in NOK and boolean flags", async () => {
      vi.spyOn(DAO.avtalegiroagreements, "getAgreement").mockResolvedValue({
        ID: 7,
        KID: "123",
        amount: "500",
        active: 1,
        notice: 0,
        donorId: 12,
      } as any);
      vi.spyOn(DAO.distributions, "getSplitByKID").mockResolvedValue({ kid: "123" } as any);
      const res = await admin().giro.avtalegiro.get({ id: 7 });
      expect(res).toEqual(
        expect.objectContaining({
          ID: 7,
          KID: "123",
          amount: 500,
          active: true,
          notice: false,
          donorId: 12,
          distribution: { kid: "123" },
        }),
      );
    });

    it("returns NOT_FOUND for a missing agreement", async () => {
      vi.spyOn(DAO.avtalegiroagreements, "getAgreement").mockResolvedValue(false);
      await expectTRPCError(admin().giro.avtalegiro.get({ id: 7 }), "NOT_FOUND");
    });

    it("returns an agreement's payments across its KIDs, NOT_FOUND when missing", async () => {
      const payments = {
        KIDs: ["111", "222"],
        donations: [
          {
            id: 2,
            sum: "100.00",
            transactionCost: null,
            timestamp: new Date("2026-02-01"),
            paymentMethod: "AvtaleGiro",
            KID: "111",
          },
          {
            id: 1,
            sum: "100.00",
            transactionCost: null,
            timestamp: new Date("2026-01-01"),
            paymentMethod: "AvtaleGiro",
            KID: "222",
          },
        ],
      };
      const stub = vi
        .spyOn(DAO.avtalegiroagreements, "getPaymentsByAgreementId")
        .mockImplementation(async (agreementId) => (agreementId === 7 ? payments : null));

      expect(await admin().giro.avtalegiro.payments({ agreementId: 7 })).toStrictEqual(payments);
      await expectTRPCError(admin().giro.avtalegiro.payments({ agreementId: 8 }), "NOT_FOUND");
      await expectTRPCError(
        admin().giro.avtalegiro.payments({ agreementId: "7" } as any),
        "BAD_REQUEST",
      );
      expect(stub).toHaveBeenCalledTimes(2);
    });

    it("follows the replaced distribution chain for an agreement's KIDs", async () => {
      const query = vi.spyOn(DAO, "query").mockReturnValue(undefined as any);
      query.mockResolvedValueOnce([
        [
          { KID: "111", depth: 0 },
          { KID: "222", depth: 1 },
        ],
      ] as any);
      query.mockResolvedValueOnce([[]] as any);

      const result = await DAO.avtalegiroagreements.getPaymentsByAgreementId(7);

      expect(query.mock.calls[0][0]).toMatch(/WITH RECURSIVE/);
      expect(query.mock.calls[0][0]).toMatch(
        /INNER JOIN agreement_kids K ON R.Original_AvtaleGiro_KID = K.KID/,
      );
      expect(query.mock.calls[0][1]).toStrictEqual([7]);
      expect(query.mock.calls[1][1]).toStrictEqual([["111", "222"]]);
      expect(result).toStrictEqual({ KIDs: ["111", "222"], donations: [] });

      query.mockResolvedValueOnce([[]] as any);
      expect(await DAO.avtalegiroagreements.getPaymentsByAgreementId(8)).toBe(null);
      expect(query).toHaveBeenCalledTimes(3);
    });

    it("returns donations, histogram, report and validation", async () => {
      const donation = { id: 1, KID: "123", sum: "1.00" } as any;
      const bucket = { bucket: 0, items: 1, bar: 0 };
      const validation = { date: 5, expected: "500", actual: "0", diff: "-500" };
      vi.spyOn(DAO.avtalegiroagreements, "getDonationsByKID").mockImplementation(((KID) =>
        KID === "123" ? Promise.resolve([donation]) : undefined) as any);
      vi.spyOn(DAO.avtalegiroagreements, "getAgreementSumHistogram").mockResolvedValue([bucket]);
      vi.spyOn(DAO.avtalegiroagreements, "getAgreementReport").mockResolvedValue({
        activeAgreementCount: 3,
        averageAgreementSum: "752",
        sumStoppedThisMonth: null,
      } as any);
      vi.spyOn(DAO.avtalegiroagreements, "getValidationTable").mockResolvedValue([validation]);
      expect(await admin().giro.avtalegiro.donations({ KID: "123" })).toStrictEqual([donation]);
      expect(await admin().giro.avtalegiro.histogram()).toStrictEqual([bucket]);
      expect(await admin().giro.avtalegiro.report()).toStrictEqual({
        activeAgreementCount: 3,
        averageAgreementSum: 752,
        totalAgreementSum: 0,
        medianAgreementSum: 0,
        draftedThisMonth: 0,
        sumDraftedThisMonth: 0,
        activatedThisMonth: 0,
        sumActivatedThisMonth: 0,
        stoppedThisMonth: 0,
        sumStoppedThisMonth: 0,
      });
      expect(await admin().giro.avtalegiro.validation()).toStrictEqual([validation]);
    });

    it("returns missing, received and expected for a date", async () => {
      const missing = vi
        .spyOn(DAO.avtalegiroagreements, "getMissingForDate")
        .mockResolvedValue([{ ID: 1, amount: 500, active: 1 } as any]);
      const received = vi
        .spyOn(DAO.avtalegiroagreements, "getRecievedDonationsForDate")
        .mockResolvedValue([{ id: 2 } as any]);
      const expected = vi
        .spyOn(DAO.avtalegiroagreements, "getExpectedDonationsForDate")
        .mockResolvedValue([{ ID: 3, amount: 50050, active: 0, notice: 1 } as any]);
      // No claim file logged for the date
      vi.spyOn(DAO.avtalegiroagreements, "getClaimedAgreementsForDate").mockResolvedValue(null);
      expect(await admin().giro.avtalegiro.missing({ date: "2026-10-05" })).toStrictEqual([
        { ID: 1, amount: 500, active: true },
      ]);
      expect(await admin().giro.avtalegiro.received({ date: "2026-10-05" })).toStrictEqual([
        { id: 2 },
      ]);
      // øre in the DAO, NOK out
      expect(await admin().giro.avtalegiro.expected({ date: "2026-10-05" })).toStrictEqual([
        { ID: 3, amount: 500.5, active: false, notice: true, amountSource: "agreement" },
      ]);
      for (const stub of [missing, received, expected]) {
        const date: Date = stub.mock.calls[0][0];
        expect([date.getFullYear(), date.getMonth(), date.getDate()]).toStrictEqual([2026, 9, 5]);
      }
    });

    it("uses the claimed amounts for past dates with a logged claim file", async () => {
      const claimed = vi
        .spyOn(DAO.avtalegiroagreements, "getClaimedAgreementsForDate")
        .mockResolvedValue([{ ID: 3, amount: 40000, active: 1, notice: 0 } as any]);
      const current = vi
        .spyOn(DAO.avtalegiroagreements, "getExpectedDonationsForDate")
        .mockResolvedValue([]);
      expect(await admin().giro.avtalegiro.expected({ date: "2025-10-05" })).toStrictEqual([
        { ID: 3, amount: 400, active: true, notice: false, amountSource: "claim" },
      ]);
      expect(claimed.mock.calls[0][0]).toBe("2025-10-05");
      expect(current).not.toHaveBeenCalled();

      // Today and later: the agreements' current amounts
      await admin().giro.avtalegiro.expected({ date: "2999-01-01" });
      expect(claimed).toHaveBeenCalledOnce();
      expect(current).toHaveBeenCalledOnce();
    });

    it("parses claim lines of a DIRREM file for one due date", () => {
      const claim = (date: string, amount: number, kid: string) =>
        `NY2102300000001${date}`.padEnd(32, "0") +
        String(amount).padStart(17, "0") +
        kid.padStart(25, " ") +
        "000000";
      const file = [
        "NY000010".padEnd(80, "0"),
        "NY210020".padEnd(80, "0"),
        claim("201026", 40000, "000123456789012"),
        "NY210231000000100000OLANORDMANN".padEnd(80, "0"),
        claim("211026", 10000, "000999999999999"),
      ].join("\n");
      expect(parseClaimFile(file, "201026")).toStrictEqual([
        { KID: "000123456789012", amount: 40000 },
      ]);
    });

    it("updates the amount in øre and notifies the donor", async () => {
      vi.spyOn(DAO.avtalegiroagreements, "getByKID").mockResolvedValue(agreement);
      const stub = vi.spyOn(DAO.avtalegiroagreements, "updateAmount").mockResolvedValue(true);
      expect(await admin().giro.avtalegiro.updateAmount({ KID: "123", amount: 300 })).toBe(true);
      expect(stub).toHaveBeenCalledWith("123", 30000);
      expect(changeStub).toHaveBeenCalledWith("123", "AMOUNT", "300");
    });

    it("returns NOT_FOUND when updating an unknown agreement", async () => {
      vi.spyOn(DAO.avtalegiroagreements, "getByKID").mockResolvedValue(null);
      const stub = vi
        .spyOn(DAO.avtalegiroagreements, "updateAmount")
        .mockReturnValue(undefined as any);
      await expectTRPCError(
        admin().giro.avtalegiro.updateAmount({ KID: "123", amount: 300 }),
        "NOT_FOUND",
      );
      expect(stub).not.toHaveBeenCalled();
    });

    it("deactivates an agreement and sends the cancellation notice", async () => {
      vi.spyOn(DAO.avtalegiroagreements, "getByKID").mockResolvedValue(agreement);
      const stub = vi.spyOn(DAO.avtalegiroagreements, "setActive").mockResolvedValue(true);
      expect(await admin().giro.avtalegiro.updateStatus({ KID: "123", active: false })).toBe(true);
      expect(stub).toHaveBeenCalledWith("123", 0);
      expect(changeStub).toHaveBeenCalledWith("123", "CANCELLED");
    });

    it("requests deletion of sent claims when deactivating, like Min side", async () => {
      vi.spyOn(DAO.avtalegiroagreements, "getByKID").mockResolvedValue(agreement);
      const setActive = vi.spyOn(DAO.avtalegiroagreements, "setActive").mockResolvedValue(true);
      const deletion = vi
        .spyOn(avtalegiroDeletions, "requestDeletionOfUpcomingCharges")
        .mockResolvedValue({ deletable: [], tooLate: [] });
      await admin().giro.avtalegiro.updateStatus({ KID: "123", active: false });
      expect(deletion).toHaveBeenCalledOnce();
      expect(deletion.mock.calls[0][0]).toBe("123");
      expect(setActive).toHaveBeenCalledBefore(deletion);
    });

    it("activates an agreement without a cancellation notice", async () => {
      vi.spyOn(DAO.avtalegiroagreements, "getByKID").mockResolvedValue(agreement);
      const stub = vi.spyOn(DAO.avtalegiroagreements, "setActive").mockResolvedValue(true);
      const restore = vi
        .spyOn(DAO.avtalegirocharges, "restoreDeletionRequestsByKID")
        .mockResolvedValue(undefined);
      await admin().giro.avtalegiro.updateStatus({ KID: "123", active: true });
      expect(stub).toHaveBeenCalledWith("123", 1);
      expect(restore).toHaveBeenCalledExactlyOnceWith("123");
      expect(changeStub).not.toHaveBeenCalled();
    });

    it("updates the payment date and notifies the donor", async () => {
      vi.spyOn(DAO.avtalegiroagreements, "getByKID").mockResolvedValue(agreement);
      const stub = vi.spyOn(DAO.avtalegiroagreements, "updatePaymentDate").mockResolvedValue(true);
      await admin().giro.avtalegiro.updatePaymentDate({ KID: "123", paymentDate: 0 });
      expect(stub).toHaveBeenCalledWith("123", 0);
      expect(changeStub).toHaveBeenCalledWith("123", "CHARGEDAY", 0);
    });

    it("replaces the distribution under a new historic KID, keeping the donor", async () => {
      stubReferences();
      vi.spyOn(DAO.avtalegiroagreements, "getByKID").mockResolvedValue(agreement);
      vi.spyOn(DAO.distributions, "getSplitByKID").mockResolvedValue({
        kid: "123",
        donorId: 12,
      } as any);
      vi.spyOn(donationHelpers, "createAvtaleGiroKID").mockResolvedValue("999");
      const stub = vi
        .spyOn(DAO.avtalegiroagreements, "replaceDistribution")
        .mockResolvedValue(true);
      await admin().giro.avtalegiro.updateDistribution({ KID: "123", distribution });
      expect(stub.mock.calls[0][0]).toStrictEqual({ kid: "123", donorId: 12 });
      expect(stub.mock.calls[0][1]).toBe("999");
      expect(stub.mock.calls[0][2]).toEqual(expect.objectContaining({ donorId: 12 }));
      expect(changeStub).toHaveBeenCalledWith("123", "SHARES");
    });

    it("rejects a split with an organization outside its cause area", async () => {
      const refs = stubReferences();
      refs.organizations.mockResolvedValue([{ ID: 5, cause_area_ID: 2 }] as any);
      vi.spyOn(DAO.avtalegiroagreements, "getByKID").mockResolvedValue(agreement);
      vi.spyOn(DAO.distributions, "getSplitByKID").mockResolvedValue({
        kid: "123",
        donorId: 12,
      } as any);
      const stub = vi
        .spyOn(DAO.avtalegiroagreements, "replaceDistribution")
        .mockReturnValue(undefined as any);
      await expectTRPCError(
        admin().giro.avtalegiro.updateDistribution({ KID: "123", distribution }),
        "BAD_REQUEST",
      );
      await expectTRPCError(
        admin().giro.avtalegiro.updateDistribution({
          KID: "123",
          distribution: { ...distribution, donorId: 13 } as any,
        }),
        "BAD_REQUEST",
      );
      expect(stub).not.toHaveBeenCalled();
    });

    it("rejects an invalid distribution with BAD_REQUEST", async () => {
      const stub = vi
        .spyOn(DAO.avtalegiroagreements, "replaceDistribution")
        .mockReturnValue(undefined as any);
      await expectTRPCError(
        admin().giro.avtalegiro.updateDistribution({
          KID: "123",
          distribution: {
            ...distribution,
            causeAreas: [{ ...distribution.causeAreas[0], percentageShare: "50" }],
          },
        }),
        "BAD_REQUEST",
      );
      expect(stub).not.toHaveBeenCalled();
    });
  });
});
