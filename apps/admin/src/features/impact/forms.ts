/**
 * Form models for the impact edit pages: drafts as typed (text), validation that matches the
 * API's (apps/api/src/trpc/schemas/impact.ts), and draft → procedure input.
 */
import { formatNumber } from "@/lib/format";
import type { ImpactEstimate, ImpactGrant } from "./model";

export type Errors<K extends string> = Partial<Record<K, string>>;

/** "01.2026", "1.2026", "2026-01" or "2026-01-01" → "2026-01-01" */
export function parseMonthText(text: string): string | null {
  const value = text.trim();
  let match = /^(\d{1,2})[./](\d{4})$/.exec(value);
  if (match) return monthOf(Number(match[2]), Number(match[1]));
  match = /^(\d{4})-(\d{2})(-01)?$/.exec(value);
  if (match) return monthOf(Number(match[1]), Number(match[2]));
  return null;
}

const monthOf = (year: number, month: number) =>
  month >= 1 && month <= 12 && year >= 2000 && year <= 2100
    ? `${year}-${String(month).padStart(2, "0")}-01`
    : null;

/** "2026-01-01" → "01.2026" */
export const formatMonthText = (month: string) => `${month.slice(5, 7)}.${month.slice(0, 4)}`;

/** US dollars as typed ("5,85", "5.85", "1 234,5") → cents; null if not a positive amount */
export function parseUsd(text: string): number | null {
  const value = text
    .replace(/[\s ]/g, "")
    .replace(/usd|\$/gi, "")
    .replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const cents = Math.round(Number(value) * 100);
  return cents > 0 ? cents : null;
}

/** Cents → dollars for an input: 585 → "5,85" */
export const formatUsdInput = (cents: number | null | undefined) =>
  cents == null ? "" : (cents / 100).toFixed(2).replace(".", ",");

/** A whole number as typed ("1 000 000") → number; null if not a positive integer */
export function parseCount(text: string): number | null {
  const value = text.replace(/[\s ]/g, "");
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n > 0 && n <= 4_294_967_295 ? n : null;
}

const isHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

/** Empty, or http(s) links one per line */
export const sourceUrlError = (text: string) =>
  text.trim() === "" || text.trim().split(/\s+/).every(isHttpUrl)
    ? undefined
    : "Give a full link starting with https://, one per line";

//region Estimates

export type EstimateDraft = {
  interventionId: string;
  month: string;
  cost: string;
  low: string;
  high: string;
  sourceName: string;
  sourceUrl: string;
  comment: string;
};
export type EstimateField = keyof EstimateDraft;

export function estimateDraft(estimate?: ImpactEstimate, interventionId?: number): EstimateDraft {
  return {
    interventionId: String(estimate?.interventionId ?? interventionId ?? ""),
    month: estimate ? formatMonthText(estimate.validFrom) : "",
    cost: formatUsdInput(estimate?.centsPerOutput),
    low: estimate?.centsPerOutputLowerBound
      ? formatUsdInput(estimate.centsPerOutputLowerBound)
      : "",
    high: formatUsdInput(estimate?.centsPerOutputUpperBound),
    sourceName: estimate?.sourceName ?? "",
    sourceUrl: estimate?.sourceUrl ?? "",
    comment: estimate?.comment ?? "",
  };
}

export function validateEstimate(
  draft: EstimateDraft,
  { requireSource }: { requireSource: boolean },
): Errors<EstimateField> {
  const errors: Errors<EstimateField> = {};
  if (!draft.interventionId) errors.interventionId = "Choose what the money buys";
  if (!parseMonthText(draft.month)) errors.month = "Give the month as mm.yyyy, like 01.2026";
  const cost = parseUsd(draft.cost);
  if (cost === null) errors.cost = "Give the cost in US dollars, like 5,85";
  const low = draft.low.trim() ? parseUsd(draft.low) : 0;
  const high = draft.high.trim() ? parseUsd(draft.high) : null;
  if (low === null) errors.low = "Give an amount in US dollars, or leave it empty";
  else if (cost !== null && low > cost) errors.low = "The low end can't be above the estimate";
  if (draft.high.trim() && high === null)
    errors.high = "Give an amount in US dollars, or leave it empty";
  else if (cost !== null && high !== null && high < cost)
    errors.high = "The high end can't be below the estimate";
  if (requireSource && !draft.sourceName.trim()) errors.sourceName = "Name the source";
  if (draft.sourceName.length > 1000) errors.sourceName = "At most 1000 characters";
  if (requireSource && !draft.sourceUrl.trim()) errors.sourceUrl = "Link to the source";
  else if (sourceUrlError(draft.sourceUrl)) errors.sourceUrl = sourceUrlError(draft.sourceUrl);
  if (draft.comment.length > 5000) errors.comment = "At most 5000 characters";
  return errors;
}

