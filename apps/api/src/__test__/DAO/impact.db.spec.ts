import { describe, it, beforeAll, afterAll } from "vitest";
import { expect } from "chai";
import * as mysql from "mysql2/promise";
import { DAO } from "../../custom_modules/DAO";
import { clearImpactDataCache, getImpactData } from "../../custom_modules/impact/data";
import { effectiveEvaluation, effectiveGrant } from "../../custom_modules/impact/rules";
import { getDonationImpacts, getDonorImpactSummary } from "../../custom_modules/impact/donations";
import { loadUsdRates, rateOn } from "../../custom_modules/exchangeRates";

/**
 * The impact module against MySQL with the impact migration and the dev seed (prisma/devdata):
 * the loader reads the migrated rows, and a donor's per-donation impact takes a few queries.
 * Skipped unless IMPACT_TEST_DB_URL points at a local, migrated and seeded database, e.g. the dev
 * environment's:
 *
 *   IMPACT_TEST_DB_URL=mysql://root:effekt-local@127.0.0.1:3307/EffektDonasjonDB_Local \
 *     pnpm test src/__test__/DAO/impact.db.spec.ts
 *
 * Read-only.
 */
const url = process.env.IMPACT_TEST_DB_URL;
const isLocal = !!url && /@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);

(isLocal ? describe : describe.skip)("impact tables (MySQL)", { timeout: 60000 }, function () {
  let pool: mysql.Pool;
  let originalPool: mysql.Pool | undefined;
  let queries = 0;

  beforeAll(async () => {
    pool = mysql.createPool({ uri: url!, timezone: "+00:00", connectionLimit: 4 });
    originalPool = DAO.dbPool;
    const counting = Object.create(pool);
    counting.query = (...args: any[]) => {
      queries++;
      return (pool.query as any)(...args);
    };
    DAO.dbPool = counting;
    clearImpactDataCache();
  });

  afterAll(async () => {
    DAO.dbPool = originalPool!;
    await pool.end();
  });

  it("loads the migrated rows", async () => {
    const data = await getImpactData();
    expect(data.charities.size).to.equal(15);
    expect([...data.evaluationsByCharity.values()].flat()).to.have.length(60);
    expect(data.grantsByFund.get("TCF")).to.have.length(25);
    expect(data.grantsByFund.get("AGF")!.map((g) => [g.id, g.legacyId])).to.deep.equal([[34, 1]]);
    expect(data.interventions.get(2)!.texts.no!.shortDescription).to.equal("Myggnett");
    // AMF: ten evaluations; the 2023 one applies from January 2023 on
    expect(effectiveEvaluation(data, 1, "2026-10-01")!.centsPerOutput).to.equal(585);
    expect(effectiveGrant(data, "TCF", "2026-10-01")!.validFrom).to.equal("2025-02-01");
    // The dev seed links the charities whose organizations it has
    const amf = [...data.charities.values()].find((c) => c.abbreviation === "AMF")!;
    expect(amf.organizationAbbreviation).to.equal("AMF");
    const sum = [...data.grantsByFund.get("TCF")!].flatMap((g) => g.allotments);
    expect(sum).to.have.length(45);
    expect(Math.max(...sum.map((a) => a.sumInCents))).to.be.greaterThan(2 ** 32);
  });

  it("reads exchange rates with the latest earlier day", async () => {
    const table = await loadUsdRates("NOK", "2024-05-18", "2024-05-20");
    const rate = rateOn(table, "2024-05-19");
    expect(rate).to.not.equal(null);
    expect(rate!.date <= "2024-05-19").to.equal(true);
  });

  it("computes a donor's per-donation impact in a few queries and well under 150 ms", async () => {
    const [[donor]] = await pool.query<any[]>(
      `SELECT Donor_ID AS id, COUNT(*) AS n FROM Donations GROUP BY Donor_ID ORDER BY n DESC LIMIT 1`,
    );
    await getImpactData();

    queries = 0;
    const perDonation = await getDonationImpacts({ donorId: donor.id });
    expect(queries, "queries per call (impact data cached)").to.equal(2);
    expect(perDonation.size).to.equal(Number(donor.n));

    // The entries' amounts add up to the donations
    const [[{ total }]] = await pool.query<any[]>(
      "SELECT SUM(sum_confirmed) AS total FROM Donations WHERE Donor_ID = ?",
      [donor.id],
    );
    const entries = [...perDonation.values()].flat();
    expect(entries.reduce((s, e) => s + e.amount, 0)).to.be.closeTo(Number(total), 0.01);
    expect(entries.some((e) => e.count !== null)).to.equal(true);

    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const started = performance.now();
      await getDonorImpactSummary({ donorId: donor.id });
      times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(times.length * 0.95) - 1];
    console.log(
      `donor with ${donor.n} donations: p50 ${times[9].toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`,
    );
    expect(p95).to.be.below(150);
  });

  it("limits to an Oslo calendar year", async () => {
    const [[donor]] = await pool.query<any[]>(
      `SELECT Donor_ID AS id FROM Donations GROUP BY Donor_ID ORDER BY COUNT(*) DESC LIMIT 1`,
    );
    // Oslo's 2025 in UTC: 2024-12-31 23:00 to 2025-12-31 23:00
    const [[{ n }]] = await pool.query<any[]>(
      "SELECT COUNT(*) AS n FROM Donations WHERE Donor_ID = ? AND timestamp_confirmed >= ? AND timestamp_confirmed < ?",
      [donor.id, new Date("2024-12-31T23:00:00Z"), new Date("2025-12-31T23:00:00Z")],
    );
    const year = await getDonationImpacts({ donorId: donor.id, year: 2025 });
    expect(year.size).to.equal(Number(n));
  });
});
