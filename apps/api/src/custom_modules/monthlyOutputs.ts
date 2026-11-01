import { DAO } from "./DAO";
import { getBestExchangeRate, getExchangeRates } from "./currency";
import { loadUsdRates, rateOn, type RateTable } from "./exchangeRates";
import {
  getImpactData,
  type ImpactData,
  type ImpactEvaluation,
  type ImpactGrant,
} from "./impact/data";
import { effectiveEvaluation, effectiveGrant, grantSplit, interventionText } from "./impact/rules";
import { impactSource } from "./impact/source";
import { getEvaluations, getMaximumImpactGrants } from "./results";

/*
 * The results page's outputs per month (REST GET /results/donations/monthly/outputs and tRPC
 * site.monthlyOutputs): donations per organisation and month, turned into outputs (bed nets,
 * vaccinations, ...) with the impact tables and ECB USD/NOK rates (docs/impact-api-migration.md):
 * a month uses each charity's latest evaluation on or before it, and the Top Charities Fund's
 * latest grant on or before it; money is converted at the month's average ECB rate. A month
 * with no evaluation (or no grant) yet counts as "Kroner", as organisations without evaluations
 * always have. Only runs at website build time; memoised for 15 minutes.
 *
 * IMPACT_SOURCE=remote uses the legacy impact API and Norges Bank instead (for one release).
 */

export type MonthlyDonationsPerOrgResult = {
  output: string;
  total: AggregatedOrgResult;
  monthly: AggregatedOrgResult[];
}[];

type AggregatedOrgResult = {
  period: string;
  numberOfOutputs: number;
  organizations: {
    [key: string]: {
      direct: {
        sum: number;
        numberOfOutputs: number;
      };
      smartDistribution: {
        sum: number;
        numberOfOutputs: number;
      };
    };
  }[];
};