/** The procedure input's fields (estimates.create without charityId, estimates.update without id) */
export function estimateValues(draft: EstimateDraft) {
  return {
    interventionId: Number(draft.interventionId),
    validFrom: parseMonthText(draft.month)!,
    centsPerOutput: parseUsd(draft.cost)!,
    centsPerOutputLowerBound: draft.low.trim() ? parseUsd(draft.low)! : 0,
    centsPerOutputUpperBound: draft.high.trim() ? parseUsd(draft.high) : null,
    sourceName: draft.sourceName.trim(),
    sourceUrl: draft.sourceUrl.trim(),
    comment: draft.comment.trim(),
  };
}

/** Maps the API's field names back to the form's */
export const estimateFieldOf: Record<string, EstimateField> = {
  interventionId: "interventionId",
  validFrom: "month",
  centsPerOutput: "cost",
  centsPerOutputLowerBound: "low",
  centsPerOutputUpperBound: "high",
  sourceName: "sourceName",
  sourceUrl: "sourceUrl",
  comment: "comment",
};

//endregion

//region Grants

export type AllotmentDraft = {
  /** The allotment's id; none for a new row */
  id?: number;
  /** Stable React key */
  key: string;
  charityId: string;
  interventionId: string;
  sum: string;
  outputs: string;
  sourceName: string;
  sourceUrl: string;
  comment: string;
};

export type GrantDraft = {
  fund: "TCF" | "AGF";
  month: string;
  allotments: AllotmentDraft[];
};

let nextKey = 0;
export const newAllotment = (): AllotmentDraft => ({
  key: `new-${nextKey++}`,
  charityId: "",
  interventionId: "",
  sum: "",
  outputs: "",
  sourceName: "",
  sourceUrl: "",
  comment: "",
});

export function grantDraft(grant?: ImpactGrant): GrantDraft {
  return {
    fund: grant?.fund ?? "TCF",
    month: grant ? formatMonthText(grant.validFrom) : "",
    allotments: grant
      ? grant.allotments.map((a) => ({
          id: a.id,
          key: `a-${a.id}`,
          charityId: String(a.charityId),
          interventionId: String(a.interventionId),
          sum: formatUsdInput(a.sumInCents),
          outputs: String(a.numberOutputsPurchased),
          sourceName: a.sourceName,
          sourceUrl: a.sourceUrl,
          comment: a.comment,
        }))
      : [newAllotment()],
  };
}

export type GrantErrors = {
  month?: string;
  allotments?: string;
  rows: Errors<keyof AllotmentDraft>[];
};

export function validateGrant(draft: GrantDraft): GrantErrors {
  const errors: GrantErrors = { rows: [] };
  if (!parseMonthText(draft.month)) errors.month = "Give the month as mm.yyyy, like 01.2026";
  if (draft.allotments.length === 0) errors.allotments = "A grant needs at least one allotment";
  errors.rows = draft.allotments.map((a) => {
    const row: Errors<keyof AllotmentDraft> = {};
    if (!a.charityId) row.charityId = "Choose a charity";
    if (!a.interventionId) row.interventionId = "Choose an intervention";
    if (parseUsd(a.sum) === null) row.sum = "A sum in US dollars above 0";
    if (parseCount(a.outputs) === null) row.outputs = "A whole number above 0";
    const url = sourceUrlError(a.sourceUrl);
    if (url) row.sourceUrl = url;
    return row;
  });
  return errors;
}

export const grantValid = (errors: GrantErrors) =>
  !errors.month && !errors.allotments && errors.rows.every((r) => Object.keys(r).length === 0);

export function grantAllotments(draft: GrantDraft) {
  return draft.allotments.map((a) => ({
    ...(a.id ? { id: a.id } : {}),
    charityId: Number(a.charityId),
    interventionId: Number(a.interventionId),
    sumInCents: parseUsd(a.sum)!,
    numberOutputsPurchased: parseCount(a.outputs)!,
    sourceName: a.sourceName.trim(),
    sourceUrl: a.sourceUrl.trim(),
    comment: a.comment.trim(),
  }));
}

/**
 * Each row's share of the grant and cost per output, as the API computes them (sum / total;
 * sum / outputs). Rows without a valid sum count as 0.
 */
export function draftShares(draft: GrantDraft) {
  const sums = draft.allotments.map((a) => parseUsd(a.sum) ?? 0);
  const total = sums.reduce((a, b) => a + b, 0);
  return draft.allotments.map((a, i) => {
    const outputs = parseCount(a.outputs);
    return {
      share: total > 0 ? sums[i]! / total : 0,
      centsPerOutput: outputs && sums[i] ? sums[i]! / outputs : null,
    };
  });
}

/** "71,2 %" */
export const formatShare = (share: number) => `${formatNumber(share * 100, { decimals: 1 })} %`;

//endregion
