import { IMPACT_LANGUAGES } from "@effekt/api/impact";
import { impactTrpcFor } from "../../../../lib/trpc/client";

export type InterventionCost = {
  /** In the site's currency */
  costPerOutput: number;
  /** The output's name in the site's language ("Myggnett") */
  shortDescription: string;
};

type ImpactLanguage = (typeof IMPACT_LANGUAGES)[number];

/** The impact API's language for a site locale; English for one it has no texts for */
export const impactLanguage = (locale: string): ImpactLanguage =>
  (IMPACT_LANGUAGES as readonly string[]).includes(locale) ? (locale as ImpactLanguage) : "en";

/**
 * What one output costs today per charity abbreviation (site.impactCosts on the Norwegian API,
 * docs/impact-api-migration.md). Abbreviations without an estimate are missing from the map.
 */
export async function fetchInterventionCosts({
  abbreviations,
  locale,
  currency,
}: {
  abbreviations: string[];
  /** The site's main_locale (no, dk, sv) */
  locale: string;
  currency: string;
}): Promise<Map<string, InterventionCost>> {
  const costs = await impactTrpcFor(locale).site.impactCosts.query({
    abbreviations: Array.from(new Set(abbreviations)),
    language: impactLanguage(locale),
    currency,
  });
  return new Map(
    costs.map((c) => [
      c.abbreviation.toUpperCase(),
      { costPerOutput: c.costPerOutput, shortDescription: c.shortDescription },
    ]),
  );
}
