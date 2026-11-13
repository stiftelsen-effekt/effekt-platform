import { stegaClean } from "@sanity/client/stega";
import { currencyForLocale } from "../../../shared/components/Widget/utils/currency";
import { getFormattingLocale } from "../../../../util/formatting";
import { fetchInterventionCosts } from "../InterventionWidget/impactCosts";

type OrganizationWithCost = {
  abbriviation?: string | null;
  invervention_cost?: string | null;
  [key: string]: unknown;
};

/** "58 kr" style amount in the site's currency; whole units from 10 up, one decimal below */
export const formatCostPerOutput = (cost: number, currency: string, locale: string): string => {
  const digits = cost >= 10 ? 0 : 1;
  return new Intl.NumberFormat(getFormattingLocale(locale), {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
    .format(cost)
    .replace(/ /g, " ");
};

/**
 * Fills `invervention_cost` on every organizations list block of a page from the impact data
 * (site.impactCosts), at build time, in the site's own currency. An organization without an
 * abbreviation or an estimate keeps the text typed in Sanity, and so does every one if the lookup
 * fails, so the page still builds.
 */
export async function withImpactCosts<T>(content: T, mainLocale: string | null | undefined) {
  const blocks: any[] = Array.isArray(content)
    ? content.filter((b: any) => b?._type === "organizationslist")
    : [];
  const organizations: OrganizationWithCost[] = blocks.flatMap((b) => b.organizations ?? []);
  const abbreviations = organizations
    .map((o) => stegaClean(o?.abbriviation ?? ""))
    .filter((a): a is string => !!a);
  if (abbreviations.length === 0) return content;

  const locale = stegaClean(mainLocale) || "no";
  const currency = currencyForLocale(locale);
  let costs;
  try {
    costs = await fetchInterventionCosts({ abbreviations, locale, currency });
  } catch (err) {
    console.error("Could not fetch impact costs for the organizations list", err);
    return content;
  }

  for (const organization of organizations) {
    const cost = costs.get(stegaClean(organization?.abbriviation ?? "").toUpperCase());
    if (cost) {
      organization.invervention_cost = formatCostPerOutput(cost.costPerOutput, currency, locale);
    }
  }
  return content;
}
