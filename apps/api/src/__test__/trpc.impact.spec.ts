import { describe, it, afterEach, beforeEach } from "vitest";
import { expect } from "chai";
import type { Request, Response } from "express";
import sinon from "sinon";
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

describe("impact admin writes", () => {
  afterEach(() => sinon.restore());

  const conn = { query: async () => [[]] };
  /** Stubs a transaction that runs fn on a fake connection, with the fixture tables */
  const stubWrites = () => {
    sinon.stub(impactAdminDao, "inTransaction").callsFake(async (fn: any) => fn(conn));
    sinon.stub(impactAdminDao, "readTables").resolves(tablesFixture());
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
      expect(err.code, err.message).to.equal("BAD_REQUEST");
      const issues: { path: PropertyKey[]; message: string }[] = err.cause?.issues ?? [];
      expect(issues, `no field in: ${err.message}`).to.not.be.empty;
      return Object.fromEntries(issues.map((i) => [i.path.join("."), i.message]));
    }
    expect.fail("expected BAD_REQUEST");
  };

  it("rejects non-admins before touching the database", async () => {
    const tx = sinon.stub(impactAdminDao, "inTransaction");
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
    expect(tx.called).to.be.false;
  });

  describe("validation", () => {
    beforeEach(stubWrites);

    it("checks cost, bounds, month, source and that IDs stay out of updates", async () => {
      const create = (patch: object) => admin().impact.estimates.create({ ...estimate, ...patch });
      expect(Object.keys(await fieldErrorsOf(create({ centsPerOutput: 0 })))).to.deep.equal([
        "centsPerOutput",
      ]);
      expect(
        Object.keys(await fieldErrorsOf(create({ centsPerOutputLowerBound: 700 }))),
      ).to.deep.equal(["centsPerOutputLowerBound"]);
      expect(
        Object.keys(await fieldErrorsOf(create({ centsPerOutputUpperBound: 500 }))),
      ).to.deep.equal(["centsPerOutputUpperBound"]);
      expect(Object.keys(await fieldErrorsOf(create({ validFrom: "2026-01-15" })))).to.deep.equal([
        "validFrom",
      ]);
      expect(Object.keys(await fieldErrorsOf(create({ sourceUrl: "givewell.org" })))).to.deep.equal(
        ["sourceUrl"],
      );
      expect(
        Object.keys(await fieldErrorsOf(create({ sourceName: "", sourceUrl: "" }))).sort(),
      ).to.deep.equal(["sourceName", "sourceUrl"]);
      // An update can't move an estimate to another charity, and never changes an ID
      await expectCode(
        admin().impact.estimates.update({ id: 71, ...estimate } as any),
        "BAD_REQUEST",
      );
      // Old rows hold several links, one per line
      const update = sinon.stub(impactAdminDao, "updateEstimate").resolves();
      const { charityId: _c, ...values } = estimate;
      await admin().impact.estimates.update({
        id: 71,
        ...values,
        validFrom: "2023-01-01",
        sourceUrl: "https://a.example/x\r\nhttps://b.example/y",
      });
      expect(update.calledOnce).to.be.true;
    });

    it("allows one estimate per charity and month, and only known charities and interventions", async () => {
      const insert = sinon.stub(impactAdminDao, "insertEstimate").resolves(99);
      expect(
        await fieldErrorsOf(
          admin().impact.estimates.create({ ...estimate, validFrom: "2023-01-01" }),
        ),
      ).to.have.property("validFrom");
      expect(
        await fieldErrorsOf(admin().impact.estimates.create({ ...estimate, charityId: 77 })),
      ).to.have.property("charityId");
      expect(
        await fieldErrorsOf(admin().impact.estimates.create({ ...estimate, interventionId: 77 })),
      ).to.have.property("interventionId");
      // Moving an estimate onto another's month is refused too; keeping its own month is fine
      const { charityId: _c, ...values } = estimate;
      expect(
        await fieldErrorsOf(
          admin().impact.estimates.update({ id: 5, ...values, validFrom: "2023-01-01" }),
        ),
      ).to.have.property("validFrom");
      expect(insert.called).to.be.false;
      expect(await admin().impact.estimates.create(estimate)).to.deep.equal({ id: 99 });
      expect(insert.firstCall.args.slice(1)).to.deep.equal([
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
      expect(await fieldErrorsOf(create({ validFrom: "2025-02-01" }))).to.have.property(
        "validFrom",
      );
      expect(
        await fieldErrorsOf(create({ allotments: [{ ...allotment, charityId: 77 }] })),
      ).to.have.property("allotments.0.charityId");
      // An allotment of another grant can't be moved in by id
      expect(
        await fieldErrorsOf(
          admin().impact.grants.update({
            id: 33,
            validFrom: "2025-02-01",
            allotments: [{ ...allotment, id: 43 }],
          }),
        ),
      ).to.have.property("allotments.0");
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
      sinon.stub(impactAdminDao, "organizationExists").resolves(true);
      const insert = sinon.stub(impactAdminDao, "insertCharity").resolves(16);
      expect(
        await fieldErrorsOf(
          admin().impact.charities.create({
            name: "AMF 2",
            abbreviation: "amf",
            organizationId: null,
          }),
        ),
      ).to.have.property("abbreviation");
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
      ).to.have.property("organizationId");
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
      expect(insert.firstCall.args[1]).to.deep.equal({
        name: "Living Goods",
        abbreviation: "LG",
        organizationId: 30,
      });
    });

    it("keeps intervention names unique and texts per known language", async () => {
      sinon.stub(impactAdminDao, "insertIntervention").resolves(12);
      expect(
        await fieldErrorsOf(
          admin().impact.interventions.create({ shortDescription: "bednets", longDescription: "" }),
        ),
      ).to.have.property("shortDescription");
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
      const fakeConn = { query: sinon.stub().resolves([[]]), release: sinon.stub() };
      sinon.stub(DAO, "startTransaction").resolves(fakeConn as any);
      const commit = sinon.stub(DAO, "commitTransaction").resolves();
      const rollback = sinon.stub(DAO, "rollbackTransaction").resolves();
      sinon.stub(impactAdminDao, "readTables").resolves(tablesFixture());
      const updateGrant = sinon.stub(impactAdminDao, "updateGrant").resolves();
      sinon.stub(impactAdminDao, "replaceAllotments").rejects(new Error("lost connection"));
      const query = sinon.stub(DAO, "query").resolves([[]] as any);
      await getImpactData();
      const reads = query.callCount;

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
      expect(updateGrant.firstCall.args.slice(0, 3)).to.deep.equal([fakeConn, 33, "2025-03-01"]);
      expect(rollback.calledOnceWith(fakeConn as any)).to.be.true;
      expect(commit.called).to.be.false;
      await getImpactData();
      expect(query.callCount, "the cache was kept").to.equal(reads);
      clearImpactDataCache();
    });

    it("commits and clears the impact cache after every write", async () => {
      stubWrites();
      sinon.stub(impactAdminDao, "insertEstimate").resolves(99);
      sinon.stub(impactAdminDao, "updateEstimate").resolves();
      sinon.stub(impactAdminDao, "deleteEstimate").resolves();
      sinon.stub(impactAdminDao, "insertGrant").resolves(40);
      sinon.stub(impactAdminDao, "replaceAllotments").resolves();
      sinon.stub(impactAdminDao, "updateCharity").resolves();
      sinon.stub(impactAdminDao, "organizationExists").resolves(true);
      sinon.stub(impactAdminDao, "updateIntervention").resolves();
      const query = sinon.stub(DAO, "query").resolves([[]] as any);
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
        const reads = query.callCount;
        await getImpactData();
        expect(query.callCount, "cached").to.equal(reads);
        await write();
        await getImpactData();
        expect(query.callCount, "re-read after the write").to.be.greaterThan(reads);
      }
      clearImpactDataCache();
    });
  });

  describe("preview", () => {
    beforeEach(() => {
      clock = sinon.useFakeTimers({ now: new Date("2026-11-15T10:00:00Z"), toFake: ["Date"] });
      sinon.stub(impactAdminDao, "readTables").resolves(tablesFixture());
      sinon.stub(impactAdminDao, "readRateOn").resolves({ date: "2026-11-13", perUsd: 10 });
    });
    let clock: sinon.SinonFakeTimers;
    afterEach(() => clock.restore());

    it("shows before → after and the donations in the months that change", async () => {
      const count = sinon
        .stub(impactAdminDao, "countDonations")
        .resolves({ donations: 120, donors: 40 });
      const preview = await admin().impact.estimates.preview({
        id: 71,
        charityId: 1,
        interventionId: 2,
        validFrom: "2023-01-01",
        centsPerOutput: 600,
      });
      expect(preview.before).to.deep.include({ centsPerOutput: 585, costPerOutputNok: "58.50" });
      expect(preview.after).to.deep.include({ centsPerOutput: 600, costPerOutputNok: "60.00" });
      expect(preview.changedMonths).to.deep.equal([{ from: "2023-01-01", to: null }]);
      expect(preview.monthsChanged).to.equal(47);
      expect(preview).to.include({ donations: 120, donors: 40, organizationLinked: true });
      const [orgId, ranges] = count.firstCall.args;
      expect(orgId).to.equal(12);
      // From midnight 1 January 2023 in Oslo, open-ended
      expect(ranges).to.deep.equal([{ from: new Date("2022-12-31T23:00:00Z"), before: null }]);
    });

    it("a new estimate between two changes only its months; removing one falls back", async () => {
      const count = sinon
        .stub(impactAdminDao, "countDonations")
        .resolves({ donations: 3, donors: 2 });
      const added = await admin().impact.estimates.preview({
        charityId: 1,
        interventionId: 2,
        validFrom: "2022-06-01",
        centsPerOutput: 500,
      });
      expect(added.changedMonths).to.deep.equal([{ from: "2022-06-01", to: "2022-12-01" }]);
      expect(added.monthsChanged).to.equal(7);
      expect(added.before?.centsPerOutput).to.equal(487);
      expect(count.firstCall.args[1]).to.deep.equal([
        { from: new Date("2022-05-31T22:00:00Z"), before: new Date("2022-12-31T23:00:00Z") },
      ]);
      const removed = await admin().impact.estimates.preview({ id: 1, remove: true });
      expect(removed.changedMonths).to.deep.equal([{ from: "2020-01-01", to: "2020-12-01" }]);
      expect(removed.after).to.equal(null);
      // A charity without an organization: no donation uses it, nothing to count
      const unlinked = await admin().impact.estimates.preview({ id: 23, remove: true });
      expect(unlinked).to.include({ organizationLinked: false, donations: 0 });
      expect(count.callCount).to.equal(2);
    });
  });
});

