import { describe, it, afterEach, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { DAO } from "../custom_modules/DAO";
import { buildHomeTrends, trendMonths } from "../custom_modules/DAO_modules/homeTrends";
import { appRouter } from "../trpc/router";
import { createCallerFactory } from "../trpc/trpc";

const createCaller = createCallerFactory(appRouter);

const callerWith = (permissions?: string[]) =>
  createCaller({
    req: {} as Request,
    res: {} as Response,
    auth: permissions ? { permissions } : undefined,
  });

const expectCode = async (promise: Promise<unknown>, code: string) => {
  try {
    await promise;
    expect.unreachable(`expected ${code}`);
  } catch (err: any) {
    expect(err.code).toBe(code);
  }
};

const donationRow = (idx: number, sum: string, costs: string, estimatedCount = 0) => ({
  idx,
  count: 2,
  sum,
  costs,
  estimatedCosts: estimatedCount ? "1.00" : "0.00",
  estimatedCount,
});

describe("home.trends", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("trendMonths", () => {
    it("gives Oslo months, oldest first, ending with the current month", () => {
      // 29 Oct 2026 in Oslo; the month after starts on Oslo's winter time
      const months = trendMonths(new Date("2026-10-29T08:00:00Z"), 13);
      expect(months).toHaveLength(13);
      expect(months[0].month).toBe("2025-10");
      expect(months.at(-1)!.month).toBe("2026-10");
      expect(months.at(-1)!.start.toISOString()).toBe("2026-09-30T22:00:00.000Z");
      expect(months.at(-1)!.end.toISOString()).toBe("2026-10-31T23:00:00.000Z");
      expect(months.at(-1)!.firstDay).toBe("2026-10-01");
      expect(months.at(-1)!.nextFirstDay).toBe("2026-11-01");
    });

    it("puts an instant late on the last UTC day of a month in the next Oslo month", () => {
      const months = trendMonths(new Date("2026-10-31T23:30:00Z"), 2);
      expect(months.map((month) => month.month)).toStrictEqual(["2026-10", "2026-11"]);
    });
  });

  describe("buildHomeTrends", () => {
    const months = trendMonths(new Date("2026-10-29T08:00:00Z"), 3);

    it("fills empty months with zero and keeps money as decimal strings", () => {
      const trends = buildHomeTrends(months, [donationRow(2, "1500.00", "30.50")], []);
      expect(trends.months).toStrictEqual(["2026-08", "2026-09", "2026-10"]);
      expect(trends.partialLast).toBe(true);
      expect(trends.donations.points.map((point) => point.value)).toStrictEqual([
        "0.00",
        "0.00",
        "1500.00",
      ]);
      expect(trends.donations.counts).toStrictEqual([0, 0, 2]);
      expect(trends.transactionCosts.points[2]).toStrictEqual({ month: "2026-10", value: "30.50" });
      expect(trends.transactionCosts.estimated).toBe(false);
    });

    it("marks costs estimated when some were inferred from the fee rule", () => {
      const trends = buildHomeTrends(
        months,
        [donationRow(0, "100.00", "3.99", 1), donationRow(1, "100.00", "2.00", 2)],
        [],
      );
      expect(trends.transactionCosts.estimated).toBe(true);
      expect(trends.transactionCosts.note).toMatch(/^3 donations have no recorded cost/);
    });

    it("counts active agreements from those before the window, across Vipps and AvtaleGiro", () => {
      const vipps = [
        { idx: -1, started: 10, stopped: 4 },
        { idx: 0, started: 2, stopped: 0 },
        { idx: 2, started: 1, stopped: 3 },
      ];
      const avtaleGiro = [
        { idx: -1, started: 20, stopped: 5 },
        { idx: 1, started: 3, stopped: 1 },
      ];
      const trends = buildHomeTrends(months, [], [vipps, avtaleGiro]);
      // 21 before the window, then +2, +2, -2
      expect(trends.activeAgreements.points.map((point) => point.value)).toStrictEqual([
        23, 25, 23,
      ]);
      expect(trends.agreementsStarted.points.map((point) => point.value)).toStrictEqual([2, 3, 1]);
      expect(trends.agreementsStopped.points.map((point) => point.value)).toStrictEqual([0, 1, 3]);
    });

    it("reads counts that MySQL returns as strings", () => {
      const trends = buildHomeTrends(
        months,
        [],
        [[{ idx: "0", started: "4", stopped: "1" } as any]],
      );
      expect(trends.agreementsStarted.points[0].value).toBe(4);
      expect(trends.activeAgreements.points.map((point) => point.value)).toStrictEqual([3, 3, 3]);
    });
  });

  describe("procedure", () => {
    it("requires admin", async () => {
      await expectCode(callerWith().home.trends(), "UNAUTHORIZED");
      await expectCode(callerWith(["read:profile"]).home.trends(), "FORBIDDEN");
    });

    it("runs the three grouped queries and assembles 13 months", async () => {
      const donations = vi
        .spyOn(DAO.homeTrends, "getDonationMonths")
        .mockResolvedValue([donationRow(12, "250.00", "8.48")]);
      const vipps = vi
        .spyOn(DAO.homeTrends, "getVippsAgreementMonths")
        .mockResolvedValue([{ idx: -1, started: 5, stopped: 1 }]);
      const avtaleGiro = vi
        .spyOn(DAO.homeTrends, "getAvtaleGiroAgreementMonths")
        .mockResolvedValue([{ idx: 12, started: 1, stopped: 0 }]);

      const trends = await callerWith(["admin"]).home.trends();
      expect(
        donations.mock.calls.length === 1 &&
          vipps.mock.calls.length === 1 &&
          avtaleGiro.mock.calls.length === 1,
      ).toBe(true);
      expect(trends.months).toHaveLength(13);
      expect(trends.donations.points.at(-1)!.value).toBe("250.00");
      expect(trends.activeAgreements.points.at(-1)!.value).toBe(5);
      expect(trends.activeAgreements.points[0].value).toBe(4);
    });
  });
});
