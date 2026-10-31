/**
 * Inflation adjustment of recurring agreements (Gi Effektivt: AvtaleGiro and Vipps). An offer
 * round has two deliberate steps, started from the admin (docs/inflation-adjustment.md):
 * 1. prepare: find eligible agreements and add a `new` offer for each (no email)
 * 2. send: email `new` offers in small batches, each marked `pending` once its email is sent
 */
import { DateTime } from "luxon";
import { DAO } from "./DAO";
import type { InflationAgreementType, InflationCandidate } from "./DAO_modules/inflationadjustment";
import { OFFER_VALID_DAYS } from "./DAO_modules/inflationadjustment";
import { OSLO_ZONE } from "./osloDays";

export enum agreementType {
  avtaleGiro = "avtaleGiro",
  vipps = "vipps",
}

/** Rules */
export const MINIMUM_INCREASE_ORE = 10 * 100;
export const MINIMUM_INFLATION = 0.05;
export const MINIMUM_MONTHS_SINCE_CHANGE = 12;
/** New amounts are rounded to the nearest 10 kr */
const ROUND_TO_ORE = 10 * 100;

export type YearMonth = { year: number; month: number };

const monthIndex = (m: YearMonth) => m.year * 12 + (m.month - 1);
const fromIndex = (i: number): YearMonth => ({ year: Math.floor(i / 12), month: (i % 12) + 1 });
export const addMonths = (m: YearMonth, n: number) => fromIndex(monthIndex(m) + n);
export const monthsBetween = (from: YearMonth, to: YearMonth) => monthIndex(to) - monthIndex(from);
export const formatYearMonth = (m: YearMonth) => `${m.year}-${String(m.month).padStart(2, "0")}`;
const osloMonth = (date: Date): YearMonth => {
  const d = DateTime.fromJSDate(date, { zone: OSLO_ZONE });
  return { year: d.year, month: d.month };
};

/**
 * The month the agreement's amount was last set: the month after the latest donation from it
 * whose sum differs from the current amount, or else the month it was created. An accepted
 * offer changes the amount, so it counts as a change too.
 */
export function lastChangeMonth(
  candidate: Pick<InflationCandidate, "created" | "lastDifferentDonation">,
): YearMonth | null {
  if (candidate.lastDifferentDonation) {
    return addMonths(osloMonth(candidate.lastDifferentDonation), 1);
  }
  return candidate.created ? osloMonth(candidate.created) : null;
}

export type SkipReason =
  "unknownStart" | "changedRecently" | "lowInflation" | "smallIncrease" | "noEmail";

export type Evaluation =
  | { eligible: true; proposedOre: number; increaseOre: number }
  | { eligible: false; reason: SkipReason };

/** Applies the amount rules, given the inflation since the last change (a fraction) */
export function evaluateAmount(amountOre: number, inflation: number): Evaluation {
  if (inflation < MINIMUM_INFLATION) return { eligible: false, reason: "lowInflation" };
  const proposedOre = Math.round((amountOre * (1 + inflation)) / ROUND_TO_ORE) * ROUND_TO_ORE;
  const increaseOre = proposedOre - amountOre;
  if (increaseOre < MINIMUM_INCREASE_ORE) return { eligible: false, reason: "smallIncrease" };
  return { eligible: true, proposedOre, increaseOre };
}

// region SSB consumer price index

type FetchLike = (url: string) => Promise<{ ok?: boolean; json(): Promise<unknown> }>;

const ssbUrl = (start: YearMonth, end: YearMonth) =>
  `https://www.ssb.no/priser-og-prisindekser/konsumpriser/statistikk/konsumprisindeksen/_/service/mimir/kpi?startValue=100&startYear=${
    start.year
  }&startMonth=${String(start.month).padStart(2, "0")}&endYear=${end.year}&endMonth=${String(
    end.month,
  ).padStart(2, "0")}&language=nb`;

/** How long the latest published month is trusted before asking SSB again */
const LATEST_MONTH_TTL_MS = 6 * 3600 * 1000;
const PARALLEL_REQUESTS = 6;

/**
 * Inflation from SSB's CPI calculator (the change in the consumer price index between two
 * months). Each start month is fetched once per end month; the end month is the latest one
 * SSB has published. `fetchFn` is injectable for tests.
 */
