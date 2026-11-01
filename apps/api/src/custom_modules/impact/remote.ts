import { Distribution } from "../../schemas/types";
import { DAO } from "../DAO";
import {
  ImpactEvaluationsResponse,
  ImpactGrantResponse,
  getEvaluation,
  getMaximumImpactGrant,
} from "../results";
import { getExchangeRateForDate } from "../currency";

/**
 * The receipts' impact estimates from the legacy impact API (impact.gieffektivt.no) and Norges
 * Bank, as before the move to local tables. Used only with IMPACT_SOURCE=remote, or when the
 * local exchange rates are missing; kept for one release (docs/impact-api-migration.md, phase 2),
 * then deleted with results.ts and the Norges Bank helpers in currency.ts.
 */

export type OrganizationImpactEstimate = {
  orgAbbriv: string;
  orgId: number;
  outputs: {
    output: string;
    numberOfOutputs: number;
    roundedNumberOfOutputs: string;
  }[];
};

export const getRemoteImpactEstimatesForDonationByOrg = async (
  donationDate: Date,
  donationSum: number,
  distribution: Distribution,
): Promise<OrganizationImpactEstimate[]> => {
  const distributionOrgIds = distribution.causeAreas.flatMap((causeArea) =>
    causeArea.organizations.map((org) => org.id),
  );

  const orgs = await DAO.organizations.getByIDs(distributionOrgIds);

  const abbreviations = orgs.map((org) => org.abbriv).filter((abr) => abr !== "TCF");

  let evaluationsResponse: ImpactEvaluationsResponse | undefined;
  if (abbreviations.length > 0) {
    evaluationsResponse = await getEvaluation(abbreviations, donationDate);
  }

  let grantResponse: ImpactGrantResponse | undefined;
  if (orgs.some((org) => org.abbriv === "TCF")) {
    grantResponse = await getMaximumImpactGrant(donationDate);
  }

  let results: {
    orgAbbriv: string;
    orgId: number;
    outputs: {
      output: string;
      numberOfOutputs: number;
      roundedNumberOfOutputs: string;
    }[];
  }[] = [];

  const allOrgsAndShares = distribution.causeAreas.flatMap((causeArea) =>
    causeArea.organizations.map((org) => ({
      abbriv: orgs.find((o) => o.ID === org.id)!.abbriv,
      share:
        (parseFloat(org.percentageShare) / 100) * (parseFloat(causeArea.percentageShare) / 100),
    })),
  );

  // Validate that the shares sum to 1
  const totalShare = allOrgsAndShares.reduce((acc, curr) => acc + curr.share, 0);
  if (Math.abs(totalShare - 1) > 0.0001) {
    throw new Error("Shares do not sum to 1");
  }

  const exchangeRate = await getExchangeRateForDate(donationDate);

  for (const { abbriv, share } of allOrgsAndShares) {
    let orgResult = results.find((result) => result.orgAbbriv === abbriv);
    if (!orgResult) {
      orgResult = {
        orgAbbriv: abbriv,
        orgId: orgs.find((org) => org.abbriv === abbriv)!.ID,
        outputs: [],
      };
      results.push(orgResult);
    }

    if (abbriv === "TCF") {
      const totalGrantSumInCents = grantResponse!.max_impact_fund_grants[0].allotment_set.reduce(
        (acc, curr) => acc + curr.sum_in_cents,
        0,
      );
      for (const allotment of grantResponse!.max_impact_fund_grants[0].allotment_set) {
        const allotmentShare = allotment.sum_in_cents / totalGrantSumInCents;
        const costPerOutputInCents = allotment.sum_in_cents / allotment.number_outputs_purchased;

        orgResult.outputs.push({
          output: allotment.intervention.short_description,
          numberOfOutputs:
            ((donationSum / exchangeRate) * (share * allotmentShare)) /
            (costPerOutputInCents / 100),
          roundedNumberOfOutputs: "",
        });
      }
    } else if (abbriv === "Drift") {
      orgResult.outputs.push({
        output: "Drift",
        numberOfOutputs: donationSum * share,
        roundedNumberOfOutputs: "",
      });
    } else {
      const evaluation = evaluationsResponse!.evaluations.find(
        (evaluation) => evaluation.charity.abbreviation === abbriv,
      );
      if (evaluation) {
        orgResult.outputs.push({
          output: evaluation.intervention.short_description,
          numberOfOutputs:
            ((donationSum / exchangeRate) * share) / (evaluation.cents_per_output / 100),
          roundedNumberOfOutputs: "",
        });
      }
    }
  }

  // Flatten all outputs to determine the lowest number for rounding
  const allOutputsNumbers = results.flatMap((result) =>
    result.outputs.map((output) => output.numberOfOutputs),
  );

  const lowest = Math.min(...allOutputsNumbers);

  // Determine the number of decimals needed
  let decimals = 0;
  while (parseFloat(lowest.toFixed(decimals)) === 0 && decimals < 3) {
    decimals++;
  }

  // Round the numberOfOutputs for each output
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
};