/** The legacy computation: the impact API's evaluations and Norges Bank's monthly USD/NOK rates */
export async function getMonthlyDonationsPerOutputRemote(): Promise<MonthlyDonationsPerOrgResult> {
  let donationSums = await DAO.results.getMonthlyDonationsPerOrg();
  // No figures (the Swedish API can't read the analysis database): skip the impact API and rates
  if (donationSums.length === 0) return [];

  const evaluations = await getEvaluations();
  const exchangeRates = await getExchangeRates();

  const directToOrgs = donationSums.filter((donationSum) => donationSum.Org !== "TCF");

  const result: MonthlyDonationsPerOrgResult = [];
  for (const donationSum of directToOrgs) {
    // Find first evaluation for the charity after the donation month
    const relevantEvaluation = evaluations.evaluations
      .filter(
        (e) => e.charity.abbreviation.toLowerCase() === mapOrgToApi(donationSum.Org.toLowerCase()),
      )
      .sort((a, b) => {
        if (a.start_year === b.start_year) {
          return a.start_month - b.start_month;
        }
        return a.start_year - b.start_year;
      })
      .filter((evaluation, i, filtered) => {
        // Same year, same month or later
        if (
          evaluation.start_year === parseInt(donationSum.DonationMonth.split("-")[0]) &&
          evaluation.start_month >= parseInt(donationSum.DonationMonth.split("-")[1])
        ) {
          return true;
        }
        // Later year
        if (evaluation.start_year > parseInt(donationSum.DonationMonth.split("-")[0])) {
          return true;
        }
        // If last evaluation available for charity return true
        if (i === filtered.length - 1) {
          return true;
        }
      })[0];

    let output: string;
    let centsPerOutput: number;
    if (!relevantEvaluation) {
      output = "Kroner";
      centsPerOutput = 100;
    } else {
      if (relevantEvaluation.intervention.short_description.startsWith("Dollar mottatt")) {
        output = "Dollar mottatt";
      } else {
        output = relevantEvaluation.intervention.short_description;
      }

      centsPerOutput = relevantEvaluation.cents_per_output;
    }

    const total = parseInt(donationSum.TotalDonations);
    const outputIndex = result.findIndex((r) => r.output === output);

    const exchangeRate = getBestExchangeRate(exchangeRates, donationSum.DonationMonth);
    const sumInCents = (total / exchangeRate) * 100;
    const org = donationSum.Org.toLowerCase();

    /** Output not in results yet */
    if (outputIndex === -1) {
      result.push({
        output,
        total: {
          period: "Total",
          numberOfOutputs: sumInCents / centsPerOutput,
          organizations: [
            {
              [org]: {
                direct: {
                  sum: total,
                  numberOfOutputs: sumInCents / centsPerOutput,
                },
                smartDistribution: {
                  sum: 0,
                  numberOfOutputs: 0,
                },
              },
            },
          ],
        },
        monthly: [
          {
            period: donationSum.DonationMonth,
            numberOfOutputs: sumInCents / centsPerOutput,
            organizations: [
              {
                [org]: {
                  direct: {
                    sum: total,
                    numberOfOutputs: sumInCents / centsPerOutput,
                  },
                  smartDistribution: {
                    sum: 0,
                    numberOfOutputs: 0,
                  },
                },
              },
            ],
          },
        ],
      });
      continue;
    }

    /** Output is in results, but we don't see the organization in the organizations array */
    /** Add the organization to the organizations array and update the totals */
    if (!result[outputIndex].total.organizations.find((o) => o[org])) {
      // Add to totals
      result[outputIndex].total.organizations.push({
        [org]: {
          direct: {
            sum: total,
            numberOfOutputs: sumInCents / centsPerOutput,
          },
          smartDistribution: {
            sum: 0,
            numberOfOutputs: 0,
          },
        },
      });
      result[outputIndex].total.numberOfOutputs += sumInCents / centsPerOutput;
    } else {
      // Update totals
      const orgIndex = result[outputIndex].total.organizations.findIndex((o) => o[org]);
      result[outputIndex].total.organizations[orgIndex][org].direct.sum += total;
      result[outputIndex].total.organizations[orgIndex][org].direct.numberOfOutputs +=
        sumInCents / centsPerOutput;
      result[outputIndex].total.numberOfOutputs += sumInCents / centsPerOutput;
    }

    // Add to monthly
    const periodIndex = result[outputIndex].monthly.findIndex(
      (m) => m.period === donationSum.DonationMonth,
    );
    if (periodIndex === -1) {
      result[outputIndex].monthly.push({
        period: donationSum.DonationMonth,
        numberOfOutputs: sumInCents / centsPerOutput,
        organizations: [
          {
            [org]: {
              direct: {
                sum: total,
                numberOfOutputs: sumInCents / centsPerOutput,
              },
              smartDistribution: {
                sum: 0,
                numberOfOutputs: 0,
              },
            },
          },
        ],
      });
    } else {
      result[outputIndex].monthly[periodIndex].organizations.push({
        [org]: {
          direct: {
            sum: total,
            numberOfOutputs: sumInCents / centsPerOutput,
          },
          smartDistribution: {
            sum: 0,
            numberOfOutputs: 0,
          },
        },
      });
      result[outputIndex].monthly[periodIndex].numberOfOutputs += sumInCents / centsPerOutput;
    }
  }

  const maximumImpactGrants = await getMaximumImpactGrants();
  const viaMaximumImpactGrants = donationSums.filter((donationSum) => donationSum.Org === "TCF");

  for (const donationSum of viaMaximumImpactGrants) {
    const sortedGrants = maximumImpactGrants.max_impact_fund_grants.sort((a, b) => {
      if (a.start_year === b.start_year) {
        return a.start_month - b.start_month;
      }
      return a.start_year - b.start_year;
    });

    let relevantIndex = sortedGrants.length - 1;
    for (let i = 0; i < sortedGrants.length; i++) {
      // We want to look BACKWARDS in time, move through
      // sorted grants until we find the first grant that
      // is after the donation month, then we take the previous
      // one
      const grant = sortedGrants[i];
      if (grant.start_year > parseInt(donationSum.DonationMonth.split("-")[0])) {
        relevantIndex = Math.max(i - 1, 0);
        break;
      }
      if (
        grant.start_year === parseInt(donationSum.DonationMonth.split("-")[0]) &&
        grant.start_month > parseInt(donationSum.DonationMonth.split("-")[1])
      ) {
        relevantIndex = Math.max(i - 1, 0);
        break;
      }
    }

    const relevantGrant = sortedGrants[relevantIndex];

    for (const allotment of relevantGrant.allotment_set) {
      const output = allotment.intervention.short_description;
      const centsPerOutput = allotment.sum_in_cents / allotment.number_outputs_purchased;
      const total = parseFloat(donationSum.TotalDonations);

      const outputIndex = result.findIndex((r) => r.output === output);

      const exchangeRate = getBestExchangeRate(exchangeRates, donationSum.DonationMonth);
      let sumInCents = (total / exchangeRate) * 100;
      const shareOfAllotment =
        allotment.sum_in_cents /
        relevantGrant.allotment_set.reduce((acc, allotment) => acc + allotment.sum_in_cents, 0);

      sumInCents = sumInCents * shareOfAllotment;

      const org = mapApiToOrg(allotment.charity.abbreviation.toLowerCase());

      /** Output not in results yet */
      if (outputIndex === -1) {
        result.push({
          output,
          total: {
            period: "Total",
            numberOfOutputs: sumInCents / centsPerOutput,
            organizations: [
              {
                [org]: {
                  direct: {
                    sum: 0,
                    numberOfOutputs: 0,
                  },
                  smartDistribution: {
                    sum: total * shareOfAllotment,
                    numberOfOutputs: sumInCents / centsPerOutput,
                  },
                },
              },
            ],
          },
          monthly: [
            {
              period: donationSum.DonationMonth,
              numberOfOutputs: sumInCents / centsPerOutput,
              organizations: [
                {
                  [org]: {
                    direct: {
                      sum: 0,
                      numberOfOutputs: 0,
                    },
                    smartDistribution: {
                      sum: total * shareOfAllotment,
                      numberOfOutputs: sumInCents / centsPerOutput,
                    },
                  },
                },
              ],
            },
          ],
        });
        continue;
      }

      /** Output is in results, but we don't see the organization in the organizations array */
      /** Add the organization to the organizations array and update the totals */
      if (!result[outputIndex].total.organizations.find((o) => o[org])) {
        // Add to totals
        result[outputIndex].total.organizations.push({
          [org]: {
            direct: {
              sum: 0,
              numberOfOutputs: 0,
            },
            smartDistribution: {
              sum: total * shareOfAllotment,
              numberOfOutputs: sumInCents / centsPerOutput,
            },
          },
        });
        result[outputIndex].total.numberOfOutputs += sumInCents / centsPerOutput;
      } else {
        // Update totals
        const orgIndex = result[outputIndex].total.organizations.findIndex((o) => o[org]);
        result[outputIndex].total.organizations[orgIndex][org].smartDistribution.sum +=
          total * shareOfAllotment;
        result[outputIndex].total.organizations[orgIndex][org].smartDistribution.numberOfOutputs +=
          sumInCents / centsPerOutput;
        result[outputIndex].total.numberOfOutputs += sumInCents / centsPerOutput;
      }

      // Add to monthly
      const periodIndex = result[outputIndex].monthly.findIndex(
        (m) => m.period === donationSum.DonationMonth,
      );
      if (periodIndex === -1) {
        result[outputIndex].monthly.push({
          period: donationSum.DonationMonth,
          numberOfOutputs: sumInCents / centsPerOutput,
          organizations: [
            {
              [org]: {
                direct: {
                  sum: 0,
                  numberOfOutputs: 0,
                },
                smartDistribution: {
                  sum: total * shareOfAllotment,
                  numberOfOutputs: sumInCents / centsPerOutput,
                },
              },
            },
          ],
        });
      } else {
        // Check if org is already in the organizations array
        if (!result[outputIndex].monthly[periodIndex].organizations.find((o) => o[org])) {
          result[outputIndex].monthly[periodIndex].organizations.push({
            [org]: {
              direct: {
                sum: 0,
                numberOfOutputs: 0,
              },
              smartDistribution: {
                sum: total * shareOfAllotment,
                numberOfOutputs: sumInCents / centsPerOutput,
              },
            },
          });
        } else {
          // Update totals
          const orgIndex = result[outputIndex].monthly[periodIndex].organizations.findIndex(
            (o) => o[org],
          );
          result[outputIndex].monthly[periodIndex].organizations[orgIndex][
            org
          ].smartDistribution.sum += total * shareOfAllotment;
          result[outputIndex].monthly[periodIndex].organizations[orgIndex][
            org
          ].smartDistribution.numberOfOutputs += sumInCents / centsPerOutput;
        }
        result[outputIndex].monthly[periodIndex].numberOfOutputs += sumInCents / centsPerOutput;
      }
    }
  }

  return result;
}