export function createSsbInflation(fetchFn: FetchLike = fetch) {
  const changes = new Map<string, Promise<number | null>>();
  let latest: { month: YearMonth; for: string; at: number } | null = null;

  const change = (start: YearMonth, end: YearMonth): Promise<number | null> => {
    const key = `${formatYearMonth(start)}/${formatYearMonth(end)}`;
    let pending = changes.get(key);
    if (!pending) {
      pending = (async () => {
        const res = await fetchFn(ssbUrl(start, end));
        const json = (await res.json()) as { change?: unknown };
        const value = typeof json?.change === "number" ? json.change : Number(json?.change);
        return json && "change" in json && Number.isFinite(value) ? value : null;
      })();
      changes.set(key, pending);
      // Don't keep failures, so the next run asks again
      void pending.then(
        (value) => value === null && changes.delete(key),
        () => changes.delete(key),
      );
    }
    return pending;
  };

  /** The latest month SSB has published, looking back up to 12 months from last month */
  const latestMonth = async (now: DateTime): Promise<YearMonth> => {
    const current = { year: now.setZone(OSLO_ZONE).year, month: now.setZone(OSLO_ZONE).month };
    const forMonth = formatYearMonth(current);
    if (latest && latest.for === forMonth && Date.now() - latest.at < LATEST_MONTH_TTL_MS) {
      return latest.month;
    }
    for (let back = 1; back <= 12; back++) {
      const end = addMonths(current, -back);
      if ((await change(end, end)) !== null) {
        latest = { month: end, for: forMonth, at: Date.now() };
        return end;
      }
    }
    throw new Error("Failed to fetch inflation data from SSB");
  };

  /** Inflation from each start month to `end`, fetched a few at a time */
  const since = async (starts: YearMonth[], end: YearMonth): Promise<Map<string, number>> => {
    const unique = [...new Map(starts.map((s) => [formatYearMonth(s), s])).values()];
    const result = new Map<string, number>();
    let next = 0;
    const worker = async () => {
      while (next < unique.length) {
        const start = unique[next++];
        if (monthsBetween(start, end) <= 0) {
          result.set(formatYearMonth(start), 0);
          continue;
        }
        const value = await change(start, end);
        if (value === null) {
          throw new Error(`No inflation data from SSB for ${formatYearMonth(start)}`);
        }
        result.set(formatYearMonth(start), value);
      }
    };
    await Promise.all(Array.from({ length: PARALLEL_REQUESTS }, worker));
    return result;
  };

  return { latestMonth, since };
}

export type InflationSource = ReturnType<typeof createSsbInflation>;
const defaultInflation = createSsbInflation();

// endregion

export interface InflationProposal {
  type: InflationAgreementType;
  agreementId: string;
  donorId: number;
  donorName: string | null;
  email: string | null;
  currentOre: number;
  proposedOre: number;
  increaseOre: number;
  /** Fraction, e.g. 0.064 */
  inflation: number;
  lastChange: string;
  monthsSinceChange: number;
}

export interface InflationRoundPreview {
  /** The latest CPI month used (YYYY-MM) */
  inflationUntil: string;
  proposals: InflationProposal[];
  /** Active agreements without a blocking offer that don't qualify, by reason */
  skipped: Record<SkipReason, number>;
}

/**
 * The agreements that would get an offer now, with the proposed amounts. Reads only: one query
 * for the agreements, and one SSB request per distinct start month.
 */
export async function previewInflationRound(
  options: { now?: DateTime; inflation?: InflationSource } = {},
): Promise<InflationRoundPreview> {
  const now = options.now ?? DateTime.now();
  const inflation = options.inflation ?? defaultInflation;
  const current = { year: now.setZone(OSLO_ZONE).year, month: now.setZone(OSLO_ZONE).month };

  const candidates = await DAO.inflationadjustments.getCandidates();
  const skipped: Record<SkipReason, number> = {
    unknownStart: 0,
    changedRecently: 0,
    lowInflation: 0,
    smallIncrease: 0,
    noEmail: 0,
  };

  const old: { candidate: InflationCandidate; start: YearMonth; months: number }[] = [];
  for (const candidate of candidates) {
    const start = lastChangeMonth(candidate);
    if (!start) {
      skipped.unknownStart++;
      continue;
    }
    const months = monthsBetween(start, current);
    if (months < MINIMUM_MONTHS_SINCE_CHANGE) {
      skipped.changedRecently++;
      continue;
    }
    if (!candidate.email?.trim()) {
      skipped.noEmail++;
      continue;
    }
    old.push({ candidate, start, months });
  }

  const end = await inflation.latestMonth(now);
  const rates = old.length
    ? await inflation.since(
        old.map((o) => o.start),
        end,
      )
    : new Map<string, number>();

  const proposals: InflationProposal[] = [];
  for (const { candidate, start, months } of old) {
    const rate = rates.get(formatYearMonth(start)) ?? 0;
    const result = evaluateAmount(candidate.amountOre, rate);
    if (!result.eligible) {
      skipped[result.reason]++;
      continue;
    }
    proposals.push({
      type: candidate.type,
      agreementId: candidate.agreementId,
      donorId: candidate.donorId,
      donorName: candidate.donorName,
      email: candidate.email,
      currentOre: candidate.amountOre,
      proposedOre: result.proposedOre,
      increaseOre: result.increaseOre,
      inflation: rate,
      lastChange: formatYearMonth(start),
      monthsSinceChange: months,
    });
  }
  proposals.sort((a, b) => a.type.localeCompare(b.type) || b.increaseOre - a.increaseOre);

  return { inflationUntil: formatYearMonth(end), proposals, skipped };
}

