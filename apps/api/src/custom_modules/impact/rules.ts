import { DateTime } from "luxon";
import { OSLO_ZONE } from "../osloDays";
import type {
  ImpactAllotment,
  ImpactData,
  ImpactEvaluation,
  ImpactFund,
  ImpactGrant,
  ImpactIntervention,
  ImpactLanguage,
} from "./data";

/**
 * The rules that turn the impact tables into figures (docs/impact-api-migration.md):
 *
 * - A donation uses the charity's latest evaluation on or before the donation's month
 *   (decision 1). Before a charity's first evaluation there is no estimate.
 * - Money to a fund (the Top Charities Fund) is split like the fund's latest grant on or before
 *   the donation's month (decision 3: the latest grant keeps applying after it).
 * - Amounts become USD with the ECB rate of the donation's day (decision 2, exchangeRates.ts).
 */

/** The donation's month as YYYY-MM-01 (Oslo calendar) */
export function monthOf(instant: Date | string): string {
  const dt =
    typeof instant === "string"
      ? DateTime.fromISO(instant, { zone: OSLO_ZONE })
      : DateTime.fromJSDate(instant, { zone: OSLO_ZONE });
  return dt.startOf("month").toISODate()!;
}

/** The donation's day as YYYY-MM-DD (Oslo calendar), for exchange rates */
export function dayOf(instant: Date): string {
  return DateTime.fromJSDate(instant, { zone: OSLO_ZONE }).toISODate()!;
}

/** The latest item with validFrom on or before `month` (items sorted oldest first) */
function latestOnOrBefore<T extends { validFrom: string }>(items: T[] | undefined, month: string) {
  let found: T | null = null;
  for (const item of items ?? []) {
    if (item.validFrom <= month) found = item;
    else break;
  }
  return found;
}

/** The evaluation that applies to a donation to `charityId` in `month` (YYYY-MM-01), if any */
export function effectiveEvaluation(
  data: ImpactData,
  charityId: number,
  month: string,
): ImpactEvaluation | null {
  return latestOnOrBefore(data.evaluationsByCharity.get(charityId), month);
}

/** The fund grant whose split applies to a donation in `month` (YYYY-MM-01), if any */
export function effectiveGrant(
  data: ImpactData,
  fund: ImpactFund,
  month: string,
): ImpactGrant | null {
  return latestOnOrBefore(data.grantsByFund.get(fund), month);
}

export type GrantSplitPart = {
  allotment: ImpactAllotment;
  /** Share of the grant's sum, 0..1 */
  share: number;
  /** USD cents per output */
  centsPerOutput: number;
};

/** A grant's allotments with their share of the grant and their cost per output */
export function grantSplit(grant: ImpactGrant): GrantSplitPart[] {
  const total = grant.allotments.reduce((sum, a) => sum + a.sumInCents, 0);
  if (total <= 0) return [];
  return grant.allotments.map((allotment) => ({
    allotment,
    share: allotment.sumInCents / total,
    centsPerOutput: allotment.sumInCents / allotment.numberOutputsPurchased,
  }));
}

/** Outputs bought by `amount` (in a currency with `perUsd` units per USD) at `centsPerOutput` */
export function outputsFor(amount: number, perUsd: number, centsPerOutput: number): number {
  return ((amount / perUsd) * 100) / centsPerOutput;
}

/** An intervention's texts in `language`, falling back to English */
export function interventionText(intervention: ImpactIntervention, language: ImpactLanguage) {
  const text = language === "en" ? undefined : intervention.texts[language];
  return {
    shortDescription: text?.shortDescription || intervention.shortDescription,
    longDescription: text?.longDescription || intervention.longDescription,
  };
}