const mapOrgToApi = (org: string) => {
  if (org === "sight") {
    return "ss";
  }
  return org;
};

const mapApiToOrg = (org: string) => {
  if (org === "ss") {
    return "sight";
  }
  return org;
};

// -------------------------------------------------------------------------------------------------
// From the impact tables

export type MonthlyDonationSum = { Org: string; DonationMonth: string; TotalDonations: string };

/** Which evaluation, grant and rate a month uses; the defaults are the agreed rules */
export type MonthlyOutputRules = {
  evaluationFor: (data: ImpactData, charityId: number, month: string) => ImpactEvaluation | null;
  grantFor: (data: ImpactData, month: string) => ImpactGrant | null;
  /** NOK per USD for a month (YYYY-MM) */
  rateFor: (month: string) => number;
};

/** NOK per USD for a month: the average of the ECB's daily rates in it, else the latest earlier rate */
export function monthlyAverageRate(table: RateTable, month: string): number | null {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < table.dates.length; i++) {
    if (table.dates[i].startsWith(month)) {
      sum += table.perUsd[i];
      count++;
    }
  }
  if (count > 0) return sum / count;
  return rateOn(table, `${month}-31`)?.perUsd ?? null;
}

type Contribution = {
  output: string;
  period: string;
  org: string;
  kind: "direct" | "smartDistribution";
  sum: number;
  numberOfOutputs: number;
};

