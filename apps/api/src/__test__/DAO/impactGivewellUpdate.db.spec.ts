import { describe, it, beforeAll, afterAll } from "vitest";
import { expect } from "chai";
import type { Request, Response } from "express";
import { readFileSync } from "fs";
import { join } from "path";
import * as mysql from "mysql2/promise";
import { DAO } from "../../custom_modules/DAO";
import { clearImpactDataCache, getImpactData } from "../../custom_modules/impact/data";
import { effectiveEvaluation, effectiveGrant, grantSplit } from "../../custom_modules/impact/rules";
import { appRouter } from "../../trpc/router";
import { createCallerFactory } from "../../trpc/trpc";

/**
 * The impact tables after the GiveWell update (prisma/migrations/
 * 20261101233000_impact_givewell_update): every check of scripts/impact-givewell-update.sql
 * passes, the impact module picks the corrected grants and the new estimates, and the admin's
 * change log reads the migration's history rows. Skipped unless IMPACT_TEST_DB_URL points at a
 * local, migrated database, e.g. the dev environment's:
 *
 *   IMPACT_TEST_DB_URL=mysql://root:effekt-local@127.0.0.1:3307/EffektDonasjonDB_Local \
 *     pnpm test src/__test__/DAO/impactGivewellUpdate.db.spec.ts
 *
 * Read-only.
 */
const url = process.env.IMPACT_TEST_DB_URL;
const isLocal = !!url && /@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);
const WHO = "migration:20261101233000_impact_givewell_update";

(isLocal ? describe : describe.skip)("impact tables after the GiveWell update (MySQL)", () => {
  let pool: mysql.Pool;
  let originalPool: mysql.Pool | undefined;

  beforeAll(() => {
    pool = mysql.createPool({ uri: url!, timezone: "+00:00", connectionLimit: 2 });
    originalPool = DAO.dbPool;
    DAO.dbPool = pool;
    clearImpactDataCache();
  });

  afterAll(async () => {
    clearImpactDataCache();
    DAO.dbPool = originalPool!;
    await pool.end();
  });

  it("passes every check of scripts/impact-givewell-update.sql", async () => {
    const check = readFileSync(
      join(__dirname, "../../../scripts/impact-givewell-update.sql"),
      "utf8",
    );
    const [rows] = await pool.query<any[]>(check);
    expect(rows.length).to.be.greaterThan(40);
    expect(rows.filter((r) => Number(r.ok) !== 1)).to.deep.equal([]);
  });

  it("splits Top Charities Fund money by the grant of the donation's quarter", async () => {
    const data = await getImpactData();
    const split = (month: string) =>
      grantSplit(effectiveGrant(data, "TCF", month)!).map((p) => [
        data.charities.get(p.allotment.charityId)!.abbreviation,
        Math.round(p.share * 1000) / 1000,
        Math.round(p.centsPerOutput),
      ]);
    expect(split("2023-12-01")).to.deep.equal([["MC", 1, 792]]);
    expect(split("2024-02-01")).to.deep.equal([
      ["MC", 0.572, 820],
      ["MC", 0.428, 599],
    ]);
    expect(split("2024-05-01")).to.deep.equal([["AMF", 1, 744]]);
    expect(split("2024-08-01").map(([c]) => c)).to.deep.equal(["MC", "MC", "NI", "HKI", "AMF"]);
    expect(split("2024-11-01")).to.deep.equal([["AMF", 1, 566]]);
    expect(split("2025-02-01")).to.deep.equal([
      ["NI", 0.364, 8976],
      ["HKI", 0.636, 226],
    ]);
    expect(split("2025-05-01")).to.deep.equal([
      ["MC", 0.712, 962],
      ["AMF", 0.288, 637],
    ]);
    expect(split("2026-10-01")).to.deep.equal([["AMF", 1, 600]]);
    // The All Grants Fund keeps its placeholder grant
    expect(effectiveGrant(data, "AGF", "2026-10-01")?.legacyId).to.equal(1);
  });

  it("uses GiveWell's 2024 averages for money given directly from January 2024", async () => {
    const data = await getImpactData();
    const cost = (abbreviation: string, month: string) => {
      const charity = [...data.charities.values()].find((c) => c.abbreviation === abbreviation)!;
      return effectiveEvaluation(data, charity.id, month)!.centsPerOutput;
    };
    expect(["AMF", "MC", "NI", "HKI"].map((a) => cost(a, "2023-12-01"))).to.deep.equal([
      585, 801, 13274, 203,
    ]);
    expect(["AMF", "MC", "NI", "HKI"].map((a) => cost(a, "2024-01-01"))).to.deep.equal([
      610, 795, 13630, 252,
    ]);
  });

  it("shows the migration's edits in the admin's change log", async () => {
    const changes = await createCallerFactory(appRouter)({
      req: {} as Request,
      res: {} as Response,
      auth: { permissions: ["admin"], email: "ops@example.org" },
    }).impact.changes.list({ limit: 200 });
    const ours = changes.filter((c) => c.changedBy === WHO);
    expect(ours).to.have.length(21);
    const grant27 = ours.find((c) => c.entity === "grant" && c.entityId === 27)!;
    expect(grant27.summary).to.equal("TCF grant from Oct 2024");
    expect(grant27.fields.map((f) => f.field).sort()).to.deep.equal(["allotments", "validFrom"]);
    expect(grant27.fields.find((f) => f.field === "validFrom")).to.deep.include({
      before: "2024-04-01",
      after: "2024-10-01",
    });
  });
});
