import { describe, it, afterEach, expect as vexpect } from "vitest";
import { expect } from "chai";
import sinon from "sinon";
import { readFileSync } from "fs";
import { join } from "path";
import { DAO } from "../custom_modules/DAO";
import * as results from "../custom_modules/results";
import * as currency from "../custom_modules/currency";
import { buildImpactData, type ImpactData, type ImpactRows } from "../custom_modules/impact/data";
import { receiptEstimates, distributionShares } from "../custom_modules/impact/receipts";
import { getRemoteImpactEstimatesForDonationByOrg } from "../custom_modules/impact/remote";
import {
  buildMonthlyOutputs,
  DEFAULT_MONTHLY_RULES,
  getMonthlyDonationsPerOutputRemote,
  type MonthlyDonationSum,
  type MonthlyDonationsPerOrgResult,
  type MonthlyOutputRules,
} from "../custom_modules/monthlyOutputs";
import type { RateTable } from "../custom_modules/exchangeRates";
import type { Distribution } from "../schemas/types";

/**
 * Receipts and the results page, before and after the move to local tables
 * (docs/impact-api-migration.md, phase 2), for a fixed sample. The "before" side runs the legacy
 * code against responses recorded from the impact API (with its Datastore cache bypassed) and
 * Norges Bank on 2026-11-01 (src/__test__/data/impact). The "after" side reads the same data as
 * our tables hold, with the ECB rates recorded from Exchange_rates.
 *
 * Every difference must come from an agreed change:
 * - ECB instead of Norges Bank (decision 2): figures scale by the ratio of the two rates.
 * - Latest evaluation on or before the month on the results page (decision 1), which used the
 *   first one on or after it; and no fund split before the first grant.
 * - Charities linked to organizations instead of matched by abbreviation: receipts compared
 *   abbreviations case-sensitively, so Sightsavers ("Sight" vs SS), The END Fund ("End") and
 *   Deworm the World ("DtW") had no outputs on receipts.
 */

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, "data/impact", name), "utf8"));
const ORGS: { ID: number; abbriv: string; full_name: string }[] = fixture("organizations.json");
const EVALUATIONS = fixture("evaluations.no.json");
const GRANTS = fixture("tcf-grants.no.json");
const NB_MONTHLY = fixture("norges-bank-monthly.json");
const ECB: { daily: Record<string, number>; monthly: Record<string, number> } =
  fixture("ecb-nok.json");
const RECEIPTS: {
  timestamp: string;
  sum: number;
  orgs: [number, string][];
  evaluations: unknown;
  grant: unknown;
  norgesBankRate: string;
}[] = fixture("receipts.json");

/** The links of migration 20261101120000_impact_tables, in production's abbreviations */
const LINKS: Record<string, string> = {
  AMF: "AMF",
  SCI: "SCI",
  HKI: "HKI",
  NI: "NI",
  END: "End",
  DTW: "DtW",
  SS: "Sight",
  GD: "GD",
  UBI: "UBI",
  MC: "MC",
  NLS: "NLS",
  PHC: "PHC",
  GDZF: "GDZF",
  GDCSF: "GDCSF",
  AGF: "AGF",
};

