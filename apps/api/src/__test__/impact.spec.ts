import { describe, it, afterEach } from "vitest";
import { expect } from "chai";
import sinon from "sinon";
import * as impactData from "../custom_modules/impact/data";
import { buildImpactData, type ImpactRows } from "../custom_modules/impact/data";
import {
  effectiveEvaluation,
  effectiveGrant,
  grantSplit,
  interventionText,
  monthOf,
  outputsFor,
} from "../custom_modules/impact/rules";
import {
  estimateDonation,
  sumImpactEntries,
  toImpactEntries,
} from "../custom_modules/impact/estimate";
import {
  distributionShares,
  getImpactEstimatesForDonationByOrg,
  receiptEstimates,
} from "../custom_modules/impact/receipts";
import * as remote from "../custom_modules/impact/remote";
import * as exchangeRates from "../custom_modules/exchangeRates";
import { monthlyAverageRate } from "../custom_modules/monthlyOutputs";
import type { Distribution } from "../schemas/types";

const text = (Intervention_ID: number, language: string, short_description: string) => ({
  Intervention_ID,
  language,
  short_description,
  long_description: `${short_description} (long)`,
});
const evaluation = (ID: number, Charity_ID: number, valid_from: string, cents: number) => ({
  ID,
  Charity_ID,
  Intervention_ID: Charity_ID === 1 ? 2 : 1,
  valid_from,
  cents_per_output: cents,
  cents_per_output_lower_bound: 0,
  cents_per_output_upper_bound: null,
  source_name: "",
  source_url: "",
  comment: "",
});
const allotment = (ID: number, Grant_ID: number, Charity_ID: number, sum: number, n: number) => ({
  ID,
  Grant_ID,
  Charity_ID,
  Intervention_ID: Charity_ID === 1 ? 2 : 1,
  sum_in_cents: String(sum),
  number_outputs_purchased: n,
  number_outputs_purchased_lower_bound: 0,
  number_outputs_purchased_upper_bound: null,
  source_name: "",
  source_url: "",
  comment: "",
});

/** Organization IDs: 1 AMF, 4 MC, 11 Drift, 12 TCF, 15 AGF, 20 an organization without a charity */
const ROWS: ImpactRows = {
  charities: [
    { ID: 1, name: "Against Malaria Foundation", abbreviation: "AMF", Organization_ID: 1 },
    { ID: 10, name: "Malaria Consortium", abbreviation: "MC", Organization_ID: 4 },
    { ID: 15, name: "GiveWell All Grants Fund", abbreviation: "AGF", Organization_ID: 15 },
    { ID: 9, name: "GiveDirectly UBI", abbreviation: "UBI", Organization_ID: null },
  ],
  interventions: [
    { ID: 1, short_description: "Malaria treatments", long_description: "SMC" },
    { ID: 2, short_description: "Bednets", long_description: "Nets" },
  ],
  texts: [text(1, "no", "Malariabehandlinger"), text(2, "no", "Myggnett"), text(2, "xx", "?")],
  evaluations: [
    evaluation(2, 1, "2022-01-01", 500),
    evaluation(1, 1, "2020-01-01", 400),
    evaluation(3, 10, "2021-06-01", 800),
  ],
  grants: [
    { ID: 2, fund: "TCF", valid_from: "2024-01-01", legacy_id: 20 },
    { ID: 1, fund: "TCF", valid_from: "2019-01-01", legacy_id: 1 },
    { ID: 3, fund: "AGF", valid_from: "2025-01-01", legacy_id: 1 },
  ],
  allotments: [
    // 2024 grant: 75 % AMF at 400 cents, 25 % MC at 1000 cents
    allotment(5, 2, 1, 300000, 750),
    allotment(6, 2, 10, 100000, 100),
    allotment(1, 1, 1, 100, 1),
    allotment(9, 3, 15, 100, 1),
  ],
  organizations: [
    { ID: 1, abbriv: "AMF", full_name: "Against Malaria Foundation" },
    { ID: 4, abbriv: "MC", full_name: "Malaria Consortium" },
    { ID: 11, abbriv: "Drift", full_name: "Drift av Gi Effektivt" },
    { ID: 12, abbriv: "TCF", full_name: "GiveWell Top Charities Fund" },
    { ID: 15, abbriv: "AGF", full_name: "GiveWell All Grants Fund" },
    { ID: 20, abbriv: "FEM", full_name: "Family Empowerment Media" },
  ],
};
const DATA = buildImpactData(ROWS);

