import { readFileSync } from "fs";
import { join } from "path";
import {
  buildImpactData,
  type ImpactData,
  type ImpactRows,
} from "../../../custom_modules/impact/data";
import {
  buildLegacyRates,
  LEGACY_CURRENCIES,
  type LegacyRates,
} from "../../../custom_modules/impact/compat/legacyRates";
import type { LegacyEndpoint } from "../../../custom_modules/impact/compat/legacyResponse";

/**
 * Fixtures of the impact compat REST tests: the legacy API's recorded answers (legacy.json), the
 * Exchange_rates rows they need (rates.json), both from scripts/impact-compat-golden.ts, and the
 * impact data as frozen in the legacy API (the rows of the phase 1 data migration).
 */

const DIR = __dirname;
export const LEGACY: { endpoint: LegacyEndpoint; query: string; body: string }[] = JSON.parse(
  readFileSync(join(DIR, "legacy.json"), "utf8"),
);
const RATES: Record<string, Record<string, string>> = JSON.parse(
  readFileSync(join(DIR, "rates.json"), "utf8"),
);

/** The values of one SQL tuple as the migration generator writes them */
function parseTuple(line: string): (string | number | null)[] {
  const values: (string | number | null)[] = [];
  let i = line.indexOf("(") + 1;
  while (i < line.length) {
    while (line[i] === " ") i++;
    if (line[i] === "'") {
      let s = "";
      i++;
      while (i < line.length) {
        const ch = line[i];
        if (ch === "\\") {
          const next = line[i + 1];
          s += next === "n" ? "\n" : next === "r" ? "\r" : next;
          i += 2;
        } else if (ch === "'" && line[i + 1] === "'") {
          s += "'";
          i += 2;
        } else if (ch === "'") {
          i++;
          break;
        } else {
          s += ch;
          i++;
        }
      }
      values.push(s);
    } else {
      const end = line.slice(i).search(/[,)]/);
      const token = line.slice(i, i + end).trim();
      values.push(token === "NULL" ? null : Number(token));
      i += end;
    }
    while (line[i] === " ") i++;
    if (line[i] === ",") i++;
    else if (line[i] === ")") break;
  }
  return values;
}

/** The rows of one INSERT of the phase 1 migration, as objects */
function migrationRows(sql: string, table: string): Record<string, unknown>[] {
  const start = sql.indexOf(`INSERT INTO \`${table}\``);
  const header = sql.slice(start, sql.indexOf("VALUES", start));
  const columns = [...header.matchAll(/`([A-Za-z_]+)`/g)].map((m) => m[1]).slice(1);
  const block = sql.slice(start, sql.indexOf(";\n", start));
  return block
    .split("\n")
    .filter((line) => line.startsWith("  ("))
    .map((line) => {
      const values = parseTuple(line);
      return Object.fromEntries(columns.map((c, i) => [c, values[i]]));
    });
}

export function frozenImpactData(): ImpactData {
  const sql = readFileSync(
    join(__dirname, "../../../../prisma/migrations/20261101120000_impact_tables/migration.sql"),
    "utf8",
  );
  const rows = (table: string) => migrationRows(sql, table) as any[];
  const charities = rows("Impact_charities").map((c) => ({ ...c, Organization_ID: null }));
  return buildImpactData({
    charities,
    interventions: rows("Impact_interventions"),
    texts: rows("Impact_intervention_texts"),
    evaluations: rows("Impact_evaluations"),
    grants: rows("Impact_grants"),
    allotments: rows("Impact_grant_allotments"),
    organizations: [],
  } as ImpactRows);
}

export function recordedRates(): { rates: LegacyRates; currencies: Set<string> } {
  const rows = Object.entries(RATES).flatMap(([currency, byDate]) =>
    Object.entries(byDate).map(([date, perUsd]) => ({ date, currency, perUsd })),
  );
  return {
    rates: buildLegacyRates(rows),
    currencies: new Set(
      ["EUR", "USD", ...Object.keys(RATES), "ARS"].filter((c) => LEGACY_CURRENCIES.has(c)),
    ),
  };
}
