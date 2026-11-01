import { describe, it } from "vitest";
import { expect } from "chai";
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
  expect(start, table).to.be.greaterThan(-1);
  const block = code.slice(start, code.indexOf(";\n", start));
  return block.split("\n").filter((line) => line.startsWith("  ("));
};

describe("impact tables migration", () => {
  it("only creates tables, inserts rows and links charities", () => {
    const kinds = new Set(code.match(/^[A-Z]+(?= )/gm));
    expect([...kinds].sort()).to.deep.equal(["ALTER", "CREATE", "INSERT", "UPDATE"]);
    expect(code).not.to.match(/\b(DROP|MODIFY|RENAME)\b/i);
    expect(code).not.to.match(/ALTER TABLE `(?!Impact_)/);
    const updates = code.match(/^UPDATE `[A-Za-z_]+`/gm);
    expect(updates).to.deep.equal(["UPDATE `Impact_charities`"]);
  });

  it("carries every row of the old impact API", () => {
    expect(rows("Impact_charities")).to.have.length(15);
    expect(rows("Impact_interventions")).to.have.length(11);
    expect(rows("Impact_intervention_texts")).to.have.length(40);
    expect(rows("Impact_evaluations")).to.have.length(60);
    expect(rows("Impact_grants")).to.have.length(26);
    expect(rows("Impact_grant_allotments")).to.have.length(46);
  });

  it("keeps the old IDs, Top Charities Fund grants first and the AGF grant after them", () => {
    expect(rows("Impact_charities")[6]).to.match(/^ {2}\(7, 'Sightsavers', 'SS',/);
    const grants = rows("Impact_grants");
    expect(grants.filter((g) => g.includes("'TCF'"))).to.have.length(25);
    expect(grants.at(-1)).to.match(/^ {2}\(34, 'AGF', '2025-01-01', 1,/);
    expect(code).not.to.match(/'MIF'/);
  });

  it("links the same charities to organizations as the dev seed", () => {
    const pairs = [...code.matchAll(/SELECT '([A-Z]+)'(?: AS charity)?, '([A-Za-z]+)'/g)].map(
      ([, charity, org]) => [charity, org],
    );
    expect(Object.fromEntries(pairs)).to.deep.equal(IMPACT_CHARITY_ORGANIZATIONS);
  });
});
