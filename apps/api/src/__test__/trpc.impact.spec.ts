import { describe, it, afterEach, beforeEach, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { DAO } from "../custom_modules/DAO";
import { clearImpactDataCache, getImpactData } from "../custom_modules/impact/data";
import {
  impactAdminDao,
  type AdminImpactTables,
  type RowMeta,
} from "../custom_modules/impactAdmin/dao";
import {
  addMonths,
  changedMonths,
  coverage,
  monthCount,
  monthsApplied,
} from "../custom_modules/impactAdmin/timeline";
import { rateGaps } from "../trpc/routers/impact";
import { appRouter } from "../trpc/router";
import { createCallerFactory } from "../trpc/trpc";

/**
 * The admin's impact router (phase 4 of docs/impact-api-migration.md) against stubbed tables:
 * access, the months each estimate and grant covers, the grant split, exchange-rate gaps.
 */
const createCaller = createCallerFactory(appRouter);
const callerWith = (permissions?: string[]) =>
  createCaller({
    req: {} as Request,
    res: {} as Response,
    auth: permissions ? { permissions, email: "ops@example.org" } : undefined,
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

const meta: RowMeta = {
  createdAt: "2026-11-01T12:00:00.000Z",
  createdBy: "impact-api migration",
  updatedAt: null,
  updatedBy: null,
};

const evaluation = (
  id: number,
  charityId: number,
  validFrom: string,
  centsPerOutput: number,
  interventionId = 2,
) => ({
  id,
  charityId,
  interventionId,
  validFrom,
  centsPerOutput,
  centsPerOutputLowerBound: 0,
  centsPerOutputUpperBound: null,
  sourceName: "",
  sourceUrl: "",
  comment: "",
  ...meta,
});

const allotment = (id: number, charityId: number, sumInCents: number, outputs: number) => ({
  id,
  charityId,
  interventionId: charityId === 1 ? 2 : 1,
  sumInCents,
  numberOutputsPurchased: outputs,
  numberOutputsPurchasedLowerBound: 0,
  numberOutputsPurchasedUpperBound: null,
  sourceName: "",
  sourceUrl: "",
  comment: "",
});

export const tablesFixture = (): AdminImpactTables => ({
  charities: [
    {
      id: 1,
      name: "Against Malaria Foundation",
      abbreviation: "AMF",
      organizationId: 12,
      organizationName: "Against Malaria Foundation",
      ...meta,
    },
    {
      id: 10,
      name: "Malaria Consortium",
      abbreviation: "MC",
      organizationId: null,
      organizationName: null,
      ...meta,
    },
  ],
  interventions: [
    { id: 1, shortDescription: "SMC", longDescription: "", texts: {}, ...meta },
    {
      id: 2,
      shortDescription: "Bednets",
      longDescription: "",
      texts: { no: { shortDescription: "Myggnett", longDescription: "" } },
      ...meta,
    },
  ],
  evaluations: [
    evaluation(1, 1, "2020-01-01", 518),
    evaluation(5, 1, "2021-01-01", 487),
    evaluation(71, 1, "2023-01-01", 585),
    evaluation(23, 10, "2020-01-01", 713, 1),
  ],
  grants: [
    {
      id: 29,
      fund: "TCF",
      validFrom: "2025-01-01",
      legacyId: 29,
      allotments: [allotment(43, 10, 300, 3), allotment(44, 1, 100, 4)],
      ...meta,
    },
    {
      id: 33,
      fund: "TCF",
      validFrom: "2025-02-01",
      legacyId: 33,
      allotments: [allotment(48, 10, 890000000, 925156)],
      ...meta,
    },
    {
      id: 34,
      fund: "AGF",
      validFrom: "2025-01-01",
      legacyId: 1,
      allotments: [allotment(40, 10, 100, 1)],
      ...meta,
    },
  ],
});

describe("impact admin", () => {
  beforeEach(() => {
    // 2026-11-15 in Oslo
    vi.useFakeTimers({ now: new Date("2026-11-15T10:00:00Z"), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("timeline", () => {
    it("does month arithmetic across years", () => {
      expect(addMonths("2025-11-01", 3)).toBe("2026-02-01");
      expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
      expect(monthCount("2025-11-01", "2026-02-01")).toBe(4);
      expect(monthCount("2026-02-01", "2025-11-01")).toBe(0);
    });

    it("gives each item the months until the next one", () => {
      const ranges = coverage([
        { validFrom: "2023-01-01" },
        { validFrom: "2020-01-01" },
        { validFrom: "2021-01-01" },
      ]).map((c) => c.range);
      expect(ranges).toStrictEqual([
        { from: "2020-01-01", to: "2020-12-01" },
        { from: "2021-01-01", to: "2022-12-01" },
        { from: "2023-01-01", to: null },
      ]);
      expect(monthsApplied(ranges[2]!, "2026-11-01")).toBe(47);
      expect(monthsApplied(ranges[0]!, "2026-11-01")).toBe(12);
    });

    it("finds the months whose figure changes", () => {
      type E = { validFrom: string; cents: number };
      const before: E[] = [
        { validFrom: "2020-01-01", cents: 518 },
        { validFrom: "2023-01-01", cents: 585 },
      ];
      const key = (e: E | null) => String(e?.cents ?? "none");
      // A new estimate in between changes its months until the next one
      expect(
        changedMonths<E>(
          before,
          [...before, { validFrom: "2021-06-01", cents: 487 }],
          key,
          "2026-11-01",
        ),
      ).toStrictEqual([{ from: "2021-06-01", to: "2022-12-01" }]);
      // Changing the newest changes everything from it on
      expect(
        changedMonths<E>(
          before,
          [before[0]!, { validFrom: "2023-01-01", cents: 600 }],
          key,
          "2026-11-01",
        ),
      ).toStrictEqual([{ from: "2023-01-01", to: null }]);
      // Moving the first one later leaves the months before it without an estimate
      expect(
        changedMonths<E>(
          before,
          [{ validFrom: "2020-03-01", cents: 518 }, before[1]!],
          key,
          "2026-11-01",
        ),
      ).toStrictEqual([{ from: "2020-01-01", to: "2020-02-01" }]);
      // Nothing that a month shows changed
      expect(changedMonths<E>(before, before, key, "2026-11-01")).toStrictEqual([]);
    });

    it("reports gaps of more than four days, newest first", () => {
      expect(
        rateGaps(["2026-03-27", "2026-03-30", "2026-04-07", "2026-04-08", "2026-04-20"]),
      ).toStrictEqual([
        { from: "2026-04-09", to: "2026-04-19", days: 11 },
        { from: "2026-03-31", to: "2026-04-06", days: 7 },
      ]);
    });
  });

  describe("access", () => {
    it("rejects anonymous callers and non-admins", async () => {
      const read = vi.spyOn(impactAdminDao, "readTables").mockResolvedValue(tablesFixture());
      await expectCode(callerWith().impact.estimates.list(), "UNAUTHORIZED");
      await expectCode(callerWith(["read:profile"]).impact.estimates.list(), "FORBIDDEN");
      await expectCode(callerWith(["read:profile"]).impact.grants.get({ id: 33 }), "FORBIDDEN");
      await expectCode(callerWith(["read:profile"]).impact.exchangeRates(), "FORBIDDEN");
      expect(read).not.toHaveBeenCalled();
    });
  });

  describe("estimates", () => {
    beforeEach(() => {
      vi.spyOn(impactAdminDao, "readTables").mockResolvedValue(tablesFixture());
      vi.spyOn(impactAdminDao, "readRateOn").mockResolvedValue({
        date: "2026-11-13",
        perUsd: 10.5,
      });
    });

    it("lists estimates newest first with the months they cover and NOK at today's rate", async () => {
      const rows = await admin().impact.estimates.list();
      expect(rows.map((r) => r.id)).toStrictEqual([71, 5, 1, 23]);
      const amf2023 = rows[0]!;
      expect(amf2023).toEqual(
        expect.objectContaining({
          charityName: "Against Malaria Foundation",
          interventionName: "Bednets",
          validTo: null,
          current: true,
          monthsApplied: 47,
          costPerOutputNok: "61.43",
        }),
      );
      expect(rows[1]).toEqual(
        expect.objectContaining({ validTo: "2022-12-01", current: false, monthsApplied: 24 }),
      );
    });

    it("filters by charity, intervention and the year an estimate applied in", async () => {
      const ids = async (input: object) =>
        (await admin().impact.estimates.list(input)).map((r) => r.id);
      expect(await ids({ charityIds: [10] })).toStrictEqual([23]);
      expect(await ids({ interventionIds: [2] })).toStrictEqual([71, 5, 1]);
      expect(await ids({ year: 2022, charityIds: [1] })).toStrictEqual([5]);
      expect(await ids({ year: 2019 })).toStrictEqual([]);
      await expectCode(admin().impact.estimates.list({ year: 1990 }), "BAD_REQUEST");
    });

    it("shows one charity's timeline oldest first, and NOT_FOUND for an unknown one", async () => {
      const timeline = await admin().impact.estimates.charity({ charityId: 1 });
      expect(timeline.charity.abbreviation).toBe("AMF");
      expect(timeline.currentMonth).toBe("2026-11-01");
      expect(timeline.estimates.map((e) => [e.validFrom, e.validTo])).toStrictEqual([
        ["2020-01-01", "2020-12-01"],
        ["2021-01-01", "2022-12-01"],
        ["2023-01-01", null],
      ]);
      await expectCode(admin().impact.estimates.charity({ charityId: 99 }), "NOT_FOUND");
    });
  });

  describe("grants", () => {
    beforeEach(() => {
      vi.spyOn(impactAdminDao, "readTables").mockResolvedValue(tablesFixture());
      vi.spyOn(impactAdminDao, "readRateOn").mockResolvedValue({ date: "2026-11-13", perUsd: 10 });
    });

    it("lists grants per fund with what each split covers", async () => {
      const rows = await admin().impact.grants.list();
      expect(rows.map((g) => [g.id, g.fund, g.validTo, g.current])).toStrictEqual([
        [33, "TCF", null, true],
        [34, "AGF", null, true],
        [29, "TCF", "2025-01-01", false],
      ]);
      expect(rows[2]).toEqual(expect.objectContaining({ allotments: 2, totalCents: 400 }));
      expect(rows[2]!.charities).toStrictEqual([
        "Malaria Consortium",
        "Against Malaria Foundation",
      ]);
      expect((await admin().impact.grants.list({ fund: "AGF" })).map((g) => g.id)).toStrictEqual([
        34,
      ]);
    });

    it("splits a grant by sum like the impact module, with cost per output", async () => {
      const grant = await admin().impact.grants.get({ id: 29 });
      expect(
        grant.allotments.map((a) => [a.charityAbbreviation, a.share, a.centsPerOutput]),
      ).toStrictEqual([
        ["MC", 0.75, 100],
        ["AMF", 0.25, 25],
      ]);
      expect(grant.allotments[0]!.costPerOutputNok).toBe("10.00");
      expect([grant.previousId, grant.nextId]).toStrictEqual([null, 33]);
      await expectCode(admin().impact.grants.get({ id: 1 }), "NOT_FOUND");
    });
  });

  describe("charities and interventions", () => {
    it("lists charities with their organization and the estimate that applies now", async () => {
      vi.spyOn(impactAdminDao, "readTables").mockResolvedValue(tablesFixture());
      const [amf, mc] = await admin().impact.charities.list();
      expect(amf).toEqual(
        expect.objectContaining({
          abbreviation: "AMF",
          organizationId: 12,
          estimates: 3,
          allotments: 1,
        }),
      );
      expect(amf!.currentEstimate).toStrictEqual({
        id: 71,
        validFrom: "2023-01-01",
        centsPerOutput: 585,
        interventionName: "Bednets",
      });
      expect(mc).toEqual(expect.objectContaining({ organizationId: null, allotments: 3 }));
      const interventions = await admin().impact.interventions.list();
      expect(interventions.find((i) => i.id === 2)).toEqual(
        expect.objectContaining({ estimates: 3, allotments: 1 }),
      );
      expect(interventions.find((i) => i.id === 2)!.texts.no!.shortDescription).toBe("Myggnett");
    });
  });

  describe("exchange rates", () => {
    it("shows the newest rate per currency, the job's runs, staleness and gaps", async () => {
      vi.spyOn(impactAdminDao, "readLatestRates").mockResolvedValue([
        {
          currency: "NOK",
          latestDate: "2026-11-13",
          perUsd: "10.12345678",
          source: "ECB",
          days: 3500,
          firstDate: "2013-01-02",
        },
        {
          currency: "SEK",
          latestDate: "2026-11-12",
          perUsd: "9.50000000",
          source: "ECB",
          days: 3499,
          firstDate: "2013-01-02",
        },
      ]);
      vi.spyOn(impactAdminDao, "readJobRuns").mockResolvedValue([
        { id: 900, at: "2026-11-13T16:00:05.000Z", result: { days: 6, rows: 180 } },
      ]);
      const days = vi
        .spyOn(impactAdminDao, "readRateDays")
        .mockResolvedValue(["2026-10-01", "2026-10-09", "2026-11-13"]);
      const rates = await admin().impact.exchangeRates();
      expect(days.mock.calls[0][0]).toBe("2025-11-15");
      expect(rates).toEqual(
        expect.objectContaining({
          latestDate: "2026-11-13",
          daysSinceLatest: 2,
          today: "2026-11-15",
        }),
      );
      expect(rates.gaps.map((g) => g.from)).toStrictEqual(["2026-10-10", "2026-10-02"]);
      expect(rates.jobRuns[0]!.id).toBe(900);
    });
  });
});

describe("impact admin writes", () => {
  afterEach(() => vi.restoreAllMocks());

  const conn = { query: async () => [[]] };
  /** Stubs a transaction that runs fn on a fake connection, with the fixture tables */
  const stubWrites = () => {
    vi.spyOn(impactAdminDao, "inTransaction").mockImplementation(async (fn: any) => fn(conn));
    vi.spyOn(impactAdminDao, "readTables").mockResolvedValue(tablesFixture());
  };
  const estimate = {
    charityId: 1,
    interventionId: 2,
    validFrom: "2026-01-01",
    centsPerOutput: 610,
    sourceName: "GiveWell CEA 2026",
    sourceUrl: "https://www.givewell.org/example",
  };
  /** The fields an input error names (zod's own or the router's fieldError) */
  const fieldErrorsOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (err: any) {
      expect(err.code, err.message).toBe("BAD_REQUEST");
      const issues: { path: PropertyKey[]; message: string }[] = err.cause?.issues ?? [];
      expect(issues, `no field in: ${err.message}`).not.toHaveLength(0);
      return Object.fromEntries(issues.map((i) => [i.path.join("."), i.message]));
    }
    expect.unreachable("expected BAD_REQUEST");
  };

  it("rejects non-admins before touching the database", async () => {
    const tx = vi.spyOn(impactAdminDao, "inTransaction").mockReturnValue(undefined as any);
    const user = callerWith(["read:profile"]).impact;
    await expectCode(user.estimates.create(estimate), "FORBIDDEN");
    await expectCode(
      user.estimates.update({ id: 71, ...estimate, charityId: undefined } as any),
      "FORBIDDEN",
    );
    await expectCode(user.estimates.delete({ id: 71 }), "FORBIDDEN");
    await expectCode(
      user.grants.create({ fund: "TCF", validFrom: "2026-01-01", allotments: [] }),
      "FORBIDDEN",
    );
    await expectCode(user.grants.delete({ id: 33 }), "FORBIDDEN");
    await expectCode(
      user.charities.update({ id: 1, name: "x", organizationId: null }),
      "FORBIDDEN",
    );
    await expectCode(
      user.interventions.create({ shortDescription: "x", longDescription: "" }),
      "FORBIDDEN",
    );
    await expectCode(callerWith().impact.estimates.delete({ id: 71 }), "UNAUTHORIZED");
    expect(tx).not.toHaveBeenCalled();
  });

  describe("validation", () => {
    beforeEach(stubWrites);

    it("checks cost, bounds, month, source and that IDs stay out of updates", async () => {
      const create = (patch: object) => admin().impact.estimates.create({ ...estimate, ...patch });
      expect(Object.keys(await fieldErrorsOf(create({ centsPerOutput: 0 })))).toStrictEqual([
        "centsPerOutput",
      ]);
      expect(
        Object.keys(await fieldErrorsOf(create({ centsPerOutputLowerBound: 700 }))),
      ).toStrictEqual(["centsPerOutputLowerBound"]);
      expect(
        Object.keys(await fieldErrorsOf(create({ centsPerOutputUpperBound: 500 }))),
      ).toStrictEqual(["centsPerOutputUpperBound"]);
      expect(Object.keys(await fieldErrorsOf(create({ validFrom: "2026-01-15" })))).toStrictEqual([
        "validFrom",
      ]);
      expect(Object.keys(await fieldErrorsOf(create({ sourceUrl: "givewell.org" })))).toStrictEqual(
        ["sourceUrl"],
      );
      expect(
        Object.keys(await fieldErrorsOf(create({ sourceName: "", sourceUrl: "" }))).sort(),
      ).toStrictEqual(["sourceName", "sourceUrl"]);
      // An update can't move an estimate to another charity, and never changes an ID
      await expectCode(
        admin().impact.estimates.update({ id: 71, ...estimate } as any),
        "BAD_REQUEST",
      );
      // Old rows hold several links, one per line
      const update = vi.spyOn(impactAdminDao, "updateEstimate").mockResolvedValue(undefined);
      const { charityId: _c, ...values } = estimate;
      await admin().impact.estimates.update({
        id: 71,
        ...values,
        validFrom: "2023-01-01",
        sourceUrl: "https://a.example/x\r\nhttps://b.example/y",
      });
      expect(update).toHaveBeenCalledOnce();
    });

    it("allows one estimate per charity and month, and only known charities and interventions", async () => {
      const insert = vi.spyOn(impactAdminDao, "insertEstimate").mockResolvedValue(99);
      expect(
        await fieldErrorsOf(
          admin().impact.estimates.create({ ...estimate, validFrom: "2023-01-01" }),
        ),
      ).toHaveProperty("validFrom");
      expect(
        await fieldErrorsOf(admin().impact.estimates.create({ ...estimate, charityId: 77 })),
      ).toHaveProperty("charityId");
      expect(
        await fieldErrorsOf(admin().impact.estimates.create({ ...estimate, interventionId: 77 })),
      ).toHaveProperty("interventionId");
      // Moving an estimate onto another's month is refused too; keeping its own month is fine
      const { charityId: _c, ...values } = estimate;
      expect(
        await fieldErrorsOf(
          admin().impact.estimates.update({ id: 5, ...values, validFrom: "2023-01-01" }),
        ),
      ).toHaveProperty("validFrom");
      expect(insert).not.toHaveBeenCalled();
      expect(await admin().impact.estimates.create(estimate)).toStrictEqual({ id: 99 });
      expect(insert.mock.calls[0].slice(1)).toStrictEqual([
        1,
        {
          interventionId: 2,
          validFrom: "2026-01-01",
          centsPerOutput: 610,
          centsPerOutputLowerBound: 0,
          centsPerOutputUpperBound: null,
          sourceName: "GiveWell CEA 2026",
          sourceUrl: "https://www.givewell.org/example",
          comment: "",
        },
        "ops@example.org",
      ]);
    });

    it("checks a grant's allotments: positive sums and outputs, known rows, a free month", async () => {
      const allotment = {
        charityId: 10,
        interventionId: 1,
        sumInCents: 100_000_00,
        numberOutputsPurchased: 1000,
        sourceName: "",
        sourceUrl: "",
      };
      const create = (patch: object) =>
        admin().impact.grants.create({
          fund: "TCF",
          validFrom: "2026-01-01",
          allotments: [allotment],
          ...patch,
        });
      await expectCode(create({ allotments: [] }), "BAD_REQUEST");
      await expectCode(create({ allotments: [{ ...allotment, sumInCents: 0 }] }), "BAD_REQUEST");
      await expectCode(
        create({ allotments: [{ ...allotment, numberOutputsPurchased: 0 }] }),
        "BAD_REQUEST",
      );
      await expectCode(
        create({ allotments: [{ ...allotment, numberOutputsPurchasedUpperBound: 10 }] }),
        "BAD_REQUEST",
      );
      expect(await fieldErrorsOf(create({ validFrom: "2025-02-01" }))).toHaveProperty("validFrom");
      expect(
        await fieldErrorsOf(create({ allotments: [{ ...allotment, charityId: 77 }] })),
      ).toHaveProperty(["allotments.0.charityId"]);
      // An allotment of another grant can't be moved in by id
      expect(
        await fieldErrorsOf(
          admin().impact.grants.update({
            id: 33,
            validFrom: "2025-02-01",
            allotments: [{ ...allotment, id: 43 }],
          }),
        ),
      ).toHaveProperty(["allotments.0"]);
      await expectCode(
        admin().impact.grants.update({
          id: 33,
          validFrom: "2025-02-01",
          allotments: [
            { ...allotment, id: 48 },
            { ...allotment, id: 48 },
          ],
        }),
        "BAD_REQUEST",
      );
      // The fund is fixed
      await expectCode(
        admin().impact.grants.update({
          id: 33,
          fund: "AGF",
          validFrom: "2025-02-01",
          allotments: [allotment],
        } as any),
        "BAD_REQUEST",
      );
    });

    it("keeps abbreviations fixed and unique, and one charity per organization", async () => {
      vi.spyOn(impactAdminDao, "organizationExists").mockResolvedValue(true);
      const insert = vi.spyOn(impactAdminDao, "insertCharity").mockResolvedValue(16);
      expect(
        await fieldErrorsOf(
          admin().impact.charities.create({
            name: "AMF 2",
            abbreviation: "amf",
            organizationId: null,
          }),
        ),
      ).toHaveProperty("abbreviation");
      await expectCode(
        admin().impact.charities.create({ name: "X", abbreviation: "A-B", organizationId: null }),
        "BAD_REQUEST",
      );
      expect(
        await fieldErrorsOf(
          admin().impact.charities.update({
            id: 10,
            name: "Malaria Consortium",
            organizationId: 12,
          }),
        ),
      ).toHaveProperty("organizationId");
      await expectCode(
        admin().impact.charities.update({
          id: 1,
          name: "AMF",
          abbreviation: "AMX",
          organizationId: 12,
        } as any),
        "BAD_REQUEST",
      );
      await admin().impact.charities.create({
        name: "Living Goods",
        abbreviation: "lg",
        organizationId: 30,
      });
      expect(insert.mock.calls[0][1]).toStrictEqual({
        name: "Living Goods",
        abbreviation: "LG",
        organizationId: 30,
      });
    });

    it("keeps intervention names unique and texts per known language", async () => {
      vi.spyOn(impactAdminDao, "insertIntervention").mockResolvedValue(12);
      expect(
        await fieldErrorsOf(
          admin().impact.interventions.create({ shortDescription: "bednets", longDescription: "" }),
        ),
      ).toHaveProperty("shortDescription");
      await expectCode(
        admin().impact.interventions.create({
          shortDescription: "Nets",
          longDescription: "",
          texts: { de: { shortDescription: "Netze", longDescription: "" } },
        } as any),
        "BAD_REQUEST",
      );
    });
  });

  describe("transactions and the cache", () => {
    it("rolls a grant update back when an allotment fails, and keeps the cache", async () => {
      const fakeConn = { query: vi.fn().mockResolvedValue([[]]), release: vi.fn() };
      vi.spyOn(DAO, "startTransaction").mockResolvedValue(fakeConn as any);
      const commit = vi.spyOn(DAO, "commitTransaction").mockResolvedValue(undefined);
      const rollback = vi.spyOn(DAO, "rollbackTransaction").mockResolvedValue(undefined);
      vi.spyOn(impactAdminDao, "readTables").mockResolvedValue(tablesFixture());
      const updateGrant = vi.spyOn(impactAdminDao, "updateGrant").mockResolvedValue(undefined);
      vi.spyOn(impactAdminDao, "replaceAllotments").mockRejectedValue(new Error("lost connection"));
      const query = vi.spyOn(DAO, "query").mockResolvedValue([[]] as any);
      await getImpactData();
      const reads = query.mock.calls.length;

      await expectCode(
        admin().impact.grants.update({
          id: 33,
          validFrom: "2025-03-01",
          allotments: [
            {
              id: 48,
              charityId: 10,
              interventionId: 1,
              sumInCents: 1,
              numberOutputsPurchased: 1,
              sourceName: "",
              sourceUrl: "",
            },
          ],
        }),
        "INTERNAL_SERVER_ERROR",
      );
      expect(updateGrant.mock.calls[0].slice(0, 3)).toStrictEqual([fakeConn, 33, "2025-03-01"]);
      expect(rollback).toHaveBeenCalledExactlyOnceWith(fakeConn as any);
      expect(commit).not.toHaveBeenCalled();
      await getImpactData();
      expect(query, "the cache was kept").toHaveBeenCalledTimes(reads);
      clearImpactDataCache();
    });

    it("commits and clears the impact cache after every write", async () => {
      stubWrites();
      vi.spyOn(impactAdminDao, "insertEstimate").mockResolvedValue(99);
      vi.spyOn(impactAdminDao, "updateEstimate").mockResolvedValue(undefined);
      vi.spyOn(impactAdminDao, "deleteEstimate").mockResolvedValue(undefined);
      vi.spyOn(impactAdminDao, "insertGrant").mockResolvedValue(40);
      vi.spyOn(impactAdminDao, "replaceAllotments").mockResolvedValue(undefined);
      vi.spyOn(impactAdminDao, "updateCharity").mockResolvedValue(undefined);
      vi.spyOn(impactAdminDao, "organizationExists").mockResolvedValue(true);
      vi.spyOn(impactAdminDao, "updateIntervention").mockResolvedValue(undefined);
      const query = vi.spyOn(DAO, "query").mockResolvedValue([[]] as any);
      const { charityId: _c, ...values } = estimate;
      const writes: (() => Promise<unknown>)[] = [
        () => admin().impact.estimates.create(estimate),
        () => admin().impact.estimates.update({ id: 71, ...values, validFrom: "2023-01-01" }),
        () => admin().impact.estimates.delete({ id: 71 }),
        () =>
          admin().impact.grants.create({
            fund: "TCF",
            validFrom: "2026-01-01",
            allotments: [
              {
                charityId: 1,
                interventionId: 2,
                sumInCents: 5,
                numberOutputsPurchased: 1,
                sourceName: "",
                sourceUrl: "",
              },
            ],
          }),
        () =>
          admin().impact.charities.update({
            id: 10,
            name: "Malaria Consortium",
            organizationId: 31,
          }),
        () =>
          admin().impact.interventions.update({
            id: 1,
            shortDescription: "SMC",
            longDescription: "Seasonal malaria chemoprevention",
            texts: { no: { shortDescription: "SMC", longDescription: "" } },
          }),
      ];
      for (const write of writes) {
        await getImpactData();
        const reads = query.mock.calls.length;
        await getImpactData();
        expect(query, "cached").toHaveBeenCalledTimes(reads);
        await write();
        await getImpactData();
        expect(query.mock.calls.length, "re-read after the write").toBeGreaterThan(reads);
      }
      clearImpactDataCache();
    });
  });

  describe("preview", () => {
    beforeEach(() => {
      vi.useFakeTimers({ now: new Date("2026-11-15T10:00:00Z"), toFake: ["Date"] });
      vi.spyOn(impactAdminDao, "readTables").mockResolvedValue(tablesFixture());
      vi.spyOn(impactAdminDao, "readRateOn").mockResolvedValue({ date: "2026-11-13", perUsd: 10 });
    });
    afterEach(() => vi.useRealTimers());

    it("shows before → after and the donations in the months that change", async () => {
      const count = vi
        .spyOn(impactAdminDao, "countDonations")
        .mockResolvedValue({ donations: 120, donors: 40 });
      const preview = await admin().impact.estimates.preview({
        id: 71,
        charityId: 1,
        interventionId: 2,
        validFrom: "2023-01-01",
        centsPerOutput: 600,
      });
      expect(preview.before).toEqual(
        expect.objectContaining({ centsPerOutput: 585, costPerOutputNok: "58.50" }),
      );
      expect(preview.after).toEqual(
        expect.objectContaining({ centsPerOutput: 600, costPerOutputNok: "60.00" }),
      );
      expect(preview.changedMonths).toStrictEqual([{ from: "2023-01-01", to: null }]);
      expect(preview.monthsChanged).toBe(47);
      expect(preview).toEqual(
        expect.objectContaining({ donations: 120, donors: 40, organizationLinked: true }),
      );
      const [orgId, ranges] = count.mock.calls[0];
      expect(orgId).toBe(12);
      // From midnight 1 January 2023 in Oslo, open-ended
      expect(ranges).toStrictEqual([{ from: new Date("2022-12-31T23:00:00Z"), before: null }]);
    });

    it("a new estimate between two changes only its months; removing one falls back", async () => {
      const count = vi
        .spyOn(impactAdminDao, "countDonations")
        .mockResolvedValue({ donations: 3, donors: 2 });
      const added = await admin().impact.estimates.preview({
        charityId: 1,
        interventionId: 2,
        validFrom: "2022-06-01",
        centsPerOutput: 500,
      });
      expect(added.changedMonths).toStrictEqual([{ from: "2022-06-01", to: "2022-12-01" }]);
      expect(added.monthsChanged).toBe(7);
      expect(added.before?.centsPerOutput).toBe(487);
      expect(count.mock.calls[0][1]).toStrictEqual([
        { from: new Date("2022-05-31T22:00:00Z"), before: new Date("2022-12-31T23:00:00Z") },
      ]);
      const removed = await admin().impact.estimates.preview({ id: 1, remove: true });
      expect(removed.changedMonths).toStrictEqual([{ from: "2020-01-01", to: "2020-12-01" }]);
      expect(removed.after).toBe(null);
      // A charity without an organization: no donation uses it, nothing to count
      const unlinked = await admin().impact.estimates.preview({ id: 23, remove: true });
      expect(unlinked).toEqual(
        expect.objectContaining({ organizationLinked: false, donations: 0 }),
      );
      expect(count).toHaveBeenCalledTimes(2);
    });
  });
});

describe("impact admin history", () => {
  afterEach(() => vi.restoreAllMocks());

  const estimateValues = {
    interventionId: 2,
    validFrom: "2023-01-01",
    centsPerOutput: 600,
    sourceName: "GiveWell",
    sourceUrl: "https://www.givewell.org/x",
  };

  it("records who changed what, before and after, in the edit's transaction", async () => {
    const conn = { query: async () => [[]] };
    vi.spyOn(impactAdminDao, "inTransaction").mockImplementation(async (fn: any) => fn(conn));
    const after = tablesFixture();
    after.evaluations[2] = {
      ...after.evaluations[2]!,
      centsPerOutput: 600,
      sourceName: "GiveWell",
    };
    const read = vi.spyOn(impactAdminDao, "readTables").mockReturnValue(undefined as any);
    read.mockResolvedValueOnce(tablesFixture());
    read.mockResolvedValueOnce(after);
    vi.spyOn(impactAdminDao, "updateEstimate").mockResolvedValue(undefined);
    const insert = vi.spyOn(impactAdminDao, "insertChange").mockResolvedValue(undefined);
    await admin().impact.estimates.update({ id: 71, ...estimateValues });
    const [txConn, change, actor] = insert.mock.calls[0];
    expect(txConn).toBe(conn);
    expect(actor).toBe("ops@example.org");
    expect(change).toEqual(
      expect.objectContaining({
        entity: "estimate",
        entityId: 71,
        action: "update",
        charityId: 1,
        summary: "AMF estimate from Jan 2023",
      }),
    );
    expect(change.before).toEqual(expect.objectContaining({ centsPerOutput: 585, sourceName: "" }));
    expect(change.after).toEqual(
      expect.objectContaining({ centsPerOutput: 600, sourceName: "GiveWell" }),
    );
    expect(change.after).not.toHaveProperty("updatedBy");

    // A delete keeps the row as it was; a failed history write fails the edit
    // Both queued values were consumed by the update above, so this replaces the behaviour
    read.mockResolvedValue(tablesFixture());
    vi.spyOn(impactAdminDao, "deleteEstimate").mockResolvedValue(undefined);
    await admin().impact.estimates.delete({ id: 5 });
    expect(insert.mock.calls[1][1]).toEqual(
      expect.objectContaining({ action: "delete", after: null }),
    );
    expect(insert.mock.calls[1][1].before).toEqual(
      expect.objectContaining({ centsPerOutput: 487 }),
    );
    insert.mockRejectedValue(new Error("disk full"));
    await expectCode(admin().impact.estimates.delete({ id: 5 }), "INTERNAL_SERVER_ERROR");
  });

  it("lists changes with the fields that differ", async () => {
    vi.spyOn(impactAdminDao, "readChanges").mockResolvedValue([
      {
        id: 3,
        entity: "estimate",
        entityId: 71,
        action: "update",
        charityId: 1,
        summary: "AMF estimate from Jan 2023",
        before: { id: 71, centsPerOutput: 585, sourceName: "", comment: "" },
        after: { id: 71, centsPerOutput: 600, sourceName: "GiveWell", comment: "" },
        changedBy: "ops@example.org",
        changedAt: "2026-11-01T15:00:00.000Z",
      },
    ]);
    const [change] = await admin().impact.changes.list({ charityId: 1 });
    expect(change!.fields).toStrictEqual([
      { field: "centsPerOutput", before: 585, after: 600 },
      { field: "sourceName", before: "", after: "GiveWell" },
    ]);
    await expectCode(callerWith(["read:profile"]).impact.changes.list(), "FORBIDDEN");
  });
});
