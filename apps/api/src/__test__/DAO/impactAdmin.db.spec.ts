import { describe, it, beforeAll, afterAll, afterEach } from "vitest";
import { expect } from "chai";
import type { Request, Response } from "express";
import * as mysql from "mysql2/promise";
import sinon from "sinon";
import { DAO } from "../../custom_modules/DAO";
import { clearImpactDataCache, getImpactData } from "../../custom_modules/impact/data";
import { effectiveEvaluation } from "../../custom_modules/impact/rules";
import { impactAdminDao } from "../../custom_modules/impactAdmin/dao";
import { appRouter } from "../../trpc/router";
import { createCallerFactory } from "../../trpc/trpc";

/**
 * The impact admin's writes against MySQL with the impact migration (prisma/migrations
 * 20261101120000_impact_tables): IDs kept, legacy IDs, rollback, and the module seeing the edit
 * at once. Skipped unless IMPACT_TEST_DB_URL points at a local, migrated database, e.g. the dev
 * environment's:
 *
 *   IMPACT_TEST_DB_URL=mysql://root:effekt-local@127.0.0.1:3307/EffektDonasjonDB_Local \
 *     pnpm test src/__test__/DAO/impactAdmin.db.spec.ts
 *
 * Writes a test charity (ZZTEST) and a TCF grant in mid-2028, and removes them again.
 */
const url = process.env.IMPACT_TEST_DB_URL;
const isLocal = !!url && /@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);

const admin = () =>
  createCallerFactory(appRouter)({
    req: {} as Request,
    res: {} as Response,
    auth: { permissions: ["admin"], email: "ops@example.org" },
  }).impact;

