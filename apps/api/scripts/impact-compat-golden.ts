/**
 * Records the legacy impact API's answers for the compatibility matrix into the golden fixtures
 * of src/__test__/impactCompat.golden.spec.ts (docs/impact-api-migration.md, phase 5).
 *
 *   cd apps/api && node -r ts-node/register/transpile-only scripts/impact-compat-golden.ts &&
 *     npx prettier --write src/__test__/data/impact-compat
 *
 * - legacy.json: the exact response text per request. Each request carries a unique `cachebust`
 *   parameter, so the legacy Datastore cache (which keys only on the last charity_abbreviation)
 *   cannot hand back another request's answer. Requests without `language` are repeated until the
 *   legacy API answers in English: it otherwise reuses the thread's last language.
 * - rates.json: the Exchange_rates rows (units per USD, as exchangeRates.ts stores them from the
 *   ECB) the answers need: for each currency and day, the stored days around it, plus EUR.
 *
 * Only run while the legacy API still serves the frozen data (before phase 6).
 */
import { randomUUID } from "crypto";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { fetchEcbUsdRates } from "../src/custom_modules/exchangeRates";
import { COMPAT_MATRIX } from "../src/custom_modules/impact/compat/matrix";

const LEGACY = process.env.LEGACY_IMPACT_API ?? "https://impact.gieffektivt.no/api";
const OUT = join(__dirname, "../src/__test__/data/impact-compat");

async function fetchLegacy(endpoint: string, query: string) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const sep = query ? "&" : "";
    const res = await fetch(`${LEGACY}/${endpoint}?${query}${sep}cachebust=${randomUUID()}`, {
      headers: { "Accept-Language": "en", "User-Agent": "effekt-impact-compat-golden" },
    });
    const body = await res.text();
    if (res.status !== 200) throw new Error(`${endpoint}?${query}: HTTP ${res.status}`);
    const needsEnglish = !/(^|&)language=/.test(query);
    if (!needsEnglish || !/"language": "(?!en")/.test(body)) return body;
  }
  throw new Error(`${endpoint}?${query}: never answered in English`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const recorded: { endpoint: string; query: string; body: string }[] = [];
  const needed = new Map<string, Set<string>>();
  for (const { endpoint, query } of COMPAT_MATRIX) {
    const body = await fetchLegacy(endpoint, query);
    recorded.push({ endpoint, query, body });
    const currency = /"currency": "([A-Z]{3})"/.exec(body)?.[1];
    if (currency) {
      const dates = needed.get(currency) ?? new Set();
      for (const m of body.matchAll(/"exchange_rate_date": "(\d{4}-\d{2}-\d{2})"/g))
        dates.add(m[1]);
      needed.set(currency, dates);
    }
  }
  writeFileSync(join(OUT, "legacy.json"), JSON.stringify(recorded, null, 1) + "\n");

  const allDates = [...needed.values()].flatMap((s) => [...s]).sort();
  const today = new Date().toISOString().slice(0, 10);
  // From the December before: days early in January interpolate with the last rate of December
  const rows = await fetchEcbUsdRates(`${Number(allDates[0].slice(0, 4)) - 1}-12-01`, today);
  const rates: Record<string, Record<string, string>> = {};
  const keep = (currency: string, date: string) => {
    const series = rows.filter((r) => r.currency === currency);
    const before = series.filter((r) => r.date <= date).at(-1);
    const after = series.find((r) => r.date >= date);
    for (const r of [before, after, series[0], series.at(-1)]) {
      if (!r) continue;
      (rates[currency] ??= {})[r.date] = r.perUsd;
    }
  };
  for (const [currency, dates] of needed)
    for (const date of dates) {
      keep("EUR", date);
      if (currency !== "EUR" && currency !== "USD") keep(currency, date);
    }
  // A day's EUR row is needed for every other currency's row on that day
  for (const [currency, byDate] of Object.entries(rates))
    if (currency !== "EUR")
      for (const date of Object.keys(byDate)) {
        const eur = rows.find((r) => r.currency === "EUR" && r.date === date);
        if (eur) rates.EUR[eur.date] = eur.perUsd;
      }
  const sorted = Object.fromEntries(
    Object.entries(rates)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([c, byDate]) => [c, Object.fromEntries(Object.entries(byDate).sort())]),
  );
  writeFileSync(join(OUT, "rates.json"), JSON.stringify(sorted, null, 1) + "\n");
  console.log(`${recorded.length} answers, rates for ${Object.keys(sorted).join(", ")}`);
}

main().catch((ex) => {
  console.error(ex);
  process.exit(1);
});
