import { describe, it, afterEach, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { DAO } from "../custom_modules/DAO";
import type { DistributionOrgShare } from "../custom_modules/DAO_modules/distributions";
import { appRouter } from "../trpc/router";
import { createCallerFactory } from "../trpc/trpc";

const createCaller = createCallerFactory(appRouter);

const admin = () =>
  createCaller({
    req: {} as Request,
    res: {} as Response,
    auth: { permissions: ["admin"] },
  });

const split: DistributionOrgShare[] = [
  {
    organizationId: 3,
    organizationName: "GiveDirectly",
    causeAreaId: 1,
    chartColor: "chart-3",
    share: "62.500000",
  },
  {
    organizationId: 5,
    organizationName: "The Humane League",
    causeAreaId: 2,
    chartColor: null,
    share: "37.500000",
  },
];

describe("tRPC list procedures with organization splits", () => {
  afterEach(() => vi.restoreAllMocks());

  it("adds orgSplit to each distributions row from one batched query per page", async () => {
    vi.spyOn(DAO.distributions, "getAll").mockResolvedValue({
      rows: [
        {
          KID: "111",
          full_name: "Ola",
          email: "o@example.org",
          donation_sum: "10",
          donation_count: 1,
        },
        {
          KID: "222",
          full_name: "Kari",
          email: "k@example.org",
          donation_sum: "0",
          donation_count: 0,
        },
      ] as any,
      statistics: { numDistributions: 2 },
      pages: 1,
    });
    const getShares = vi
      .spyOn(DAO.distributions, "getOrgSharesByKIDs")
      .mockResolvedValue(new Map([["111", split]]));

    const result = await admin().donations.distributions.list({ page: 0, limit: 10 });

    expect(getShares).toHaveBeenCalledOnce();
    expect(getShares.mock.calls[0][0]).toStrictEqual(["111", "222"]);
    expect(result.rows.map((row: any) => row.orgSplit)).toStrictEqual([split, []]);
    expect(result.pages).toBe(1);
    expect(result.statistics).toStrictEqual({ numDistributions: 2 });
  });

  it("adds orgSplit to agreements rows keyed by KID", async () => {
    vi.spyOn(DAO.agreements, "getList").mockResolvedValue({
      rows: [{ KID: "333", id: "1", provider: "avtalegiro" }] as any,
      statistics: { count: 1, activeCount: 1, activeMonthlySum: 0 },
      pages: 1,
    });
    const getShares = vi
      .spyOn(DAO.distributions, "getOrgSharesByKIDs")
      .mockResolvedValue(new Map([["333", split]]));

    const result = await admin().agreements.list({ page: 0, limit: 10 });

    expect(getShares.mock.calls[0][0]).toStrictEqual(["333"]);
    expect((result.rows[0] as any).orgSplit).toStrictEqual(split);
  });

  it("does not query splits when a page is empty", async () => {
    vi.spyOn(DAO.distributions, "getAll").mockResolvedValue({
      rows: [],
      statistics: { numDistributions: 0 },
      pages: 0,
    });
    const getShares = vi
      .spyOn(DAO.distributions, "getOrgSharesByKIDs")
      .mockResolvedValue(new Map());

    await admin().donations.distributions.list({ page: 0, limit: 10 });

    expect(getShares).toHaveBeenCalledOnce();
    expect(getShares.mock.calls[0][0]).toStrictEqual([]);
  });
});
