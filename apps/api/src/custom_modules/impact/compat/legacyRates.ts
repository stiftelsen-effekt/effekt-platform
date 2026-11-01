import { DAO } from "../../DAO";

/**
 * Currency conversion exactly as the legacy impact API did it, from our Exchange_rates table.
 *
 * The legacy API used the Python `CurrencyConverter` package (0.16) on the ECB's history zip,
 * created with fallback_on_wrong_date and fallback_on_missing_rate:
 *
 * - rates are per EUR, one series per currency, on the ECB's business days;
 * - a day without a rate inside a series' range (weekend, TARGET holiday) gets the linear
 *   interpolation of the two closest rates: (r0 · d1 + r1 · d0) / (d0 + d1), with d0 and d1 the
 *   days to the previous and next rate;
 * - a day before or after the series uses its first or last rate;
 * - USD → X is `amount / rate(USD) * rate(X)`, with rate(EUR) = 1.0.
 *
 * Exchange_rates stores units per USD rounded to 8 decimals (exchangeRates.ts), which loses the
 * ECB's own figures. They are recovered exactly: the ECB publishes USD per EUR with 4 decimals
 * and the other rates with at most 6, and the stored rounding error (≤ 5e-9) is far below
 * those steps. So USD per EUR = round4(1 / perUsd(EUR)) and X per EUR = round6(perUsd(X) · USD
 * per EUR). With the ECB's own numbers and the same float operations, the results equal the
 * legacy API's to the last bit (see impactCompat.golden.spec.ts).
 */

/** One currency's ECB rates per EUR, sorted by date */
export type EurSeries = { dates: string[]; perEur: number[] };

export type LegacyRates = {
  /** USD per EUR */
  usd: EurSeries;
  /** Units per EUR of each loaded currency (EUR and USD are implied) */
  series: Map<string, EurSeries>;
};

export type UsdRateRow = { date: string; currency: string; perUsd: string | number };

/** Builds per-EUR series from Exchange_rates rows (must include the EUR rows) */
export function buildLegacyRates(rows: UsdRateRow[]): LegacyRates {
  const usdPerEurByDate = new Map<string, number>();
  for (const r of rows)
    if (r.currency === "EUR")
      usdPerEurByDate.set(r.date, Number((1 / Number(r.perUsd)).toFixed(4)));

  const byCurrency = new Map<string, [string, number][]>();
  for (const r of rows) {
    if (r.currency === "EUR" || r.currency === "USD") continue;
    const usdPerEur = usdPerEurByDate.get(r.date);
    if (usdPerEur === undefined) continue;
    const list = byCurrency.get(r.currency) ?? [];
    list.push([r.date, Number((Number(r.perUsd) * usdPerEur).toFixed(6))]);
    byCurrency.set(r.currency, list);
  }
  const toSeries = (pairs: [string, number][]): EurSeries => {
    pairs.sort(([a], [b]) => a.localeCompare(b));
    return { dates: pairs.map(([d]) => d), perEur: pairs.map(([, r]) => r) };
  };
  const series = new Map<string, EurSeries>();
  for (const [currency, pairs] of byCurrency) series.set(currency, toSeries(pairs));
  return { usd: toSeries([...usdPerEurByDate]), series };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;

/** A series' rate on `date` (YYYY-MM-DD), interpolated or clamped as CurrencyConverter does */
export function seriesRate(series: EurSeries, date: string): number | null {
  const { dates, perEur } = series;
  if (dates.length === 0) return null;
  if (date <= dates[0]) return perEur[0];
  if (date >= dates[dates.length - 1]) return perEur[dates.length - 1];
  // The last index with dates[i] <= date
  let lo = 0;
  let hi = dates.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (dates[mid] <= date) lo = mid;
    else hi = mid - 1;
  }
  if (dates[lo] === date) return perEur[lo];
  const r0 = perEur[lo];
  const r1 = perEur[lo + 1];
  const d0 = dayNumber(date) - dayNumber(dates[lo]);
  const d1 = dayNumber(dates[lo + 1]) - dayNumber(date);
  return (r0 * d1 + r1 * d0) / (d0 + d1);
}