/**
 * Adds one organisation-month's outputs to the result, in the shape the results page reads:
 * the same branches as the legacy computation, including its quirks (a direct donation always
 * adds a new organisation entry to an existing month).
 */
function addContribution(result: MonthlyDonationsPerOrgResult, c: Contribution) {
  const entry = () => ({
    [c.org]: {
      direct:
        c.kind === "direct"
          ? { sum: c.sum, numberOfOutputs: c.numberOfOutputs }
          : { sum: 0, numberOfOutputs: 0 },
      smartDistribution:
        c.kind === "smartDistribution"
          ? { sum: c.sum, numberOfOutputs: c.numberOfOutputs }
          : { sum: 0, numberOfOutputs: 0 },
    },
  });
  const output = result.find((r) => r.output === c.output);
  if (!output) {
    result.push({
      output: c.output,
      total: { period: "Total", numberOfOutputs: c.numberOfOutputs, organizations: [entry()] },
      monthly: [{ period: c.period, numberOfOutputs: c.numberOfOutputs, organizations: [entry()] }],
    });
    return;
  }

  const totalOrg = output.total.organizations.find((o) => o[c.org]);
  if (!totalOrg) output.total.organizations.push(entry());
  else {
    totalOrg[c.org][c.kind].sum += c.sum;
    totalOrg[c.org][c.kind].numberOfOutputs += c.numberOfOutputs;
  }
  output.total.numberOfOutputs += c.numberOfOutputs;

  const month = output.monthly.find((m) => m.period === c.period);
  if (!month) {
    output.monthly.push({
      period: c.period,
      numberOfOutputs: c.numberOfOutputs,
      organizations: [entry()],
    });
    return;
  }
  const monthOrg = c.kind === "direct" ? undefined : month.organizations.find((o) => o[c.org]);
  if (!monthOrg) month.organizations.push(entry());
  else {
    monthOrg[c.org].smartDistribution.sum += c.sum;
    monthOrg[c.org].smartDistribution.numberOfOutputs += c.numberOfOutputs;
  }
  month.numberOfOutputs += c.numberOfOutputs;
}

export const DEFAULT_MONTHLY_RULES = (rates: RateTable): MonthlyOutputRules => ({
  evaluationFor: (data, charityId, month) => effectiveEvaluation(data, charityId, `${month}-01`),
  grantFor: (data, month) => effectiveGrant(data, "TCF", `${month}-01`),
  rateFor: (month) => {
    const rate = monthlyAverageRate(rates, month);
    if (rate === null) throw new Error(`No NOK exchange rate for ${month}`);
    return rate;
  },
});

