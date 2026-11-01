import { DateTime } from "luxon";
import { DAO } from "./DAO";

/**
 * Exchange rates for the impact figures (docs/impact-api-migration.md, decision 2): ECB reference
 * rates, stored as units of a currency per US dollar in `Exchange_rates`, one row per currency
 * and ECB business day.
 *
 * Source: the ECB Data Portal's SDMX REST API, dataset EXR, daily reference rates against the
 * euro (`EXR/D..EUR.SP00.A`, https://data.ecb.europa.eu/help/api/data). The ECB publishes each
 * business day around 16:00 CET. A currency's rate per USD is its rate per EUR divided by the
 * USD rate per EUR on the same day, which is how the legacy impact API (Python
 * `CurrencyConverter` on the ECB's zip) converted too.
 *
 * Readers take the latest date on or before the one they need (weekends, holidays, today before
 * the ECB has published).
 */

export const ECB_SOURCE = "ECB";
/** The first day of the backfill: the oldest evaluation is from 2013 */
export const BACKFILL_FROM = "2013-01-01";
const ECB_URL = "https://data-api.ecb.europa.eu/service/data/EXR/D..EUR.SP00.A";

/** One row of Exchange_rates */
export type UsdRate = { date: string; currency: string; perUsd: string };

/**
 * Parses the ECB's `csvdata` (detail=dataonly) answer and turns the per-EUR rates into per-USD
 * rates, with EUR itself added. Days without a USD rate are left out. per_usd is rounded to the
 * column's 8 decimals.
 */
export function ecbCsvToUsdRates(csv: string): UsdRate[] {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`ECB answer has no ${name} column`);
    return i;
  };
  const [currencyCol, dateCol, valueCol] = [col("CURRENCY"), col("TIME_PERIOD"), col("OBS_VALUE")];

  const perEurByDate = new Map<string, Map<string, number>>();
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const value = Number(cells[valueCol]);
    if (!cells[valueCol] || !Number.isFinite(value) || value <= 0) continue;
    const date = cells[dateCol];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    let day = perEurByDate.get(date);
    if (!day) perEurByDate.set(date, (day = new Map()));
    day.set(cells[currencyCol], value);
  }

  const rates: UsdRate[] = [];
  for (const [date, day] of [...perEurByDate].sort(([a], [b]) => a.localeCompare(b))) {
    const usdPerEur = day.get("USD");
    if (!usdPerEur) continue;
    day.set("EUR", 1);
    for (const [currency, perEur] of [...day].sort(([a], [b]) => a.localeCompare(b))) {
      const perUsd = currency === "USD" ? 1 : perEur / usdPerEur;
      rates.push({ date, currency, perUsd: perUsd.toFixed(8) });
    }
  }
  return rates;
}

/** Fetches the ECB's daily rates for [from, to] (YYYY-MM-DD) as per-USD rates */
export async function fetchEcbUsdRates(from: string, to: string): Promise<UsdRate[]> {
  const url = `${ECB_URL}?startPeriod=${from}&endPeriod=${to}&format=csvdata&detail=dataonly`;
  const res = await fetch(url, { headers: { Accept: "text/csv" } });
  // No data in the period (a weekend, before today's publication): an empty answer
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`ECB rates ${from}..${to}: HTTP ${res.status}`);
  const text = await res.text();
  return text.trim() ? ecbCsvToUsdRates(text) : [];
}

/** Inserts or replaces rates, in chunks */
export async function saveUsdRates(rates: UsdRate[], source = ECB_SOURCE): Promise<number> {
  const chunk = 2000;
  for (let i = 0; i < rates.length; i += chunk) {
    const values = rates.slice(i, i + chunk).map((r) => [r.date, r.currency, r.perUsd, source]);
    await DAO.query(
      `INSERT INTO Exchange_rates (date, currency, per_usd, source) VALUES ?
         ON DUPLICATE KEY UPDATE per_usd = VALUES(per_usd), source = VALUES(source)`,
      [values],
    );
  }
  return rates.length;
}

/** The newest date in Exchange_rates, or null when it is empty */
export async function latestRateDate(): Promise<string | null> {
  const [rows] = await DAO.query<{ latest: string | null }[]>(
    "SELECT DATE_FORMAT(MAX(date), '%Y-%m-%d') AS latest FROM Exchange_rates",
  );
  return rows[0]?.latest ?? null;
}

export type ExchangeRateUpdate = { from: string; to: string; days: number; rows: number };

/**
 * The daily job (POST /scheduled/exchange-rates): fetches the ECB rates from `from` (default: a
 * week before the newest stored date, so late corrections are picked up; an empty table starts
 * at BACKFILL_FROM, which is the backfill) to today, and upserts them. The ECB answers the whole
 * backfill (~30 currencies since 2013) in one request; it is fetched a year at a time anyway.
 */
export async function updateExchangeRates(
  options: { from?: string; now?: Date } = {},
): Promise<ExchangeRateUpdate> {
  const today = DateTime.fromJSDate(options.now ?? new Date(), {
    zone: "Europe/Oslo",
  }).toISODate()!;
  let from = options.from;
  if (!from) {
    const latest = await latestRateDate();
    from = latest ? DateTime.fromISO(latest).minus({ days: 7 }).toISODate()! : BACKFILL_FROM;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || from > today)
    throw new Error(`Invalid from date ${from}`);

  let rows = 0;
  const dates = new Set<string>();
  let start = DateTime.fromISO(from);
  const end = DateTime.fromISO(today);
  while (start <= end) {
    const stop = DateTime.min(start.plus({ years: 1 }).minus({ days: 1 }), end);
    const rates = await fetchEcbUsdRates(start.toISODate()!, stop.toISODate()!);
    rows += await saveUsdRates(rates);
    for (const r of rates) dates.add(r.date);
    start = stop.plus({ days: 1 });
  }
  return { from, to: today, days: dates.size, rows };
}

/**
 * Rates per USD for one currency, for looking up many dates with one query: every stored rate in
 * [from, to] plus the latest one before `from`. Use `rateOn` on the result.
 */
export async function loadUsdRates(currency: string, from: string, to: string): Promise<RateTable> {
  const upper = currency.toUpperCase();
  if (upper === "USD") return { currency: upper, dates: [BACKFILL_FROM], perUsd: [1] };
  const [rows] = await DAO.query<{ date: string; per_usd: string }[]>(
    `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS date, per_usd FROM Exchange_rates
      WHERE currency = ? AND date >= COALESCE(
        (SELECT MAX(date) FROM Exchange_rates WHERE currency = ? AND date <= ?), ?)
        AND date <= ?
      ORDER BY date`,
    [upper, upper, from, from, to],
  );
  return {
    currency: upper,
    dates: rows.map((r) => r.date),
    perUsd: rows.map((r) => Number(r.per_usd)),
  };
}

/** Sorted rates of one currency (see loadUsdRates) */
export type RateTable = { currency: string; dates: string[]; perUsd: number[] };

/**
 * The rate on `date` (YYYY-MM-DD), or on the latest earlier date in the table; null if the table
 * has no rate on or before it. USD is always 1.
 */
export function rateOn(table: RateTable, date: string): { date: string; perUsd: number } | null {
  if (table.currency === "USD") return { date, perUsd: 1 };
  let lo = 0;
  let hi = table.dates.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (table.dates[mid] <= date) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found < 0 ? null : { date: table.dates[found], perUsd: table.perUsd[found] };
}