describe("impact rules", () => {
  it("takes the latest evaluation on or before the month, none before the first", () => {
    expect(effectiveEvaluation(DATA, 1, "2019-12-01")).to.equal(null);
    expect(effectiveEvaluation(DATA, 1, "2020-01-01")!.id).to.equal(1);
    expect(effectiveEvaluation(DATA, 1, "2021-12-01")!.id).to.equal(1);
    expect(effectiveEvaluation(DATA, 1, "2022-01-01")!.id).to.equal(2);
    expect(effectiveEvaluation(DATA, 1, "2030-01-01")!.id).to.equal(2);
    expect(effectiveEvaluation(DATA, 99, "2030-01-01")).to.equal(null);
  });

  it("takes the fund's latest grant on or before the month", () => {
    expect(effectiveGrant(DATA, "TCF", "2018-12-01")).to.equal(null);
    expect(effectiveGrant(DATA, "TCF", "2023-12-01")!.id).to.equal(1);
    expect(effectiveGrant(DATA, "TCF", "2026-10-01")!.id).to.equal(2);
    expect(effectiveGrant(DATA, "AGF", "2026-10-01")!.legacyId).to.equal(1);
  });

  it("splits a grant by sum and costs each allotment's outputs", () => {
    const split = grantSplit(effectiveGrant(DATA, "TCF", "2024-01-01")!);
    expect(split.map((p) => [p.allotment.id, p.share, p.centsPerOutput])).to.deep.equal([
      [5, 0.75, 400],
      [6, 0.25, 1000],
    ]);
    // 1000 NOK at 10 NOK/USD = 100 USD at 4 USD per output
    expect(outputsFor(1000, 10, 400)).to.equal(25);
  });

  it("uses the Oslo calendar month", () => {
    // 00:30 on 1 February in Oslo (UTC+1), still January in UTC
    expect(monthOf(new Date("2024-01-31T23:30:00Z"))).to.equal("2024-02-01");
    expect(monthOf(new Date("2024-01-31T22:30:00Z"))).to.equal("2024-01-01");
    expect(monthOf(new Date("2024-07-31T21:30:00Z"))).to.equal("2024-07-01");
    expect(monthOf("2024-03-15")).to.equal("2024-03-01");
  });

  it("falls back to English texts and ignores unknown languages", () => {
    const nets = DATA.interventions.get(2)!;
    expect(interventionText(nets, "no").shortDescription).to.equal("Myggnett");
    expect(interventionText(nets, "sv")).to.deep.equal({
      shortDescription: "Bednets",
      longDescription: "Nets",
    });
    expect(Object.keys(nets.texts)).to.deep.equal(["no"]);
  });

  it("splits only the Top Charities Fund by grants", () => {
    expect([...DATA.fundByOrganization]).to.deep.equal([[12, "TCF"]]);
  });
});

describe("estimateDonation and the Danish impact shape", () => {
  const estimate = (shares: [number, number][], month = "2024-05-01") =>
    estimateDonation(DATA, {
      month,
      amount: 1000,
      perUsd: 10,
      shares: shares.map(([organizationId, share]) => ({ organizationId, share })),
      language: "no",
    });

  it("costs a charity by its evaluation and a fund by its grant", () => {
    const { lines, withoutEstimate } = estimate([
      [1, 0.5],
      [12, 0.5],
    ]);
    expect(withoutEstimate).to.deep.equal([]);
    expect(
      lines.map((l) => [l.organizationId, l.charityId, l.unit, l.amount, l.outputs]),
    ).to.deep.equal([
      [1, 1, "Myggnett", 500, 10], // 50 USD at 5 USD
      [12, 1, "Myggnett", 375, 9.375], // 37.5 USD at 4 USD
      [12, 10, "Malariabehandlinger", 125, 1.25], // 12.5 USD at 10 USD
    ]);
  });

  it("has no estimate for AGF, unlinked organizations, Drift or before the first evaluation", () => {
    const { lines, withoutEstimate } = estimate(
      [
        [15, 0.25],
        [20, 0.25],
        [11, 0.25],
        [4, 0.25],
      ],
      "2021-05-01",
    );
    expect(lines).to.deep.equal([]);
    expect(withoutEstimate.map((w) => w.organizationId)).to.deep.equal([15, 20, 11, 4]);
  });

  it("gives Min Side's entries, merged per output, and sums them", () => {
    const a = toImpactEntries(
      DATA,
      estimate([
        [12, 0.8],
        [15, 0.2],
      ]),
    );
    expect(a).to.deep.equal([
      {
        recipient: "Against Malaria Foundation",
        unit: "Myggnett",
        organization: "GiveWell Top Charities Fund",
        organizationId: 12,
        description: "Myggnett (long)",
        amount: 600,
        count: 15,
      },
      {
        recipient: "Malaria Consortium",
        unit: "Malariabehandlinger",
        organization: "GiveWell Top Charities Fund",
        organizationId: 12,
        description: "Malariabehandlinger (long)",
        amount: 200,
        count: 2,
      },
      {
        recipient: "GiveWell All Grants Fund",
        unit: null,
        organization: "GiveWell All Grants Fund",
        organizationId: 15,
        amount: 200,
        count: null,
      },
    ]);
    const total = sumImpactEntries([...a, ...a]);
    expect(total.map((e) => [e.recipient, e.amount, e.count])).to.deep.equal([
      ["Against Malaria Foundation", 1200, 30],
      ["Malaria Consortium", 400, 4],
      ["GiveWell All Grants Fund", 400, null],
    ]);
  });
});