(isLocal ? describe : describe.skip)("impact admin writes (MySQL)", { timeout: 60000 }, () => {
  let pool: mysql.Pool;
  let originalPool: mysql.Pool | undefined;
  let charityId = 0;

  const cleanUp = async () => {
    await pool.query(
      "DELETE A FROM Impact_grant_allotments A JOIN Impact_grants G ON G.ID = A.Grant_ID WHERE G.valid_from >= '2028-06-01'",
    );
    await pool.query("DELETE FROM Impact_grants WHERE valid_from >= '2028-06-01'");
    await pool.query(
      "DELETE E FROM Impact_evaluations E JOIN Impact_charities C ON C.ID = E.Charity_ID WHERE C.abbreviation = 'ZZTEST'",
    );
    await pool.query(
      "DELETE FROM Impact_changes WHERE summary LIKE 'ZZTEST%' OR summary LIKE '%(Test charity)' OR summary LIKE '% from Jun 2028' OR summary LIKE '% from Jul 2028'",
    );
    await pool.query("DELETE FROM Impact_charities WHERE abbreviation = 'ZZTEST'");
  };

  beforeAll(async () => {
    pool = mysql.createPool({ uri: url!, timezone: "+00:00", connectionLimit: 4 });
    originalPool = DAO.dbPool;
    DAO.dbPool = pool;
    await cleanUp();
    clearImpactDataCache();
  });

  afterEach(() => sinon.restore());

  afterAll(async () => {
    await cleanUp();
    clearImpactDataCache();
    DAO.dbPool = originalPool!;
    await pool.end();
  });

  it("creates, edits and deletes an estimate; the impact module sees each change at once", async () => {
    ({ id: charityId } = await admin().charities.create({
      name: "Test charity",
      abbreviation: "zztest",
      organizationId: null,
    }));
    await getImpactData(); // warm the cache
    const { id } = await admin().estimates.create({
      charityId,
      interventionId: 2,
      validFrom: "2024-01-01",
      centsPerOutput: 500,
      sourceName: "Test",
      sourceUrl: "https://example.org/a",
    });
    expect(
      effectiveEvaluation(await getImpactData(), charityId, "2026-10-01")!.centsPerOutput,
    ).to.equal(500);

    await admin().estimates.update({
      id,
      interventionId: 2,
      validFrom: "2024-01-01",
      centsPerOutput: 550,
      centsPerOutputUpperBound: 600,
      sourceName: "Test",
      sourceUrl: "https://example.org/a",
    });
    const [[row]] = await pool.query<any[]>(
      "SELECT ID, cents_per_output, updated_by, updated_at FROM Impact_evaluations WHERE ID = ?",
      [id],
    );
    expect(row).to.include({ ID: id, cents_per_output: 550, updated_by: "ops@example.org" });
    expect(
      effectiveEvaluation(await getImpactData(), charityId, "2026-10-01")!.centsPerOutput,
    ).to.equal(550);

    // The same month twice is refused, by the router and by the unique key
    try {
      await admin().estimates.create({
        charityId,
        interventionId: 2,
        validFrom: "2024-01-01",
        centsPerOutput: 1,
        sourceName: "x",
        sourceUrl: "https://example.org",
      });
      expect.fail("expected BAD_REQUEST");
    } catch (err: any) {
      expect(err.code).to.equal("BAD_REQUEST");
    }

    await admin().estimates.delete({ id });
    expect(effectiveEvaluation(await getImpactData(), charityId, "2026-10-01")).to.equal(null);

    // The history has the charity's creation and the estimate's three edits, newest first
    const history = await admin().changes.list({ charityId });
    expect(history.map((c) => [c.entity, c.action])).to.deep.equal([
      ["estimate", "delete"],
      ["estimate", "update"],
      ["estimate", "create"],
      ["charity", "create"],
    ]);
    expect(history[1]!.fields).to.deep.include({
      field: "centsPerOutput",
      before: 500,
      after: 550,
    });
    expect(history[1]!.changedBy).to.equal("ops@example.org");
  });

  it("gives a new grant the fund's next legacy ID and keeps allotment IDs on edit", async () => {
    const [[{ maxLegacy }]] = await pool.query<any[]>(
      "SELECT MAX(legacy_id) AS maxLegacy FROM Impact_grants WHERE fund = 'TCF'",
    );
    const allotment = {
      charityId: 1,
      interventionId: 2,
      sumInCents: 6_000_000_000,
      numberOutputsPurchased: 1_000_000,
      sourceName: "",
      sourceUrl: "",
    };
    const { id } = await admin().grants.create({
      fund: "TCF",
      validFrom: "2028-06-01",
      allotments: [
        allotment,
        { ...allotment, charityId: 10, interventionId: 1, sumInCents: 2_000_000_000 },
      ],
    });
    const created = await admin().grants.get({ id });
    expect(created.legacyId).to.equal(Number(maxLegacy) + 1);
    expect(created.allotments.map((a) => a.share)).to.deep.equal([0.75, 0.25]);
    const [first, second] = created.allotments;

    await admin().grants.update({
      id,
      validFrom: "2028-07-01",
      allotments: [
        { ...allotment, id: first!.id, sumInCents: 1_000_000_000 },
        { ...allotment, charityId: 3, interventionId: 3 },
      ],
    });
    const edited = await admin().grants.get({ id });
    expect(edited.validFrom).to.equal("2028-07-01");
    expect(edited.legacyId).to.equal(created.legacyId);
    expect(edited.allotments[0]).to.include({ id: first!.id, sumInCents: 1_000_000_000 });
    expect(edited.allotments.map((a) => a.id)).to.not.include(second!.id);
    expect(edited.allotments[1]!.id).to.be.greaterThan(second!.id);
  });

  it("rolls the whole grant edit back when a step fails", async () => {
    const [grant] = await admin().grants.list({ fund: "TCF" });
    expect(grant!.validFrom).to.equal("2028-07-01");
    const before = await admin().grants.get({ id: grant!.id });
    const original = impactAdminDao.replaceAllotments;
    sinon.stub(impactAdminDao, "replaceAllotments").callsFake(async (...args) => {
      await original(...args);
      throw new Error("lost connection");
    });
    try {
      await admin().grants.update({
        id: grant!.id,
        validFrom: "2028-08-01",
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
      });
      expect.fail("expected an error");
    } catch (err: any) {
      expect(err.code).to.equal("INTERNAL_SERVER_ERROR");
    }
    sinon.restore();
    const changes = await admin().changes.list({ entity: "grant", entityId: grant!.id });
    expect(
      changes.map((c) => c.action),
      "no history for the rolled-back edit",
    ).to.deep.equal(["update", "create"]);
    const after = await admin().grants.get({ id: grant!.id });
    expect(after.validFrom).to.equal("2028-07-01");
    expect(after.allotments.map((a) => a.id)).to.deep.equal(before.allotments.map((a) => a.id));
    await admin().grants.delete({ id: grant!.id });
  });
});
