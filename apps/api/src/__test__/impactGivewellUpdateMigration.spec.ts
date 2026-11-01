import { describe, it } from "vitest";
import { expect } from "chai";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * The GiveWell update (prisma/migrations/20261101233000_impact_givewell_update, docs/
 * impact-givewell-numbers.md) runs on production on merge. It may only edit the Top Charities
 * Fund's grants and the estimates, all or nothing, with a history row for each change, and every
 * number it writes must say where it comes from. The result is checked against a database by
 * src/__test__/DAO/impactGivewellUpdate.db.spec.ts (scripts/impact-givewell-update.sql).
 */
const sql = readFileSync(
  join(__dirname, "../../prisma/migrations/20261101233000_impact_givewell_update/migration.sql"),
  "utf8",
);
const code = sql.replace(/^--.*$/gm, "").replace(/ --.*$/gm, "");
const statements = code
  .split(/;\s*$/m)
  .map((s) => s.trim())
  .filter(Boolean);

describe("GiveWell update migration", () => {
  it("only writes to the impact tables, inside one transaction", () => {
    const writes = statements.filter((s) => /^(INSERT|UPDATE|DELETE)\b/.test(s));
    expect(writes.length).to.be.greaterThan(20);
    for (const s of writes) {
      expect(s, s.slice(0, 80)).to.match(
        /^(INSERT INTO|UPDATE) `?Impact_(grants|grant_allotments|evaluations|changes)\b/,
      );
    }
    expect(code).not.to.match(/\bDELETE\b|\bDROP TABLE\b|\bALTER\b|\bTRUNCATE\b/i);
    const begin = statements.findIndex((s) => s === "START TRANSACTION");
    const commit = statements.findIndex((s) => s === "COMMIT");
    expect(begin).to.be.greaterThan(-1);
    expect(statements.findIndex((s) => /^(INSERT|UPDATE)\b/.test(s))).to.be.greaterThan(begin);
    const lastWrite =
      statements.length -
      1 -
      [...statements].reverse().findIndex((s) => /^(INSERT|UPDATE)\b/.test(s));
    expect(lastWrite).to.be.lessThan(commit);
  });

  it("guards every write on the old values", () => {
    for (const s of statements.filter((s) =>
      /^(INSERT INTO|UPDATE) Impact_(grants|grant_allotments|evaluations)\b/.test(s),
    )) {
      expect(s, s.slice(0, 80)).to.match(/WHERE @apply\b/);
    }
  });

  it("leaves the All Grants Fund alone", () => {
    expect(code).not.to.match(/'AGF'/);
    // grant 34 is the AGF placeholder, allotment 40 its only allotment
    expect(code).not.to.match(/\bID (=|IN \([^)]*)\b(34|40)\b/);
    for (const s of statements.filter((s) => /^UPDATE Impact_grants\b/.test(s))) {
      expect(s).to.match(/\bID (= (2|6|8|9|15|17|18|19|20|26|27|28|29|33)\b|IN \()/);
    }
  });

  it("gives every new or corrected allotment and estimate a source link", () => {
    const allotmentWrites = statements.filter((s) =>
      /^(INSERT INTO|UPDATE) Impact_grant_allotments\b/.test(s),
    );
    expect(allotmentWrites).to.have.length(21);
    for (const s of allotmentWrites) {
      expect(s, s.slice(0, 120)).to.match(/https:\/\/(www\.givewell\.org|docs\.google\.com)\//);
    }
    const estimates = statements.find((s) => /^INSERT INTO Impact_evaluations\b/.test(s))!;
    expect(estimates).to.include("gid=1846397371");
    expect(estimates.match(/UNION ALL SELECT/g)).to.have.length(3);
  });
});