describe("receipts", () => {
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

  afterEach(() => {
    sinon.restore();
    delete process.env.IMPACT_SOURCE;
  });

  it("gives outputs per organization, Drift as its sum, rounded to the smallest's decimals", () => {
    const result = receiptEstimates(DATA, {
      timestamp: new Date("2024-05-15T12:00:00Z"),
      sum: 1000,
      shares: distributionShares(
        distribution([
          [1, "50"],
          [12, "30"],
          [11, "10"],
          [15, "10"],
        ]),
      ),
      perUsd: 10,
    });
    expect(
      result.map((r) => [
        r.orgAbbriv,
        r.outputs.map((o) => `${o.roundedNumberOfOutputs} ${o.output}`),
      ]),
    ).to.deep.equal([
      ["AMF", ["10 Myggnett"]],
      ["TCF", ["6 Myggnett", "1 Malariabehandlinger"]],
      ["Drift", ["100 Drift"]],
      ["AGF", []],
    ]);
  });

  it("rejects distributions that don't add up", () => {
    expect(() => distributionShares(distribution([[1, "90"]]))).to.throw("Shares do not sum to 1");
  });

  it("reads the day's ECB rate, and falls back to the legacy API without one", async () => {
    sinon.stub(impactData, "getImpactData").resolves(DATA);
    const rates = sinon.stub(exchangeRates, "loadUsdRates");
    const legacy = sinon.stub(remote, "getRemoteImpactEstimatesForDonationByOrg").resolves([]);
    rates.resolves({ currency: "NOK", dates: ["2024-05-14"], perUsd: [10] });

    const local = await getImpactEstimatesForDonationByOrg(
      new Date("2024-05-15T12:00:00Z"),
      1000,
      distribution([[1, "100"]]),
    );
    expect(rates.firstCall.args).to.deep.equal(["NOK", "2024-05-15", "2024-05-15"]);
    expect(local[0].outputs[0].numberOfOutputs).to.equal(20);
    expect(legacy.called).to.equal(false);

    sinon.stub(console, "warn");
    rates.resolves({ currency: "NOK", dates: [], perUsd: [] });
    await getImpactEstimatesForDonationByOrg(new Date(), 1000, distribution([[1, "100"]]));
    expect(legacy.callCount).to.equal(1);
  });

  it("uses the legacy API with IMPACT_SOURCE=remote", async () => {
    process.env.IMPACT_SOURCE = "remote";
    const legacy = sinon.stub(remote, "getRemoteImpactEstimatesForDonationByOrg").resolves([]);
    const data = sinon.stub(impactData, "getImpactData");
    await getImpactEstimatesForDonationByOrg(new Date(), 1000, distribution([[1, "100"]]));
    expect(legacy.callCount).to.equal(1);
    expect(data.called).to.equal(false);
  });
});

describe("monthlyAverageRate", () => {
  const table = {
    currency: "NOK",
    dates: ["2024-01-30", "2024-02-01", "2024-02-02", "2024-03-29"],
    perUsd: [9, 10, 11, 12],
  };
  it("averages the month's days, else takes the latest earlier rate", () => {
    expect(monthlyAverageRate(table, "2024-02")).to.equal(10.5);
    expect(monthlyAverageRate(table, "2024-04")).to.equal(12);
    expect(monthlyAverageRate(table, "2023-12")).to.equal(null);
  });
});
