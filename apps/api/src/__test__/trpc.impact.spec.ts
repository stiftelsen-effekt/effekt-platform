import { describe, it, afterEach, beforeEach } from "vitest";
import { expect } from "chai";
import type { Request, Response } from "express";
import sinon from "sinon";
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
    expect.fail(`expected ${code}`);
  } catch (err: any) {
    expect(err.code).to.equal(code);
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
  let clock: sinon.SinonFakeTimers;
  beforeEach(() => {
    // 2026-11-15 in Oslo
    clock = sinon.useFakeTimers({ now: new Date("2026-11-15T10:00:00Z"), toFake: ["Date"] });
  });
  afterEach(() => {
    clock.restore();
    sinon.restore();
  });

  describe("timeline", () => {
    it("does month arithmetic across years", () => {
      expect(addMonths("2025-11-01", 3)).to.equal("2026-02-01");
      expect(addMonths("2026-01-01", -1)).to.equal("2025-12-01");
      expect(monthCount("2025-11-01", "2026-02-01")).to.equal(4);
      expect(monthCount("2026-02-01", "2025-11-01")).to.equal(0);
    });

    it("gives each item the months until the next one", () => {
      const ranges = coverage([
        { validFrom: "2023-01-01" },
        { validFrom: "2020-01-01" },
        { validFrom: "2021-01-01" },
      ]).map((c) => c.range);
      expect(ranges).to.deep.equal([
        { from: "2020-01-01", to: "2020-12-01" },
        { from: "2021-01-01", to: "2022-12-01" },
        { from: "2023-01-01", to: null },
      ]);
      expect(monthsApplied(ranges[2]!, "2026-11-01")).to.equal(47);
      expect(monthsApplied(ranges[0]!, "2026-11-01")).to.equal(12);
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
      ).to.deep.equal([{ from: "2021-06-01", to: "2022-12-01" }]);
      // Changing the newest changes everything from it on
      expect(
        changedMonths<E>(
          before,
          [before[0]!, { validFrom: "2023-01-01", cents: 600 }],
          key,
          "2026-11-01",
        ),
      ).to.deep.equal([{ from: "2023-01-01", to: null }]);
      // Moving the first one later leaves the months before it without an estimate
      expect(
        changedMonths<E>(
          before,
          [{ validFrom: "2020-03-01", cents: 518 }, before[1]!],
          key,
          "2026-11-01",
        ),
      ).to.deep.equal([{ from: "2020-01-01", to: "2020-02-01" }]);
      // Nothing that a month shows changed
      expect(changedMonths<E>(before, before, key, "2026-11-01")).to.deep.equal([]);
    });

    it("reports gaps of more than four days, newest first", () => {
      expect(
        rateGaps(["2026-03-27", "2026-03-30", "2026-04-07", "2026-04-08", "2026-04-20"]),
      ).to.deep.equal([
        { from: "2026-04-09", to: "2026-04-19", days: 11 },
        { from: "2026-03-31", to: "2026-04-06", days: 7 },
      ]);
    });
  });

  describe("access", () => {
    it("rejects anonymous callers and non-admins", async () => {
      const read = sinon.stub(impactAdminDao, "readTables").resolves(tablesFixture());
      await expectCode(callerWith().impact.estimates.list(), "UNAUTHORIZED");
      await expectCode(callerWith(["read:profile"]).impact.estimates.list(), "FORBIDDEN");
      await expectCode(callerWith(["read:profile"]).impact.grants.get({ id: 33 }), "FORBIDDEN");
      await expectCode(callerWith(["read:profile"]).impact.exchangeRates(), "FORBIDDEN");
      expect(read.called).to.be.false;
    });
  });

  describe("estimates", () => {
    beforeEach(() => {
      sinon.stub(impactAdminDao, "readTables").resolves(tablesFixture());
      sinon.stub(impactAdminDao, "readRateOn").resolves({ date: "2026-11-13", perUsd: 10.5 });
    });

    it("lists estimates newest first with the months they cover and NOK at today's rate", async () => {
      const rows = await admin().impact.estimates.list();
      expect(rows.map((r) => r.id)).to.deep.equal([71, 5, 1, 23]);
      const amf2023 = rows[0]!;
      expect(amf2023).to.include({
        charityName: "Against Malaria Foundation",
        interventionName: "Bednets",
        validTo: null,
        current: true,
        monthsApplied: 47,
        costPerOutputNok: "61.43",
      });
      expect(rows[1]).to.include({ validTo: "2022-12-01", current: false, monthsApplied: 24 });
    });

    it("filters by charity, intervention and the year an estimate applied in", async () => {
      const ids = async (input: object) =>
        (await admin().impact.estimates.list(input)).map((r) => r.id);
      expect(await ids({ charityIds: [10] })).to.deep.equal([23]);
      expect(await ids({ interventionIds: [2] })).to.deep.equal([71, 5, 1]);
      expect(await ids({ year: 2022, charityIds: [1] })).to.deep.equal([5]);
      expect(await ids({ year: 2019 })).to.deep.equal([]);
      await expectCode(admin().impact.estimates.list({ year: 1990 }), "BAD_REQUEST");
    });

    it("shows one charity's timeline oldest first, and NOT_FOUND for an unknown one", async () => {
      const timeline = await admin().impact.estimates.charity({ charityId: 1 });
      expect(timeline.charity.abbreviation).to.equal("AMF");
      expect(timeline.currentMonth).to.equal("2026-11-01");
      expect(timeline.estimates.map((e) => [e.validFrom, e.validTo])).to.deep.equal([
        ["2020-01-01", "2020-12-01"],
        ["2021-01-01", "2022-12-01"],
        ["2023-01-01", null],
      ]);
      await expectCode(admin().impact.estimates.charity({ charityId: 99 }), "NOT_FOUND");
    });
  });

  describe("grants", () => {
    beforeEach(() => {
      sinon.stub(impactAdminDao, "readTables").resolves(tablesFixture());
      sinon.stub(impactAdminDao, "readRateOn").resolves({ date: "2026-11-13", perUsd: 10 });
    });

    it("lists grants per fund with what each split covers", async () => {
      const rows = await admin().impact.grants.list();
      expect(rows.map((g) => [g.id, g.fund, g.validTo, g.current])).to.deep.equal([
        [33, "TCF", null, true],
        [34, "AGF", null, true],
        [29, "TCF", "2025-01-01", false],
      ]);
      expect(rows[2]).to.include({ allotments: 2, totalCents: 400 });
      expect(rows[2]!.charities).to.deep.equal([
        "Malaria Consortium",
        "Against Malaria Foundation",
      ]);
      expect((await admin().impact.grants.list({ fund: "AGF" })).map((g) => g.id)).to.deep.equal([
        34,
      ]);
    });

    it("splits a grant by sum like the impact module, with cost per output", async () => {
      const grant = await admin().impact.grants.get({ id: 29 });
      expect(
        grant.allotments.map((a) => [a.charityAbbreviation, a.share, a.centsPerOutput]),
      ).to.deep.equal([
        ["MC", 0.75, 100],
        ["AMF", 0.25, 25],
      ]);
      expect(grant.allotments[0]!.costPerOutputNok).to.equal("10.00");
      expect([grant.previousId, grant.nextId]).to.deep.equal([null, 33]);
      await expectCode(admin().impact.grants.get({ id: 1 }), "NOT_FOUND");
    });
  });

  describe("charities and interventions", () => {
    it("lists charities with their organization and the estimate that applies now", async () => {
      sinon.stub(impactAdminDao, "readTables").resolves(tablesFixture());
      const [amf, mc] = await admin().impact.charities.list();
      expect(amf).to.include({
        abbreviation: "AMF",
        organizationId: 12,
        estimates: 3,
        allotments: 1,
      });
      expect(amf!.currentEstimate).to.deep.equal({
        id: 71,
        validFrom: "2023-01-01",
        centsPerOutput: 585,
        interventionName: "Bednets",
      });
      expect(mc).to.include({ organizationId: null, allotments: 3 });
      const interventions = await admin().impact.interventions.list();
      expect(interventions.find((i) => i.id === 2)).to.include({ estimates: 3, allotments: 1 });
      expect(interventions.find((i) => i.id === 2)!.texts.no!.shortDescription).to.equal(
        "Myggnett",
      );
    });
  });

  describe("exchange rates", () => {
    it("shows the newest rate per currency, the job's runs, staleness and gaps", async () => {
      sinon.stub(impactAdminDao, "readLatestRates").resolves([
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
      sinon
        .stub(impactAdminDao, "readJobRuns")
        .resolves([{ id: 900, at: "2026-11-13T16:00:05.000Z", result: { days: 6, rows: 180 } }]);
      const days = sinon
        .stub(impactAdminDao, "readRateDays")
        .resolves(["2026-10-01", "2026-10-09", "2026-11-13"]);
      const rates = await admin().impact.exchangeRates();
      expect(days.firstCall.args[0]).to.equal("2025-11-15");
      expect(rates).to.deep.include({
        latestDate: "2026-11-13",
        daysSinceLatest: 2,
        today: "2026-11-15",
      });
      expect(rates.gaps.map((g) => g.from)).to.deep.equal(["2026-10-10", "2026-10-02"]);
      expect(rates.jobRuns[0]!.id).to.equal(900);
    });
  });
});
