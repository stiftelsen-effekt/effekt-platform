import { DateTime } from "luxon";
import { loadUsdRates, rateOn } from "../exchangeRates";
import { OSLO_ZONE } from "../osloDays";
import { getImpactData, type ImpactLanguage } from "./data";
import { effectiveEvaluation, interventionText } from "./rules";

export type ImpactCost = {
  abbreviation: string;
  charityId: number;
  charityName: string;
  interventionId: number;
  shortDescription: string;
  longDescription: string;
  centsPerOutput: number;
  costPerOutput: number;
  currency: string;
  validFrom: string;
  exchangeRateDate: string;
};

/**
 * What one output costs on a day (default today, Oslo), per charity abbreviation, for the
 * intervention widget (site.impactCosts): the charity's latest evaluation on or before that
 * month, converted at the ECB rate of that day or the latest earlier one. Abbreviations
 * without a charity or an evaluation, or a currency without a rate, are left out.
 */
export async function getImpactCosts(input: ImpactCostsInput): Promise<ImpactCost[]> {
  const day = input.at ?? DateTime.now().setZone(OSLO_ZONE).toISODate()!;
  const key = JSON.stringify([input.abbreviations, input.language, input.currency, day]);
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.result;
  const result = await computeImpactCosts({ ...input, at: day });
  // An empty answer may be a missing rate (before the first backfill): don't keep it
  if (result.length > 0) {
    if (memo.size >= MEMO_MAX) memo.clear();
    memo.set(key, { at: Date.now(), result });
  }
  return result;
}

type ImpactCostsInput = {
  abbreviations: string[];
  language: ImpactLanguage;
  currency: string;
  at?: string;
};

/** Answers for an hour, as long as the HTTP cache header; bounded, the inputs come from the public */
const MEMO_MS = 60 * 60 * 1000;
const MEMO_MAX = 500;
const memo = new Map<string, { at: number; result: ImpactCost[] }>();

/** Drops memoised answers (tests, impact edits) */
export function clearImpactCostsMemo() {
  memo.clear();
}

async function computeImpactCosts(input: ImpactCostsInput & { at: string }): Promise<ImpactCost[]> {
  const day = input.at;
  const month = `${day.slice(0, 7)}-01`;
  const [data, rates] = await Promise.all([
    getImpactData(),
    loadUsdRates(input.currency, day, day),
  ]);
  const rate = rateOn(rates, day);
  if (!rate) return [];

  const byAbbreviation = new Map(
    [...data.charities.values()].map((c) => [c.abbreviation.toUpperCase(), c]),
  );
  const out: ImpactCost[] = [];
  const seen = new Set<string>();
  for (const requested of input.abbreviations) {
    const charity = byAbbreviation.get(requested.toUpperCase());
    if (!charity || seen.has(charity.abbreviation)) continue;
    seen.add(charity.abbreviation);
    const evaluation = effectiveEvaluation(data, charity.id, month);
    if (!evaluation) continue;
    const text = interventionText(
      data.interventions.get(evaluation.interventionId)!,
      input.language,
    );
    out.push({
      abbreviation: charity.abbreviation,
      charityId: charity.id,
      charityName: charity.name,
      interventionId: evaluation.interventionId,
      shortDescription: text.shortDescription,
      longDescription: text.longDescription,
      centsPerOutput: evaluation.centsPerOutput,
      costPerOutput: (evaluation.centsPerOutput * rate.perUsd) / 100,
      currency: rates.currency,
      validFrom: evaluation.validFrom,
      exchangeRateDate: rate.date,
    });
  }
  return out;
}
