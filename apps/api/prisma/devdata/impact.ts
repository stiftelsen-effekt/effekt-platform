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
