/**
 * Impact (GiveWell cost per output): shared shapes and helpers for the pages under /impact. The
 * API (impact.*) works out which months each estimate and grant covers; the rule is that a
 * donation uses the charity's latest estimate on or before its month, and money to the Top
 * Charities Fund is split like the fund's latest grant on or before its month.
 * See docs/impact-api-migration.md.
 */
import { formatDate, formatNumber } from "@/lib/format";
import type { RouterOutputs } from "@/lib/trpc";

export type ImpactEstimate = RouterOutputs["impact"]["estimates"]["list"][number];
export type ImpactTimeline = RouterOutputs["impact"]["estimates"]["charity"];
export type ImpactGrantRow = RouterOutputs["impact"]["grants"]["list"][number];
export type ImpactGrant = RouterOutputs["impact"]["grants"]["get"];
export type ImpactAllotment = ImpactGrant["allotments"][number];
export type ImpactCharity = RouterOutputs["impact"]["charities"]["list"][number];
export type ImpactIntervention = RouterOutputs["impact"]["interventions"]["list"][number];
export type ImpactRates = RouterOutputs["impact"]["exchangeRates"];

export type AgfPortfolioRow = RouterOutputs["impact"]["agf"]["portfolio"][number];
export type GivewellGrant = RouterOutputs["impact"]["agf"]["grants"][number];
export const givewellGrantTypes = ["program", "research", "scoping", "ta", "org_support"] as const;
export const grantTypeLabels: Record<(typeof givewellGrantTypes)[number], string> = {
  program: "Programme",
  research: "Research",
  scoping: "Scoping",
  ta: "Technical assistance",
  org_support: "Organisational support",
};
/** "7–11× cash transfers"; null without an estimate */
export function formatCeMultiple(g: Pick<GivewellGrant, "ceLow" | "ceHigh" | "ceBenchmark">) {
  if (g.ceLow === null) return null;
  const range =
    g.ceHigh !== null && g.ceHigh !== g.ceLow
      ? `${formatNumber(g.ceLow)}–${formatNumber(g.ceHigh)}`
      : formatNumber(g.ceLow);
  return `${range}× ${g.ceBenchmark ?? ""}`.trim();
}

export const impactFunds = ["TCF", "AGF"] as const;
export type ImpactFund = (typeof impactFunds)[number];
export const fundLabels: Record<ImpactFund, string> = {
  TCF: "Top Charities Fund",
  AGF: "All Grants Fund",
};

export const textLanguages = ["no", "sv", "et", "dk"] as const;
export type TextLanguage = (typeof textLanguages)[number];
export const languageLabels: Record<TextLanguage, string> = {
  no: "Norwegian",
  sv: "Swedish",
  et: "Estonian",
  dk: "Danish",
};

/** USD cents as dollars with two decimals, Norwegian digits: 585 → "5,85 USD" */
export function formatUsdCents(cents: number | null | undefined, { decimals = 2 } = {}) {
  if (cents == null) return "–";
  return `${formatNumber(cents / 100, { decimals })} USD`;
}

/** Whether an estimate or grant applies now, applied before, or starts later */
export type CoverageState = "current" | "superseded" | "upcoming";

export function coverageState(
  row: { validFrom: string; current: boolean },
  currentMonth: string,
): CoverageState {
  if (row.current) return "current";
  return row.validFrom > currentMonth ? "upcoming" : "superseded";
}

/** "Jan 2023 – Dec 2024", "From Jan 2023" (the newest), "Jan 2023" (one month) */
export function formatMonthRange(from: string, to: string | null) {
  if (to === null) return `From ${formatDate(from, "month")}`;
  if (to === from) return formatDate(from, "month");
  return `${formatDate(from, "month")} – ${formatDate(to, "month")}`;
}

/** "47 months", "1 month" */
export function formatMonths(count: number) {
  return `${formatNumber(count)} ${count === 1 ? "month" : "months"}`;
}

/** The current month (YYYY-MM-01) in Oslo */
export function osloCurrentMonth(now = new Date()) {
  const [year, month] = now.toLocaleDateString("sv-SE", { timeZone: "Europe/Oslo" }).split("-");
  return `${year}-${month}-01`;
}
