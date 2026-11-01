import { Donation, DonationImpactEntry } from "../../../../models";
import { mapNameToOrgAbbriv } from "../../../../util/mappings";
import type { AggregatedImpactTableConfiguration } from "./DonationsAggregateImpactTable";

export type AggregatedImpact = {
  // Output name
  [key: string]: {
    outputs: number;
    constituents: {
      // The label of the constituent, e.g.
      // "Schistosomiasis Control Initiative via fond"
      // "Deworm the World Initiative direkte fordelt"
      // Value is the number of kr. donated through this constituent
      [key: string]: number;
    };
  };
};

export const GIVEWELL_ALL_GRANTS_FUND_KEY = "GiveWell All Grants Fund";
export const DK_OPERATIONS_KEY = "Giv Effektivts arbejde og vækst";

type TemplateStrings = Pick<
  AggregatedImpactTableConfiguration,
  "org_grant_template_string" | "org_direct_template_string"
>;

const isOperations = (name: string | null) =>
  !!name && (name.toLowerCase().includes("drift") || mapNameToOrgAbbriv(name) === "Drift");

const isAllGrantsFund = (entry: DonationImpactEntry) =>
  entry.organization !== null && mapNameToOrgAbbriv(entry.organization) === "AGF";

/**
 * Lower-cases an output name for display ("Myggnett" → "myggnett"), except names like
 * "A-vitamintilskudd"
 */
export const formatOutputType = (outputtype: string) =>
  outputtype.match(/[A-Z]-/) ? outputtype : outputtype.toLowerCase();

/**
 * Min Side's impact table (Norway) from the donations' `impact` entries, which
 * minside.donations computes on the server (docs/impact-api-migration.md):
 *
 * - one row per output ("myggnett"), summing the outputs; its constituents are the kroner per
 *   charity, split into money through a fund ("{{org}} via fond", the fund's grant recipient) and
 *   money given directly ("{{org}} direkte", the organization)
 * - operations ("Drift") and the All Grants Fund as kroner rows, as before
 * - other organizations without an estimate are left out, as before
 *
 * Donations without `impact` (no figures yet) add nothing.
 */
export const aggregateImpact = (
  donations: Donation[],
  textTemplates: TemplateStrings,
): AggregatedImpact => {
  const impact: AggregatedImpact = {};
  const add = (key: string, outputs: number, constituent?: [string, number]) => {
    impact[key] ??= { outputs: 0, constituents: {} };
    impact[key].outputs += outputs;
    if (constituent) {
      const [label, amount] = constituent;
      impact[key].constituents[label] = (impact[key].constituents[label] ?? 0) + amount;
    }
  };

  for (const donation of donations) {
    for (const entry of donation.impact ?? []) {
      if (entry.count === null) {
        if (isOperations(entry.organization)) add(entry.organization!, entry.amount);
        else if (isAllGrantsFund(entry)) add(GIVEWELL_ALL_GRANTS_FUND_KEY, entry.amount);
        continue;
      }
      if (!entry.unit) continue;
      const label = entry.viaFund
        ? textTemplates.org_grant_template_string.replace("{{org}}", entry.recipient)
        : textTemplates.org_direct_template_string.replace(
            "{{org}}",
            entry.organization ?? entry.recipient,
          );
      add(formatOutputType(entry.unit), entry.count, [label, entry.amount]);
    }
  }
  return impact;
};

/**
 * The Danish site's impact table: the Danish backend's entries summed per output, with the
 * operations entries ("Giv Effektivt") as one kroner row
 */
export const aggregateDanishImpact = (donations: Donation[]): AggregatedImpact => {
  const impact: AggregatedImpact = {};
  donations.forEach((donation) => {
    donation.impact?.forEach((entry) => {
      if (entry.recipient === "Giv Effektivt") {
        impact[DK_OPERATIONS_KEY] ??= { outputs: 0, constituents: {} };
        impact[DK_OPERATIONS_KEY].outputs += entry.amount;
      } else {
        const unit = entry.unit ?? "";
        impact[unit] ??= { outputs: 0, constituents: {} };
        impact[unit].outputs += entry.count ?? 0;
        impact[unit].constituents[entry.recipient] ??= 0;
        impact[unit].constituents[entry.recipient] += entry.amount;
      }
    });
  });
  return impact;
};