describe("impact admin history", () => {
  afterEach(() => sinon.restore());

  const estimateValues = {
    interventionId: 2,
    validFrom: "2023-01-01",
    centsPerOutput: 600,
    sourceName: "GiveWell",
    sourceUrl: "https://www.givewell.org/x",
  };

  it("records who changed what, before and after, in the edit's transaction", async () => {
    const conn = { query: async () => [[]] };
    sinon.stub(impactAdminDao, "inTransaction").callsFake(async (fn: any) => fn(conn));
    const after = tablesFixture();
    after.evaluations[2] = {
      ...after.evaluations[2]!,
      centsPerOutput: 600,
      sourceName: "GiveWell",
    };
    const read = sinon.stub(impactAdminDao, "readTables");
    read.onFirstCall().resolves(tablesFixture());
    read.onSecondCall().resolves(after);
    sinon.stub(impactAdminDao, "updateEstimate").resolves();
    const insert = sinon.stub(impactAdminDao, "insertChange").resolves();
    await admin().impact.estimates.update({ id: 71, ...estimateValues });
    const [txConn, change, actor] = insert.firstCall.args;
    expect(txConn).to.equal(conn);
    expect(actor).to.equal("ops@example.org");
    expect(change).to.deep.include({
      entity: "estimate",
      entityId: 71,
      action: "update",
      charityId: 1,
      summary: "AMF estimate from Jan 2023",
    });
    expect(change.before).to.include({ centsPerOutput: 585, sourceName: "" });
    expect(change.after).to.include({ centsPerOutput: 600, sourceName: "GiveWell" });
    expect(change.after).to.not.have.property("updatedBy");

    // A delete keeps the row as it was; a failed history write fails the edit
    read.resetBehavior();
    read.resolves(tablesFixture());
    sinon.stub(impactAdminDao, "deleteEstimate").resolves();
    await admin().impact.estimates.delete({ id: 5 });
    expect(insert.secondCall.args[1]).to.deep.include({ action: "delete", after: null });
    expect(insert.secondCall.args[1].before).to.include({ centsPerOutput: 487 });
    insert.rejects(new Error("disk full"));
    await expectCode(admin().impact.estimates.delete({ id: 5 }), "INTERNAL_SERVER_ERROR");
  });

  it("lists changes with the fields that differ", async () => {
    sinon.stub(impactAdminDao, "readChanges").resolves([
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
    expect(change!.fields).to.deep.equal([
      { field: "centsPerOutput", before: 585, after: 600 },
      { field: "sourceName", before: "", after: "GiveWell" },
    ]);
    await expectCode(callerWith(["read:profile"]).impact.changes.list(), "FORBIDDEN");
  });
});