/** Our tables' rows from the impact API's (Norwegian) answers, as the migration generator maps them */
function impactDataFromApi(): ImpactData {
  const charities = new Map<number, any>();
  const interventions = new Map<number, any>();
  const all = [
    ...EVALUATIONS.evaluations,
    ...GRANTS.max_impact_fund_grants.flatMap((g: any) => g.allotment_set),
  ];
  for (const x of all) {
    charities.set(x.charity.id, x.charity);
    interventions.set(x.intervention.id, x.intervention);
  }
  const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}-01`;
  const rows: ImpactRows = {
    charities: [...charities.values()].map((c) => ({
      ID: c.id,
      name: c.charity_name,
      abbreviation: c.abbreviation,
      Organization_ID: ORGS.find((o) => o.abbriv === LINKS[c.abbreviation])?.ID ?? null,
    })),
    // The answers are Norwegian; English is not needed here
    interventions: [...interventions.values()].map((i) => ({
      ID: i.id,
      short_description: i.short_description,
      long_description: i.long_description,
    })),
    texts: [...interventions.values()].map((i) => ({
      Intervention_ID: i.id,
      language: "no",
      short_description: i.short_description,
      long_description: i.long_description,
    })),
    evaluations: EVALUATIONS.evaluations.map((e: any) => ({
      ID: e.id,
      Charity_ID: e.charity.id,
      Intervention_ID: e.intervention.id,
      valid_from: ym(e.start_year, e.start_month),
      cents_per_output: e.cents_per_output,
      cents_per_output_lower_bound: e.cents_per_output_lower_bound,
      cents_per_output_upper_bound: e.cents_per_output_upper_bound,
      source_name: e.source_name,
      source_url: e.source_url,
      comment: e.comment,
    })),
    grants: GRANTS.max_impact_fund_grants.map((g: any) => ({
      ID: g.id,
      fund: "TCF",
      valid_from: ym(g.start_year, g.start_month),
      legacy_id: g.id,
    })),
    allotments: GRANTS.max_impact_fund_grants.flatMap((g: any) =>
      g.allotment_set.map((a: any) => ({
        ID: a.id,
        Grant_ID: g.id,
        Charity_ID: a.charity.id,
        Intervention_ID: a.intervention.id,
        sum_in_cents: a.sum_in_cents,
        number_outputs_purchased: a.number_outputs_purchased,
        number_outputs_purchased_lower_bound: a.number_outputs_purchased_lower_bound,
        number_outputs_purchased_upper_bound: a.number_outputs_purchased_upper_bound,
        source_name: a.source_name,
        source_url: a.source_url,
        comment: a.comment,
      })),
    ),
    organizations: ORGS,
  };
  return buildImpactData(rows);
}

const DATA = impactDataFromApi();

const distribution = (orgs: [number, string][]): Distribution => ({
  kid: "1",
  donorId: 1,
  taxUnitId: null,
  causeAreas: [
    {
      id: 1,
      standardSplit: false,
      percentageShare: "100",
      organizations: orgs.map(([id, percentageShare]) => ({ id, percentageShare })),
    },
  ],
});

const close = (a: number, b: number, what: string) =>
  expect(Math.abs(a - b) / Math.max(Math.abs(b), 1e-12), `${what}: ${a} vs ${b}`).to.be.below(1e-9);

afterEach(() => sinon.restore());

/** Organizations the legacy receipts never matched to a charity */
const UNMATCHED = ["Sight", "End", "DtW"];

describe("receipts: legacy impact API vs impact tables", () => {
  const stubLegacy = (receipt: (typeof RECEIPTS)[number]) => {
    sinon.stub(results, "getEvaluation").resolves(receipt.evaluations as any);
    sinon.stub(results, "getMaximumImpactGrant").resolves(receipt.grant as any);
    sinon.stub(currency, "getExchangeRateForDate").resolves(receipt.norgesBankRate as any);
    sinon
      .stub(DAO.organizations, "getByIDs")
      .callsFake(
        async (ids: number[]) =>
          ORGS.filter((o) => ids.includes(o.ID)).map((o) => ({ ...o })) as any,
      );
  };

  for (const receipt of RECEIPTS) {
    it(`${receipt.timestamp.slice(0, 10)}: ${receipt.orgs.map(([id]) => ORGS.find((o) => o.ID === id)!.abbriv).join(", ")}`, async () => {
      stubLegacy(receipt);
      const date = new Date(receipt.timestamp);
      const before = await getRemoteImpactEstimatesForDonationByOrg(
        date,
        receipt.sum,
        distribution(receipt.orgs),
      );
      const day = receipt.timestamp.slice(0, 10);
      const after = receiptEstimates(DATA, {
        timestamp: date,
        sum: receipt.sum,
        shares: distributionShares(distribution(receipt.orgs)),
        perUsd: ECB.daily[day],
      });

      // ECB instead of Norges Bank: every output scales by NB rate / ECB rate
      const rateRatio = Number(receipt.norgesBankRate) / ECB.daily[day];
      expect(after.map((o) => o.orgId)).to.deep.equal(before.map((o) => o.orgId));
      for (const [i, org] of after.entries()) {
        const old = before[i];
        if (UNMATCHED.includes(org.orgAbbriv)) {
          // Linked now; the legacy receipts compared the charity's abbreviation with the
          // organization's case-sensitively (END ≠ End, DTW ≠ DtW, SS ≠ Sight): no outputs
          expect(old.outputs).to.deep.equal([]);
          expect(org.outputs.map((o) => o.output)).to.deep.equal(["Ormekurer"]);
          continue;
        }
        expect(
          org.outputs.map((o) => o.output),
          org.orgAbbriv,
        ).to.deep.equal(old.outputs.map((o) => o.output));
        for (const [j, output] of org.outputs.entries()) {
          const factor = output.output === "Drift" ? 1 : rateRatio;
          close(output.numberOfOutputs, old.outputs[j].numberOfOutputs * factor, output.output);
        }
      }
    });
  }

  it("matches the recorded receipt figures", () => {
    const figures = RECEIPTS.map((receipt) =>
      receiptEstimates(DATA, {
        timestamp: new Date(receipt.timestamp),
        sum: receipt.sum,
        shares: distributionShares(distribution(receipt.orgs)),
        perUsd: ECB.daily[receipt.timestamp.slice(0, 10)],
      }).map(
        (o) =>
          `${o.orgAbbriv}: ${o.outputs.map((x) => `${x.roundedNumberOfOutputs} ${x.output}`).join("; ")}`,
      ),
    );
    vexpect(figures).toMatchSnapshot();
  });
});

describe("results page: legacy impact API vs impact tables", () => {
  /** [Org, month, total]: synthetic sums around evaluation changes and the first fund grant */
  const SUMS: MonthlyDonationSum[] = (
    [
      ["AMF", "2016-05", 10000],
      ["AMF", "2019-12", 20000],
      ["AMF", "2020-01", 15000],
      ["AMF", "2023-06", 30000],
      ["AMF", "2026-10", 5000],
      ["End", "2017-05", 3000],
      ["End", "2018-02", 3000],
      ["Sight", "2020-06", 4000],
      ["DtW", "2016-05", 2000],
      ["GD", "2017-01", 6000],
      ["UBI", "2021-05", 7000],
      ["MC", "2016-12", 8000],
      ["HKI", "2018-06", 9000],
      ["NI", "2020-12", 10000],
      ["PHC", "2016-05", 1000],
      ["NLS", "2018-06", 500],
      ["SCI", "2016-05", 2500],
      ["FEM", "2023-05", 1200],
      ["GDZF", "2023-04", 900],
      ["GDCSF", "2024-11", 800],
      ["AGF", "2025-06", 50000],
      ["TCF", "2017-06", 12000],
      ["TCF", "2018-10", 12000],
      ["TCF", "2021-10", 12000],
      ["TCF", "2024-01", 12000],
      ["TCF", "2025-08", 12000],
    ] as [string, string, number][]
  ).map(([Org, DonationMonth, total]) => ({
    Org,
    DonationMonth,
    TotalDonations: String(total),
  }));

  const ecbTable: RateTable = {
    currency: "NOK",
    dates: Object.keys(ECB.monthly).map((m) => `${m}-15`),
    perUsd: Object.values(ECB.monthly),
  };
  const ecbRate = (month: string) => ECB.monthly[month];
  const nbRate = (month: string) => currency.getBestExchangeRate(NB_MONTHLY, month);

  /** The legacy choices: first evaluation on or after the month (else the last), grant on or before (else the first) */
  const legacyRules = (rateFor: (month: string) => number): MonthlyOutputRules => ({
    evaluationFor: (data, charityId, month) => {
      const list = data.evaluationsByCharity.get(charityId) ?? [];
      return list.find((e) => e.validFrom >= `${month}-01`) ?? list[list.length - 1] ?? null;
    },
    grantFor: (data, month) => {
      const list = data.grantsByFund.get("TCF") ?? [];
      const onOrBefore = list.filter((g) => g.validFrom <= `${month}-01`);
      return onOrBefore[onOrBefore.length - 1] ?? list[0] ?? null;
    },
    rateFor,
  });

  /** Every monthly entry as "output|period|org" → numberOfOutputs (direct + smart) */
  const monthlyEntries = (result: MonthlyDonationsPerOrgResult) => {
    const out = new Map<string, number>();
    for (const r of result)
      for (const m of r.monthly)
        for (const o of m.organizations)
          for (const [org, v] of Object.entries(o)) {
            const key = `${r.output}|${m.period}|${org}`;
            out.set(
              key,
              (out.get(key) ?? 0) + v.direct.numberOfOutputs + v.smartDistribution.numberOfOutputs,
            );
          }
    return out;
  };

  const legacy = async () => {
    sinon.stub(DAO.results, "getMonthlyDonationsPerOrg").resolves(SUMS as any);
    sinon.stub(results, "getEvaluations").resolves(EVALUATIONS);
    sinon.stub(results, "getMaximumImpactGrants").resolves(structuredClone(GRANTS));
    sinon.stub(currency, "getExchangeRates").resolves(NB_MONTHLY);
    return getMonthlyDonationsPerOutputRemote();
  };

  it("reproduces the legacy result exactly with the legacy rules and Norges Bank rates", async () => {
    const before = await legacy();
    const rebuilt = buildMonthlyOutputs(DATA, SUMS, legacyRules(nbRate));
    const a = monthlyEntries(rebuilt);
    const b = monthlyEntries(before);
    expect([...a.keys()]).to.deep.equal([...b.keys()]);
    for (const [key, value] of b) close(a.get(key)!, value, key);
    expect(rebuilt.map((r) => r.output)).to.deep.equal(before.map((r) => r.output));
    for (const [i, r] of rebuilt.entries()) {
      close(r.total.numberOfOutputs, before[i].total.numberOfOutputs, `${r.output} total`);
      expect(r.monthly.map((m) => m.period)).to.deep.equal(before[i].monthly.map((m) => m.period));
    }
  });

  it("changes each month's figures by the ECB / Norges Bank rate ratio only", () => {
    const nb = monthlyEntries(buildMonthlyOutputs(DATA, SUMS, legacyRules(nbRate)));
    const ecb = monthlyEntries(buildMonthlyOutputs(DATA, SUMS, legacyRules(ecbRate)));
    for (const [key, value] of nb) {
      const month = key.split("|")[1];
      close(ecb.get(key)!, (value * nbRate(month)) / ecbRate(month), key);
    }
  });

  it("changes figures by the evaluation rule only in the expected months", () => {
    const before = monthlyEntries(buildMonthlyOutputs(DATA, SUMS, legacyRules(ecbRate)));
    const after = monthlyEntries(
      buildMonthlyOutputs(DATA, SUMS, { ...DEFAULT_MONTHLY_RULES(ecbTable), rateFor: ecbRate }),
    );
    // "period Org" of the sum an entry comes from: a direct sum of that org, else the fund's
    const source = (period: string, org: string) =>
      SUMS.find((s) => s.DonationMonth === period && s.Org !== "TCF" && s.Org.toLowerCase() === org)
        ?.Org ?? "TCF";
    const changed = new Set<string>();
    for (const key of new Set([...before.keys(), ...after.keys()])) {
      const [, period, org] = key.split("|");
      const a = after.get(key);
      const b = before.get(key);
      if (a === undefined || b === undefined || Math.abs(a - b) / b > 1e-9)
        changed.add(`${period} ${source(period, org)}`);
    }
    // Months between an evaluation and the next: the legacy page used the next one. Before a
    // charity's first evaluation (End 2017-05) or the fund's first grant (TCF 2017-06) there is
    // no estimate now ("Kroner").
    expect([...changed].sort()).to.deep.equal([
      "2016-05 AMF",
      "2016-05 DtW",
      "2016-05 SCI",
      "2016-12 MC",
      "2017-01 GD",
      "2017-05 End",
      "2017-06 TCF",
      "2018-06 HKI",
      "2019-12 AMF",
      "2020-12 NI",
    ]);
  });

  it("uses each month's average ECB rate", () => {
    const after = buildMonthlyOutputs(DATA, SUMS, DEFAULT_MONTHLY_RULES(ecbTable));
    const bednets = after.find((r) => r.output === "Myggnett")!;
    const jan2020 = bednets.monthly.find((m) => m.period === "2020-01")!;
    // 15 000 NOK at the January 2020 average, 518 cents per net
    close(jan2020.numberOfOutputs, ((15000 / ECB.monthly["2020-01"]) * 100) / 518, "2020-01");
  });
});
