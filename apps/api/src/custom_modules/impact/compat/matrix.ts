import type { LegacyEndpoint } from "./legacyResponse";

/**
 * Requests to the legacy impact API that the golden tests (recorded answers) and the daily
 * dual-run diff compare with our answers. It covers the query shapes seen in the load balancer
 * logs of 2026-10-18 → 2026-11-01 (docs/impact-api-migration.md, phase 5 notes) plus the edge
 * cases of the legacy semantics.
 */
export type MatrixCase = { endpoint: LegacyEndpoint; query: string };

const ALL_CHARITIES = [
  "AMF",
  "SCI",
  "HKI",
  "NI",
  "END",
  "DTW",
  "SS",
  "GD",
  "UBI",
  "MC",
  "NLS",
  "PHC",
  "GDZF",
  "GDCSF",
  "AGF",
];
const charities = (...abbreviations: string[]) =>
  abbreviations.map((a) => `charity_abbreviation=${a}`).join("&");

const evaluations: string[] = [
  // Annetame Targalt ("Kui rikas sa oled"): every evaluation, keyed on charity.id
  "currency=EUR&language=et",
  // Receipts and the results page before phase 2, and other list shapes
  "language=no",
  "language=NO",
  "language=en&currency=EUR",
  "currency=USD&language=sv",
  "currency=DKK&language=dk",
  "currency=NOK&language=no",
  // One for the World's impact calculator: one charity, a donation month, a currency, no language
  ...ALL_CHARITIES.map((a) => `${charities(a)}&donation_year=2024&donation_month=3&currency=GBP`),
  `${charities("AMF")}&donation_year=2016&donation_month=1&currency=USD`,
  `${charities("MC")}&donation_year=2025&donation_month=11&currency=EUR`,
  `${charities("HKI")}&donation_year=2019&donation_month=12&currency=USD`,
  `${charities("GD")}&donation_year=2022&donation_month=7&currency=EUR`,
  `${charities("amf")}&donation_year=2023&donation_month=6&currency=USD`,
  // Currencies with other precisions (ISK, JPY: 0–2 decimals; GBP: 5)
  `${charities("AMF")}&donation_year=2024&donation_month=3&currency=ISK`,
  `${charities("GD")}&donation_year=2023&donation_month=8&currency=jpy&language=en`,
  // Min Side before phase 3: one charity, a donation month, currency and language
  `${charities("AMF")}&currency=NOK&donation_month=5&donation_year=2021&language=no`,
  `${charities("SCI")}&currency=SEK&donation_month=2&donation_year=2020&language=sv`,
  `${charities("NI")}&currency=NOK&donation_month=10&donation_year=2026&language=no`,
  // Days without an ECB rate (weekend, Christmas, Good Friday) and a mid-week day
  `${charities("AMF")}&currency=NOK&donation_day=2&donation_month=3&donation_year=2024&language=no`,
  `${charities("MC")}&currency=DKK&donation_day=25&donation_month=12&donation_year=2025&language=dk`,
  `${charities("GD")}&currency=NOK&donation_day=18&donation_month=4&donation_year=2014&language=no`,
  `${charities("HKI")}&currency=SEK&donation_day=15&donation_month=1&donation_year=2025&language=sv`,
  // The intervention widget before phase 3: three charities, a conversion month
  ...[
    ["no", "NOK"],
    ["sv", "SEK"],
    ["dk", "DKK"],
    ["en", "USD"],
    ["et", "EUR"],
  ].map(
    ([language, currency]) =>
      `${charities("AMF", "MC", "HKI")}&conversion_month=9&conversion_year=2026&currency=${currency}&language=${language}`,
  ),
  `${charities("AMF", "SCI")}&conversion_day=9&conversion_month=7&conversion_year=2023&currency=SEK&language=sv`,
  // Several charities without a donation month: up to four in index order, five or more by ID
  `${charities("AMF", "GD", "MC", "SCI")}&currency=NOK&language=no`,
  `${charities("AMF", "GD", "MC", "SCI", "HKI")}&currency=NOK&language=no`,
  `${charities("SS", "DTW")}&language=en`,
  // Several charities with a donation month: request order, repeats kept
  `${charities("MC", "AMF", "AMF", "AGF")}&donation_year=2022&donation_month=2&currency=USD&language=en`,
  `donation_year=2021&donation_month=6&currency=NOK&language=no`,
  // Year and month filters (compared separately, as the legacy API did)
  "start_year=2020&end_year=2022&language=en",
  "start_year=2020&start_month=6&end_year=2022&end_month=3&language=en",
  `${charities("AMF")}&start_year=2020&language=en`,
  // Nothing found
  `${charities("ZZZ")}&language=en`,
  `${charities("AMF")}&donation_year=2010&donation_month=1&language=en`,
  // Errors
  "currency=XXX&language=en",
  "language=fr",
  "currency=xxx&language=FR",
  // In the ECB's data API (Exchange_rates) but not in the legacy API's ECB zip
  "currency=ARS&language=en",
];

const grants: string[] = [
  "language=no",
  "language=NO",
  "currency=NOK&language=no",
  "currency=SEK&language=sv",
  "currency=USD&language=en",
  "currency=DKK&language=dk",
  "currency=EUR&language=et",
  "currency=NOK&donation_month=6&donation_year=2024&language=no",
  "currency=SEK&donation_month=1&donation_year=2019&language=sv",
  "currency=NOK&donation_day=7&donation_month=9&donation_year=2025&language=no",
  "currency=USD&donation_month=1&donation_year=2017&language=en",
  "start_year=2020&end_year=2021&language=en",
  "currency=XXX&language=en",
];

export const COMPAT_MATRIX: MatrixCase[] = [
  ...evaluations.map((query) => ({ endpoint: "evaluations" as const, query })),
  ...grants.map((query) => ({ endpoint: "max_impact_fund_grants" as const, query })),
  ...grants.map((query) => ({ endpoint: "all_grants_fund_grants" as const, query })),
];
