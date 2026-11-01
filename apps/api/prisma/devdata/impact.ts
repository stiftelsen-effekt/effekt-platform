import type mysql from "mysql2/promise";

/**
 * Impact charity (abbreviation) → Organization (abbriv) links, the same list as the migration
 * 20261101120000_impact_tables. The migration links production's organizations; a fresh dev or
 * e2e database gets its organizations from the seed, after the migrations, so the seed links them
 * again here. The impact rows themselves come from the migration.
 */
export const IMPACT_CHARITY_ORGANIZATIONS: Record<string, string> = {
  AMF: "AMF",
  SCI: "SCI",
  HKI: "HKI",
  NI: "NI",
  END: "End",
  DTW: "DtW",
  SS: "Sight",
  GD: "GD",
  UBI: "UBI",
  MC: "MC",
  NLS: "NLS",
  PHC: "PHC",
  GDZF: "GDZF",
  GDCSF: "GDCSF",
  AGF: "AGF",
};

/** Links each Impact charity to the organization with the mapped abbreviation, where it exists */
export async function linkImpactCharities(conn: mysql.Connection) {
  for (const [charity, org] of Object.entries(IMPACT_CHARITY_ORGANIZATIONS)) {
    await conn.query(
      `UPDATE Impact_charities c JOIN Organizations o ON o.abbriv = ?
          SET c.Organization_ID = o.ID
        WHERE c.abbreviation = ?`,
      [org, charity],
    );
  }
}

/**
 * Exchange rates for local and e2e databases: one fixed rate per currency from 2013, so impact
 * figures are round and stable (readers take the latest rate on or before a date). Production
 * gets ECB rates from POST /scheduled/exchange-rates; running it locally (or with ?from=) fills
 * in real rates, which replace these.
 */
export const DEV_EXCHANGE_RATES: [date: string, currency: string, perUsd: string][] = [
  ["2013-01-01", "NOK", "10.00000000"],
  ["2013-01-01", "SEK", "10.00000000"],
  ["2013-01-01", "DKK", "7.00000000"],
  ["2013-01-01", "EUR", "0.90000000"],
];

export async function seedExchangeRates(conn: mysql.Connection) {
  await conn.query("INSERT IGNORE INTO Exchange_rates (date, currency, per_usd, source) VALUES ?", [
    DEV_EXCHANGE_RATES.map((row) => [...row, "dev"]),
  ]);
}
