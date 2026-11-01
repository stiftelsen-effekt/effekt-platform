import type { Distribution } from "../../schemas/types";
import { loadUsdRates, rateOn } from "../exchangeRates";
import { getImpactData, type ImpactData } from "./data";
import { estimateDonation, type OrganizationShare } from "./estimate";
import {
  getRemoteImpactEstimatesForDonationByOrg,
  type OrganizationImpactEstimate,
} from "./remote";
import { dayOf, monthOf } from "./rules";
import { impactSource } from "./source";

export type { OrganizationImpactEstimate };

/** A distribution's organization shares (0..1); throws if they don't add up to 1 */
export function distributionShares(distribution: Distribution): OrganizationShare[] {
  const shares = distribution.causeAreas.flatMap((causeArea) =>
    causeArea.organizations.map((org) => ({
      organizationId: org.id,
      share:
        (parseFloat(org.percentageShare) / 100) * (parseFloat(causeArea.percentageShare) / 100),
    })),
  );
  const total = shares.reduce((sum, s) => sum + s.share, 0);
  if (Math.abs(total - 1) > 0.0001) throw new Error("Shares do not sum to 1");
  return shares;
}

/**
 * Rounds every output to the decimals the smallest one needs to not show as 0 (at most 3),
 * Norwegian decimal comma. As the receipts always did.
 */
export function roundOutputs(results: OrganizationImpactEstimate[]): OrganizationImpactEstimate[] {
  const all = results.flatMap((r) => r.outputs.map((o) => o.numberOfOutputs));
  const lowest = Math.min(...all);
  let decimals = 0;
  while (parseFloat(lowest.toFixed(decimals)) === 0 && decimals < 3) decimals++;
  for (const result of results) {
    result.outputs = result.outputs.map((output) => ({
      ...output,
      roundedNumberOfOutputs: (
        Math.round(output.numberOfOutputs * Math.pow(10, decimals)) / Math.pow(10, decimals)
      )
        .toFixed(decimals)
        .replace(/\./, ","),
    }));
  }
  return results;
}

/**
 * A receipt's estimates per organization (pure). Same shape and rules as before the move:
 * Norwegian output names, one output per fund grant allotment, "Drift" (operations) as its NOK
 * sum, and an organization with no estimate gets no outputs.
 */
export function receiptEstimates(
  data: ImpactData,
  input: { timestamp: Date; sum: number; shares: OrganizationShare[]; perUsd: number },
): OrganizationImpactEstimate[] {
  const month = monthOf(input.timestamp);
  const results: OrganizationImpactEstimate[] = [];
  for (const { organizationId, share } of input.shares) {
    const orgAbbriv = data.organizationAbbreviations.get(organizationId) ?? "";
    let result = results.find((r) => r.orgId === organizationId);
    if (!result) {
      result = { orgAbbriv, orgId: organizationId, outputs: [] };
      results.push(result);
    }
    if (orgAbbriv === "Drift") {
      result.outputs.push({
        output: "Drift",
        numberOfOutputs: input.sum * share,
        roundedNumberOfOutputs: "",
      });
      continue;
    }
    const estimate = estimateDonation(data, {
      month,
      amount: input.sum,
      perUsd: input.perUsd,
      shares: [{ organizationId, share }],
      language: "no",
    });
    for (const line of estimate.lines) {
      result.outputs.push({
        output: line.unit,
        numberOfOutputs: line.outputs,
        roundedNumberOfOutputs: "",
      });
    }
  }
  return roundOutputs(results);
}

/**
 * The impact estimates for a receipt (mail.ts): from the local impact tables and ECB rates, or
 * from the legacy impact API with IMPACT_SOURCE=remote. Falls back to the legacy API when the
 * rate table has no NOK rate on or before the donation's day (before the first backfill).
 */
export async function getImpactEstimatesForDonationByOrg(
  donationDate: Date,
  donationSum: number,
  distribution: Distribution,
): Promise<OrganizationImpactEstimate[]> {
  if (impactSource() === "remote")
    return getRemoteImpactEstimatesForDonationByOrg(donationDate, donationSum, distribution);

  const shares = distributionShares(distribution);
  const day = dayOf(donationDate);
  const [data, rates] = await Promise.all([getImpactData(), loadUsdRates("NOK", day, day)]);
  const rate = rateOn(rates, day);
  if (!rate) {
    console.warn(`No NOK exchange rate on or before ${day}; using the legacy impact API`);
    return getRemoteImpactEstimatesForDonationByOrg(donationDate, donationSum, distribution);
  }
  return receiptEstimates(data, {
    timestamp: donationDate,
    sum: donationSum,
    shares,
    perUsd: rate.perUsd,
  });
}