/** Units of `currency` per EUR on `date`, or null if the currency isn't loaded */
export function eurRate(rates: LegacyRates, currency: string, date: string): number | null {
  if (currency === "EUR") return 1.0;
  if (currency === "USD") return seriesRate(rates.usd, date);
  const series = rates.series.get(currency);
  return series ? seriesRate(series, date) : null;
}

/** USD `amount` in `currency` on `date`, as CurrencyConverter.convert(amount, "USD", currency) */
export function convertUsd(
  rates: LegacyRates,
  amount: number,
  currency: string,
  date: string,
): number | null {
  const r0 = eurRate(rates, "USD", date);
  const r1 = eurRate(rates, currency, date);
  if (r0 === null || r1 === null) return null;
  return (amount / r0) * r1;
}

const CACHE_MS = 15 * 60 * 1000;
const seriesCache = new Map<string, { at: number; rates: Promise<LegacyRates> }>();
let currenciesCache: { at: number; currencies: Promise<Set<string>> } | null = null;

/** The rates needed to convert USD into `currency` (cached for 15 minutes per currency) */
export function loadLegacyRates(currency: string, now = Date.now()): Promise<LegacyRates> {
  const upper = currency.toUpperCase();
  const hit = seriesCache.get(upper);
  if (hit && now - hit.at < CACHE_MS) return hit.rates;
  const rates = DAO.query<{ date: string; currency: string; per_usd: string }[]>(
    `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS date, currency, per_usd FROM Exchange_rates
      WHERE currency IN ('EUR', ?)`,
    [upper],
  ).then(([rows]) =>
    buildLegacyRates(rows.map((r) => ({ date: r.date, currency: r.currency, perUsd: r.per_usd }))),
  );
  seriesCache.set(upper, { at: now, rates });
  rates.catch(() => {
    if (seriesCache.get(upper)?.rates === rates) seriesCache.delete(upper);
  });
  return rates;
}

/**
 * The currencies of the ECB's reference rate zip that the legacy API read. The ECB's data API,
 * which fills Exchange_rates, has a few more (ARS, ...) that the legacy API rejected; CYP, EEK,
 * MTL, ROL, SIT, SKK and TRL ended before 2013 and are not in Exchange_rates.
 */
export const LEGACY_CURRENCIES = new Set(
  (
    "USD JPY BGN CYP CZK DKK EEK GBP HUF LTL LVL MTL PLN ROL RON SEK SIT SKK CHF ISK NOK TRL TRY " +
    "AUD BRL CAD CNY HKD IDR ILS INR KRW MXN MYR NZD PHP SGD THB ZAR HRK RUB EUR"
  ).split(" "),
);

/** The legacy currencies Exchange_rates has, plus EUR and USD (cached for 15 minutes) */
export function supportedCurrencies(now = Date.now()): Promise<Set<string>> {
  if (!currenciesCache || now - currenciesCache.at > CACHE_MS) {
    const currencies = DAO.query<{ currency: string }[]>(
      "SELECT DISTINCT currency FROM Exchange_rates",
    ).then(
      ([rows]) =>
        new Set([
          "EUR",
          "USD",
          ...rows.map((r) => r.currency).filter((c) => LEGACY_CURRENCIES.has(c)),
        ]),
    );
    currenciesCache = { at: now, currencies };
    currencies.catch(() => {
      if (currenciesCache?.currencies === currencies) currenciesCache = null;
    });
  }
  return currenciesCache.currencies;
}

/** Drops the cached rates (tests, the daily rates job) */
export function clearLegacyRatesCache() {
  seriesCache.clear();
  currenciesCache = null;
}
