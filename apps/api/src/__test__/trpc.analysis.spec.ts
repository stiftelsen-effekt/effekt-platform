import { describe, it, afterEach, beforeEach, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { DAO } from "../custom_modules/DAO";
import { AnalysisOverviewTotals, buildOverview } from "../custom_modules/DAO_modules/analysis";
import { clearAnalysisCache } from "../trpc/routers/analysis";
import { appRouter } from "../trpc/router";
import { createCallerFactory } from "../trpc/trpc";

/**
 * The analysis router: the overview and pledges (tilsagn). Ported from Nicolai's REST tests
 * (effekt-backend #825 analysis.spec.ts, #826 pledges.spec.ts): buildOverview unchanged, the
 * route and parsePledgeInput cases as procedure calls.
 */
const createCaller = createCallerFactory(appRouter);

const callerWith = (permissions?: string[]) =>
  createCaller({
    req: {} as Request,
    res: {} as Response,
    auth: permissions ? { permissions } : undefined,
  });

const admin = () => callerWith(["admin"]);

const expectCode = async (promise: Promise<unknown>, code: string) => {
  try {
    await promise;
    expect.unreachable(`expected ${code}`);
  } catch (err: any) {
    expect(err.code).toBe(code);
  }
};

const totals: AnalysisOverviewTotals = {
  year: 2026,
  thisYearSum: 1_234_567.89,
  throughTimeMeasured: 171_237_465.4,
  throughTimeDonations: 1000,
  throughTimeFrom: new Date("2015-06-01T10:00:00Z"),
  openPledgesSum: 27_350_000,
  openPledgesCount: 3,
};

const pledge = {
  id: 1,
  sum: 1_350_000,
  decidedDate: "2026-10-23",
  receivedDate: null,
  donationId: null,
};

describe("analysis", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("buildOverview", () => {
    it("keeps measured and pledges apart, and adds them only in withPledges", () => {
      const overview = buildOverview(totals);
      expect(overview.throughTime.measured).toBe(171_237_465);
      expect(overview.pledges.open).toBe(27_350_000);
      expect(overview.withPledges.sum).toBe(198_587_465);
      expect(overview.thisYear).toStrictEqual({ year: 2026, sum: 1_234_568 });
      expect(overview.throughTime.from).toBe("2015-06-01");
    });

    it("counts down to the milestone with pledges", () => {
      const overview = buildOverview(totals, 200_000_000);
      expect(overview.withPledges.remaining).toBe(1_412_535);
      expect(overview.withPledges.passed).toBe(false);
    });

    it("stops at zero once the milestone is passed", () => {
      const overview = buildOverview({ ...totals, openPledgesSum: 30_000_000 }, 200_000_000);
      expect(overview.withPledges.remaining).toBe(0);
      expect(overview.withPledges.passed).toBe(true);
    });

    it("handles no pledges and no donations", () => {
      const overview = buildOverview({
        ...totals,
        thisYearSum: 0,
        throughTimeMeasured: 0,
        throughTimeDonations: 0,
        throughTimeFrom: null,
        openPledgesSum: 0,
        openPledgesCount: 0,
      });
      expect(overview.withPledges.sum).toBe(0);
      expect(overview.throughTime.from).toBeNull();
    });
  });

  describe("access", () => {
    it("rejects anonymous callers and non-admins", async () => {
      const stub = vi.spyOn(DAO.analysis, "getOverviewTotals").mockResolvedValue(totals);
      const add = vi.spyOn(DAO.pledges, "add").mockResolvedValue(1);
      await expectCode(callerWith().analysis.overview(), "UNAUTHORIZED");
      await expectCode(callerWith(["read:profile"]).analysis.overview(), "FORBIDDEN");
      await expectCode(
        callerWith(["read:profile"]).analysis.pledges.create({ sum: 1, decidedDate: "2026-10-23" }),
        "FORBIDDEN",
      );
      expect(stub).not.toHaveBeenCalled();
      expect(add).not.toHaveBeenCalled();
    });
  });

  describe("overview", () => {
    it("returns the same numbers as GET /analysis/overview, money as decimal strings", async () => {
      vi.spyOn(DAO.analysis, "getOverviewTotals").mockResolvedValue(totals);
      expect(await admin().analysis.overview()).toStrictEqual({
        thisYear: { year: 2026, sum: "1234568" },
        throughTime: { measured: "171237465", donations: 1000, from: "2015-06-01" },
        pledges: { open: "27350000", count: 3 },
        withPledges: {
          sum: "198587465",
          milestone: "200000000",
          remaining: "1412535",
          passed: false,
        },
      });
    });

    it("passes database errors on", async () => {
      vi.spyOn(DAO.analysis, "getOverviewTotals").mockRejectedValue(new Error("db down"));
      await expectCode(admin().analysis.overview(), "INTERNAL_SERVER_ERROR");
    });
  });

  describe("ticker", () => {
    // The ticker's estimate: 90 days of agreement donations, the newest dated 8 November
    // (agreement donations are dated at 00:00 UTC, so all of the 8th is registered)
    const flow = { sum: 3_110_400, latest: new Date("2026-11-08T00:00:00Z") };
    // This year so far: 14.76 million kr in gifts under 100 000 kr, 7.8 million in larger ones
    const bySize = { year: 2026, small: 14_763_184.4, large: 7_806_266 };
    beforeEach(() => {
      vi.spyOn(DAO.analysis, "getAgreementFlow").mockResolvedValue(flow);
      vi.spyOn(DAO.analysis, "getYearBySize").mockResolvedValue(bySize);
    });
    afterEach(() => clearAnalysisCache());

    it("gives anyone the money received, the agreements' flow and the year, no pledges", async () => {
      vi.spyOn(DAO.analysis, "getOverviewTotals").mockResolvedValue(totals);
      expect(await callerWith().analysis.ticker()).toStrictEqual({
        // The measured total only: the 27 350 000 kr in open pledges are left out
        sum: "171237465",
        // 3 110 400 kr over 90 days = 0.4 kr a second
        // and it starts after the newest day, which is already in the sum
        estimate: { perSecond: 0.4, since: "2026-11-09T00:00:00.000Z" },
        // Whole kroner, against the analysis pipeline's goals for 2026
        year: {
          year: 2026,
          small: "14763184",
          large: "7806266",
          goal: { small: "28000000", large: "50000000" },
        },
      });
    });

    it("has no goal for a year without one", async () => {
      vi.spyOn(DAO.analysis, "getOverviewTotals").mockResolvedValue(totals);
      vi.mocked(DAO.analysis.getYearBySize).mockResolvedValue({ ...bySize, year: 2031 });
      expect((await callerWith().analysis.ticker()).year.goal).toBe(null);
    });

    it("has no estimate without agreement donations in the last 90 days", async () => {
      vi.spyOn(DAO.analysis, "getOverviewTotals").mockResolvedValue(totals);
      vi.mocked(DAO.analysis.getAgreementFlow).mockResolvedValue({ sum: 0, latest: null });
      expect((await callerWith().analysis.ticker()).estimate).toBe(null);
    });

    it("asks the database at most once a minute", async () => {
      vi.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
      const stub = vi.spyOn(DAO.analysis, "getOverviewTotals").mockResolvedValue(totals);
      await callerWith().analysis.ticker();
      await callerWith().analysis.ticker();
      expect(stub).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(61_000);
      await callerWith().analysis.ticker();
      expect(stub).toHaveBeenCalledTimes(2);
    });

    it("doesn't keep a failed load", async () => {
      const stub = vi.spyOn(DAO.analysis, "getOverviewTotals").mockReturnValue(undefined as any);
      stub.mockRejectedValueOnce(new Error("db down"));
      stub.mockResolvedValueOnce(totals);
      await expectCode(callerWith().analysis.ticker(), "INTERNAL_SERVER_ERROR");
      expect((await callerWith().analysis.ticker()).sum).toBe("171237465");
    });
  });

  describe("pledges", () => {
    it("lists pledges with the sum as a decimal string", async () => {
      vi.spyOn(DAO.pledges, "getAll").mockResolvedValue([pledge, { ...pledge, id: 2, sum: 100.5 }]);
      expect(await admin().analysis.pledges.list()).toStrictEqual([
        { ...pledge, sum: "1350000.00" },
        { ...pledge, id: 2, sum: "100.50" },
      ]);
    });

    it("adds an open pledge with only sum and decided date", async () => {
      const add = vi.spyOn(DAO.pledges, "add").mockResolvedValue(1);
      vi.spyOn(DAO.pledges, "getById").mockResolvedValue(pledge);
      const created = await admin().analysis.pledges.create({
        sum: 1_350_000,
        decidedDate: "2026-10-23",
      });
      expect(add.mock.calls[0][0]).toStrictEqual({
        sum: 1_350_000,
        decidedDate: "2026-10-23",
        receivedDate: null,
        donationId: null,
      });
      expect(created).toStrictEqual({ ...pledge, sum: "1350000.00" });
    });

    it("rejects any other field, so nothing about the giver is stored", async () => {
      const add = vi.spyOn(DAO.pledges, "add").mockResolvedValue(1);
      await expectCode(
        admin().analysis.pledges.create({
          sum: 100,
          decidedDate: "2026-10-23",
          name: "Someone",
        } as never),
        "BAD_REQUEST",
      );
      expect(add).not.toHaveBeenCalled();
    });

    it("accepts a received pledge with a donation", async () => {
      vi.spyOn(DAO.pledges, "donationExists").mockResolvedValue(true);
      const add = vi.spyOn(DAO.pledges, "add").mockResolvedValue(4);
      vi.spyOn(DAO.pledges, "getById").mockResolvedValue({
        ...pledge,
        id: 4,
        sum: 100.5,
        receivedDate: "2026-11-02",
        donationId: 42,
      });
      await admin().analysis.pledges.create({
        sum: 100.5,
        decidedDate: "2026-10-23",
        receivedDate: "2026-11-02",
        donationId: 42,
      });
      expect(add.mock.calls[0][0]).toEqual(
        expect.objectContaining({ receivedDate: "2026-11-02", donationId: 42 }),
      );
    });

    it("rejects invalid input without touching the database", async () => {
      const add = vi.spyOn(DAO.pledges, "add").mockResolvedValue(1);
      const invalid: unknown[] = [
        { sum: 0, decidedDate: "2026-10-23" },
        { sum: -5, decidedDate: "2026-10-23" },
        { sum: 10.555, decidedDate: "2026-10-23" },
        { sum: "abc", decidedDate: "2026-10-23" },
        { sum: 100, decidedDate: "23.10.2026" },
        { sum: 100, decidedDate: "2026-02-30" },
        { sum: 100 },
        { sum: 100, decidedDate: "2026-10-23", receivedDate: "soon" },
        // A donation without a received date
        { sum: 100, decidedDate: "2026-10-23", donationId: 42 },
      ];
      for (const input of invalid) {
        await expectCode(admin().analysis.pledges.create(input as never), "BAD_REQUEST");
      }
      expect(add).not.toHaveBeenCalled();
    });

    it("says which field is wrong", async () => {
      try {
        await admin().analysis.pledges.create({
          sum: 10.555,
          decidedDate: "2026-10-23",
          donationId: 42,
        });
        expect.unreachable("expected BAD_REQUEST");
      } catch (err: any) {
        expect(err.code).toBe("BAD_REQUEST");
        expect(err.message).toContain("at most two decimals");
      }
    });

    it("rejects a donation that does not exist", async () => {
      vi.spyOn(DAO.pledges, "getById").mockResolvedValue(pledge);
      vi.spyOn(DAO.pledges, "donationExists").mockResolvedValue(false);
      const update = vi.spyOn(DAO.pledges, "update").mockReturnValue(undefined as any);
      const add = vi.spyOn(DAO.pledges, "add").mockReturnValue(undefined as any);
      await expectCode(
        admin().analysis.pledges.markReceived({
          id: 1,
          receivedDate: "2026-11-02",
          donationId: 999,
        }),
        "BAD_REQUEST",
      );
      await expectCode(
        admin().analysis.pledges.create({
          sum: 100,
          decidedDate: "2026-10-23",
          receivedDate: "2026-11-02",
          donationId: 999,
        }),
        "BAD_REQUEST",
      );
      expect(update).not.toHaveBeenCalled();
      expect(add).not.toHaveBeenCalled();
    });

    it("marks a pledge as received with a donation, keeping its sum and decision", async () => {
      vi.spyOn(DAO.pledges, "donationExists").mockResolvedValue(true);
      const update = vi.spyOn(DAO.pledges, "update").mockResolvedValue(true);
      vi.spyOn(DAO.pledges, "getById")
        .mockReturnValue(undefined as any)
        .mockResolvedValueOnce(pledge)
        .mockResolvedValueOnce({ ...pledge, receivedDate: "2026-11-02", donationId: 42 });
      const result = await admin().analysis.pledges.markReceived({
        id: 1,
        receivedDate: "2026-11-02",
        donationId: 42,
      });
      expect(update.mock.calls[0]).toStrictEqual([
        1,
        { sum: 1_350_000, decidedDate: "2026-10-23", receivedDate: "2026-11-02", donationId: 42 },
      ]);
      expect(result).toEqual(
        expect.objectContaining({ receivedDate: "2026-11-02", donationId: 42 }),
      );
    });

    it("marks a pledge as received without a donation", async () => {
      const exists = vi.spyOn(DAO.pledges, "donationExists").mockResolvedValue(true);
      const update = vi.spyOn(DAO.pledges, "update").mockResolvedValue(true);
      vi.spyOn(DAO.pledges, "getById").mockResolvedValue(pledge);
      await admin().analysis.pledges.markReceived({ id: 1, receivedDate: "2026-11-02" });
      expect(update.mock.calls[0][1]).toEqual(
        expect.objectContaining({ receivedDate: "2026-11-02", donationId: null }),
      );
      expect(exists).not.toHaveBeenCalled();
    });

    it("lowers the sum after a partial payment and leaves the rest as it was", async () => {
      const update = vi.spyOn(DAO.pledges, "update").mockResolvedValue(true);
      vi.spyOn(DAO.pledges, "getById").mockResolvedValue(pledge);
      await admin().analysis.pledges.update({ id: 1, sum: 850_000.5 });
      expect(update.mock.calls[0]).toStrictEqual([
        1,
        { sum: 850_000.5, decidedDate: "2026-10-23", receivedDate: null, donationId: null },
      ]);
      await expectCode(admin().analysis.pledges.update({ id: 1 }), "BAD_REQUEST");
      await expectCode(admin().analysis.pledges.update({ id: 1, sum: 0 }), "BAD_REQUEST");
    });

    it("reopens a received pledge and drops the donation link", async () => {
      const update = vi.spyOn(DAO.pledges, "update").mockResolvedValue(true);
      vi.spyOn(DAO.pledges, "getById").mockResolvedValue({
        ...pledge,
        receivedDate: "2026-11-02",
        donationId: 42,
      });
      await admin().analysis.pledges.reopen({ id: 1 });
      expect(update.mock.calls[0][1]).toStrictEqual({
        sum: 1_350_000,
        decidedDate: "2026-10-23",
        receivedDate: null,
        donationId: null,
      });
    });

    it("returns NOT_FOUND for an unknown pledge", async () => {
      vi.spyOn(DAO.pledges, "getById").mockResolvedValue(null);
      vi.spyOn(DAO.pledges, "remove").mockResolvedValue(false);
      const update = vi.spyOn(DAO.pledges, "update").mockReturnValue(undefined as any);
      await expectCode(admin().analysis.pledges.update({ id: 77, sum: 100 }), "NOT_FOUND");
      await expectCode(
        admin().analysis.pledges.markReceived({ id: 77, receivedDate: "2026-11-02" }),
        "NOT_FOUND",
      );
      await expectCode(admin().analysis.pledges.reopen({ id: 77 }), "NOT_FOUND");
      await expectCode(admin().analysis.pledges.delete({ id: 77 }), "NOT_FOUND");
      expect(update).not.toHaveBeenCalled();
    });

    it("deletes a pledge", async () => {
      const remove = vi.spyOn(DAO.pledges, "remove").mockResolvedValue(true);
      expect(await admin().analysis.pledges.delete({ id: 1 })).toStrictEqual({ id: 1 });
      expect(remove.mock.calls[0][0]).toBe(1);
    });
  });
});
