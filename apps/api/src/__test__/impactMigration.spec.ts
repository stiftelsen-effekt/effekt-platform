import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { IMPACT_CHARITY_ORGANIZATIONS } from "../../prisma/devdata/impact";

/**
 * The impact tables migration (docs/impact-api-migration.md, phase 1) runs on production on merge:
 * additive only, the rows from the old impact API with their IDs, and the reviewed charity →
 * organization links, which the dev seed repeats (prisma/devdata/impact.ts).
 */
const sql = readFileSync(
  join(__dirname, "../../prisma/migrations/20261101120000_impact_tables/migration.sql"),
  "utf8",
);
const code = sql.replace(/^--.*$/gm, "");

/** Rows of the INSERT into `table` (one per line, as the generator writes them) */
const rows = (table: string) => {
  const start = code.indexOf(`INSERT INTO \`${table}\``);
  expect(start, table).toBeGreaterThan(-1);
  const block = code.slice(start, code.indexOf(";\n", start));
  return block.split("\n").filter((line) => line.startsWith("  ("));
};

describe("impact tables migration", () => {
  it("only creates tables, inserts rows and links charities", () => {
    const kinds = new Set(code.match(/^[A-Z]+(?= )/gm));
    expect([...kinds].sort()).toStrictEqual(["ALTER", "CREATE", "INSERT", "UPDATE"]);
    expect(code).not.toMatch(/\b(DROP|MODIFY|RENAME)\b/i);
    expect(code).not.toMatch(/ALTER TABLE `(?!Impact_)/);
    const updates = code.match(/^UPDATE `[A-Za-z_]+`/gm);
    expect(updates).toStrictEqual(["UPDATE `Impact_charities`"]);
  });

  it("carries every row of the old impact API", () => {
    expect(rows("Impact_charities")).toHaveLength(15);
    expect(rows("Impact_interventions")).toHaveLength(11);
    expect(rows("Impact_intervention_texts")).toHaveLength(40);
    expect(rows("Impact_evaluations")).toHaveLength(60);
    expect(rows("Impact_grants")).toHaveLength(26);
    expect(rows("Impact_grant_allotments")).toHaveLength(46);
  });

  it("keeps the old IDs, Top Charities Fund grants first and the AGF grant after them", () => {
    expect(rows("Impact_charities")[6]).toMatch(/^ {2}\(7, 'Sightsavers', 'SS',/);
    const grants = rows("Impact_grants");
    expect(grants.filter((g) => g.includes("'TCF'"))).toHaveLength(25);
    expect(grants.at(-1)).toMatch(/^ {2}\(34, 'AGF', '2025-01-01', 1,/);
    expect(code).not.toMatch(/'MIF'/);
  });

  it("links the same charities to organizations as the dev seed", () => {
    const pairs = [...code.matchAll(/SELECT '([A-Z]+)'(?: AS charity)?, '([A-Za-z]+)'/g)].map(
      ([, charity, org]) => [charity, org],
    );
    expect(Object.fromEntries(pairs)).toStrictEqual(IMPACT_CHARITY_ORGANIZATIONS);
  });
});