/**
 * Step 1: adds a `new` offer for every eligible agreement. Sends nothing. Safe to run again: an
 * agreement with an open or recent offer is skipped (in the preview and again in the INSERT).
 */
export async function prepareInflationOffers(
  options: { now?: DateTime; inflation?: InflationSource } = {},
): Promise<{ created: number; alreadyOpen: number; expired: number; inflationUntil: string }> {
  const expired = await DAO.inflationadjustments.expirePending();
  const preview = await previewInflationRound(options);
  let created = 0;
  let alreadyOpen = 0;
  for (const p of preview.proposals) {
    const added = await DAO.inflationadjustments.createIfNoOpenOffer({
      agreementId: p.agreementId,
      agreementType: p.type,
      currentAmount: p.currentOre,
      proposedAmount: p.proposedOre,
      inflationPercentage: p.inflation,
    });
    if (added) created++;
    else alreadyOpen++;
  }
  return { created, alreadyOpen, expired, inflationUntil: preview.inflationUntil };
}

/** Per call: the API sits behind a load balancer with a 30 s timeout, so batches stay small */
export const MAX_SEND_BATCH = 25;
const SEND_TIME_BUDGET_MS = 15_000;
/** MailerSend allows about 120 email requests a minute; this keeps one run well under it */
const PAUSE_BETWEEN_EMAILS_MS = 500;

export interface SendBatchResult {
  sent: number;
  failed: number;
  /** Not sent: the agreement stopped or its amount changed since the offer was prepared */
  cancelled: number;
  /** `new` offers left after this batch */
  remaining: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Step 2: emails up to `batchSize` prepared offers, oldest first. Each is claimed before its
 * email (so concurrent or repeated runs never email a row twice), gets OFFER_VALID_DAYS from
 * now, and becomes `pending` when the email is sent or `failed` when it isn't. Stops starting
 * new emails after a time budget so the request returns before the load balancer's timeout.
 */
export async function sendInflationOffers(options: {
  batchSize: number;
  sendEmail: (adjustmentId: number) => Promise<boolean>;
  pauseMs?: number;
  timeBudgetMs?: number;
}): Promise<SendBatchResult> {
  const batchSize = Math.max(0, Math.min(options.batchSize, MAX_SEND_BATCH));
  const pauseMs = options.pauseMs ?? PAUSE_BETWEEN_EMAILS_MS;
  const budget = options.timeBudgetMs ?? SEND_TIME_BUDGET_MS;
  const started = Date.now();

  const rows = batchSize > 0 ? await DAO.inflationadjustments.getUnsent(batchSize) : [];
  let sent = 0;
  let failed = 0;
  let cancelled = 0;
  let attempted = 0;
  for (const row of rows) {
    if (Date.now() - started > budget) break;
    if (!row.stillValid) {
      if (await DAO.inflationadjustments.cancelUnsent(row.ID)) cancelled++;
      continue;
    }
    const expires = DateTime.utc().plus({ days: OFFER_VALID_DAYS }).toJSDate();
    if (!(await DAO.inflationadjustments.claimForSending(row.ID, expires))) continue;
    if (attempted > 0 && pauseMs > 0) await sleep(pauseMs);
    attempted++;
    let ok = false;
    try {
      ok = (await options.sendEmail(row.ID)) === true;
    } catch (ex) {
      console.error("Failed to send inflation adjustment", row.ID, ex);
    }
    await DAO.inflationadjustments.finishSending(row.ID, ok);
    if (ok) sent++;
    else failed++;
  }

  const counts = await DAO.inflationadjustments.getStatusCounts();
  const remaining = counts.find((c) => c.status === "new")?.count ?? 0;
  return { sent, failed, cancelled, remaining };
}