/** The results page's outputs from donation sums per organisation and month (pure) */
export function buildMonthlyOutputs(
  data: ImpactData,
  sums: MonthlyDonationSum[],
  rules: MonthlyOutputRules,
): MonthlyDonationsPerOrgResult {
  const result: MonthlyDonationsPerOrgResult = [];
  const tcfAbbrivs = new Set(
    [...data.fundByOrganization.keys()].map((id) => data.organizationAbbreviations.get(id)),
  );
  const isFund = (org: string) => tcfAbbrivs.has(org) || org === "TCF";
  const charityByOrg = new Map(
    [...data.charities.values()]
      .filter((c) => c.organizationAbbreviation)
      .map((c) => [c.organizationAbbreviation!.toLowerCase(), c]),
  );
  const orgKey = (charityId: number) => {
    const charity = data.charities.get(charityId)!;
    return (charity.organizationAbbreviation ?? charity.abbreviation).toLowerCase();
  };
  const text = (interventionId: number) =>
    interventionText(data.interventions.get(interventionId)!, "no").shortDescription;

  for (const s of sums.filter((s) => !isFund(s.Org))) {
    const org = s.Org.toLowerCase();
    const charity = charityByOrg.get(org);
    const evaluation = charity ? rules.evaluationFor(data, charity.id, s.DonationMonth) : null;
    let output = "Kroner";
    let centsPerOutput = 100;
    if (evaluation) {
      const name = text(evaluation.interventionId);
      output = name.startsWith("Dollar mottatt") ? "Dollar mottatt" : name;
      centsPerOutput = evaluation.centsPerOutput;
    }
    const total = parseInt(s.TotalDonations);
    const sumInCents = (total / rules.rateFor(s.DonationMonth)) * 100;
    addContribution(result, {
      output,
      period: s.DonationMonth,
      org,
      kind: "direct",
      sum: total,
      numberOfOutputs: sumInCents / centsPerOutput,
    });
  }

  for (const s of sums.filter((s) => isFund(s.Org))) {
    const total = parseFloat(s.TotalDonations);
    const sumInCents = (total / rules.rateFor(s.DonationMonth)) * 100;
    const grant = rules.grantFor(data, s.DonationMonth);
    if (!grant) {
      addContribution(result, {
        output: "Kroner",
        period: s.DonationMonth,
        org: s.Org.toLowerCase(),
        kind: "smartDistribution",
        sum: total,
        numberOfOutputs: sumInCents / 100,
      });
      continue;
    }
    for (const part of grantSplit(grant)) {
      addContribution(result, {
        output: text(part.allotment.interventionId),
        period: s.DonationMonth,
        org: orgKey(part.allotment.charityId),
        kind: "smartDistribution",
        sum: total * part.share,
        numberOfOutputs: (sumInCents * part.share) / part.centsPerOutput,
      });
    }
  }
  return result;
}

/** From the impact tables and the ECB rates */
export async function getMonthlyDonationsPerOutputLocal(): Promise<MonthlyDonationsPerOrgResult> {
  const sums = await DAO.results.getMonthlyDonationsPerOrg();
  if (sums.length === 0) return [];
  const months = sums.map((s) => s.DonationMonth).sort();
  const [data, rates] = await Promise.all([
    getImpactData(),
    loadUsdRates("NOK", `${months[0]}-01`, `${months[months.length - 1]}-31`),
  ]);
  return buildMonthlyOutputs(data, sums, DEFAULT_MONTHLY_RULES(rates));
}

const MEMO_MS = 15 * 60 * 1000;
let memo: { at: number; result: Promise<MonthlyDonationsPerOrgResult> } | null = null;

/** The results page's outputs per month (memoised for 15 minutes; see the top of the file) */
export async function getMonthlyDonationsPerOutput(): Promise<MonthlyDonationsPerOrgResult> {
  if (impactSource() === "remote") return getMonthlyDonationsPerOutputRemote();
  if (!memo || Date.now() - memo.at > MEMO_MS) {
    const result = getMonthlyDonationsPerOutputLocal().catch(async (e) => {
      console.warn("Monthly outputs from the impact tables failed; using the legacy impact API", e);
      return getMonthlyDonationsPerOutputRemote();
    });
    memo = { at: Date.now(), result };
    // Only keep a non-empty result (no rows: the analysis database was not readable)
    result.then(
      (value) => {
        if (value.length === 0 && memo?.result === result) memo = null;
      },
      () => {
        if (memo?.result === result) memo = null;
      },
    );
  }
  return memo.result;
}

/** Drops the memoised result (tests, impact edits) */
export function clearMonthlyOutputsMemo() {
  memo = null;
}
