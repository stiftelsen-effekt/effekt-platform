/**
 * The impact data (GiveWell cost-per-output figures) moved from the legacy impact API
 * (impact.gieffektivt.no, Django, database `Impact`) into our Impact_* tables
 * (docs/impact-api-migration.md).
 *
 *   node scripts/impact-data.mjs generate > /tmp/rows.sql
 *     Reads every row from the public API (all languages) and prints the INSERT statements that
 *     prisma/migrations/20261101120000_impact_tables/migration.sql carries, with the same IDs.
 *     Deterministic: the same API data always gives the same file.
 *
 *   DB_URL=mysql://user:pass@127.0.0.1:3306/EffektDonasjonDB node scripts/impact-data.mjs verify
 *     Compares the Impact_* tables in DB_URL with the public API: per-table row counts and a
 *     SHA-256 of a canonical JSON dump of each side. Exits 1 on any difference. Needs only SELECT.
 *     IMPACT_API_URL overrides the API (default https://impact.gieffektivt.no).
 *
 * The public API returns every row: list endpoints have no paging, and every charity and
 * intervention is referenced by an evaluation or an allotment. Intervention texts come from the
 * `language` parameter. Django falls back to English for an empty translation, so a language
 * whose text equals the English one gets no Impact_intervention_texts row: readers fall back to
 * Impact_interventions the same way.
 */
import crypto from "node:crypto";

const API = process.env.IMPACT_API_URL ?? "https://impact.gieffektivt.no";
const LANGUAGES = ["no", "sv", "et", "dk"];
const CREATED_BY = "impact-api migration";

/** Legacy fund names in the API → our fund codes (MIF is now the Top Charities Fund, TCF) */
const FUNDS = [
  { fund: "TCF", path: "max_impact_fund_grants" },
  { fund: "AGF", path: "all_grants_fund_grants" },
];

async function get(path, language) {
  // USD needs no conversion, and `dk` needs an explicit currency (the API has no default for it)
  const url = `${API}/api/${path}?language=${language}&currency=USD`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.errors) throw new Error(`${url}: ${JSON.stringify(body.errors)}`);
  return body[path];
}

const byId = (a, b) => a.ID - b.ID;
const firstOfMonth = (year, month) => `${year}-${String(month).padStart(2, "0")}-01`;

/** Every table's rows, in the target tables' terms, from the public API */
async function fromApi() {
  const perLanguage = {};
  for (const language of ["en", ...LANGUAGES]) {
    perLanguage[language] = {
      evaluations: await get("evaluations", language),
      grants: Object.fromEntries(
        await Promise.all(FUNDS.map(async (f) => [f.fund, await get(f.path, language)])),
      ),
    };
  }

  const interventionsIn = ({ evaluations, grants }) => {
    const map = new Map();
    for (const e of evaluations) map.set(e.intervention.id, e.intervention);
    for (const list of Object.values(grants))
      for (const g of list)
        for (const a of g.allotment_set) map.set(a.intervention.id, a.intervention);
    return map;
  };

  const en = perLanguage.en;
  const charities = new Map();
  for (const e of en.evaluations) charities.set(e.charity.id, e.charity);
  for (const list of Object.values(en.grants))
    for (const g of list) for (const a of g.allotment_set) charities.set(a.charity.id, a.charity);

  const englishInterventions = interventionsIn(en);
  const texts = [];
  for (const language of LANGUAGES) {
    for (const [id, t] of interventionsIn(perLanguage[language])) {
      const base = englishInterventions.get(id);
      if (
        t.short_description === base.short_description &&
        t.long_description === base.long_description
      )
        continue;
      texts.push({
        Intervention_ID: id,
        language,
        short_description: t.short_description,
        long_description: t.long_description,
      });
    }
  }

  // TCF (formerly MIF) grants keep their IDs; AGF grants follow, numbered after the highest TCF
  // ID in legacy order. `legacy_id` is the ID in the old API, unique per fund.
  const grants = [];
  const allotments = [];
  let nextId = Math.max(0, ...en.grants.TCF.map((g) => g.id)) + 1;
  for (const { fund } of FUNDS) {
    for (const g of [...en.grants[fund]].sort((a, b) => a.id - b.id)) {
      const ID = fund === "TCF" ? g.id : nextId++;
      grants.push({
        ID,
        fund,
        valid_from: firstOfMonth(g.start_year, g.start_month),
        legacy_id: g.id,
      });
      for (const a of g.allotment_set) {
        allotments.push({
          ID: a.id,
          Grant_ID: ID,
          Charity_ID: a.charity.id,
          Intervention_ID: a.intervention.id,
          sum_in_cents: a.sum_in_cents,
          number_outputs_purchased: a.number_outputs_purchased,
          number_outputs_purchased_lower_bound: a.number_outputs_purchased_lower_bound,
          number_outputs_purchased_upper_bound: a.number_outputs_purchased_upper_bound,
          source_name: a.source_name,
          source_url: a.source_url,
          comment: a.comment,
        });
      }
    }
  }

  return {
    Impact_charities: [...charities.values()]
      .map((c) => ({ ID: c.id, name: c.charity_name, abbreviation: c.abbreviation }))
      .sort(byId),
    Impact_interventions: [...englishInterventions.values()]
      .map((i) => ({
        ID: i.id,
        short_description: i.short_description,
        long_description: i.long_description,
      }))
      .sort(byId),
    Impact_intervention_texts: texts.sort(
      (a, b) => a.Intervention_ID - b.Intervention_ID || a.language.localeCompare(b.language),
    ),
    Impact_evaluations: en.evaluations
      .map((e) => ({
        ID: e.id,
        Charity_ID: e.charity.id,
        Intervention_ID: e.intervention.id,
        valid_from: firstOfMonth(e.start_year, e.start_month),
        cents_per_output: e.cents_per_output,
        cents_per_output_lower_bound: e.cents_per_output_lower_bound,
        cents_per_output_upper_bound: e.cents_per_output_upper_bound,
        source_name: e.source_name,
        source_url: e.source_url,
        comment: e.comment,
      }))
      .sort(byId),
    Impact_grants: grants.sort(byId),
    Impact_grant_allotments: allotments.sort(byId),
  };
}

const TABLES = [
  "Impact_charities",
  "Impact_interventions",
  "Impact_intervention_texts",
  "Impact_evaluations",
  "Impact_grants",
  "Impact_grant_allotments",
];

/** Column lists per table, in the order fromApi() writes them */
const COLUMNS = {
  Impact_charities: ["ID", "name", "abbreviation"],
  Impact_interventions: ["ID", "short_description", "long_description"],
  Impact_intervention_texts: [
    "Intervention_ID",
    "language",
    "short_description",
    "long_description",
  ],
  Impact_evaluations: [
    "ID",
    "Charity_ID",
    "Intervention_ID",
    "valid_from",
    "cents_per_output",
    "cents_per_output_lower_bound",
    "cents_per_output_upper_bound",
    "source_name",
    "source_url",
    "comment",
  ],
  Impact_grants: ["ID", "fund", "valid_from", "legacy_id"],
  Impact_grant_allotments: [
    "ID",
    "Grant_ID",
    "Charity_ID",
    "Intervention_ID",
    "sum_in_cents",
    "number_outputs_purchased",
    "number_outputs_purchased_lower_bound",
    "number_outputs_purchased_upper_bound",
    "source_name",
    "source_url",
    "comment",
  ],
};

/** The same rows from a database with the Impact_* tables (only the columns the API has) */
async function fromDb(conn) {
  const out = {};
  for (const table of TABLES) {
    const order = table === "Impact_intervention_texts" ? "Intervention_ID, language" : "ID";
    const [rows] = await conn.query(
      `SELECT ${COLUMNS[table].map((c) => `\`${c}\``).join(", ")} FROM \`${table}\` ORDER BY ${order}`,
    );
    out[table] = rows.map((r) => {
      const row = {};
      for (const c of COLUMNS[table]) {
        const v = r[c];
        row[c] =
          v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "bigint" ? Number(v) : v;
      }
      return row;
    });
  }
  return out;
}

const sha256 = (rows) => crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");

function sqlValue(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  // Standard SQL quoting; backslashes are doubled for MySQL's default sql_mode
  return `'${String(v).replace(/\\/g, "\\\\").replace(/'/g, "''").replace(/\n/g, "\\n").replace(/\r/g, "\\r")}'`;
}

async function generate() {
  const data = await fromApi();
  const lines = [];
  for (const table of TABLES) {
    const rows = data[table];
    if (rows.length === 0) continue;
    const cols = [
      ...COLUMNS[table],
      ...(table === "Impact_intervention_texts" ? [] : ["created_by"]),
    ];
    lines.push(`INSERT INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(", ")}) VALUES`);
    rows.forEach((row, i) => {
      const values = COLUMNS[table].map((c) => sqlValue(row[c]));
      if (table !== "Impact_intervention_texts") values.push(sqlValue(CREATED_BY));
      lines.push(`  (${values.join(", ")})${i === rows.length - 1 ? ";" : ","}`);
    });
    lines.push("");
  }
  process.stdout.write(lines.join("\n"));
  for (const table of TABLES)
    console.error(`${table}: ${data[table].length} rows, sha256 ${sha256(data[table])}`);
}

async function verify() {
  const url = process.env.DB_URL;
  if (!url) throw new Error("DB_URL is required");
  const mysql = await import("mysql2/promise");
  const conn = await mysql.createConnection({
    uri: url,
    supportBigNumbers: true,
    dateStrings: false,
    timezone: "Z",
  });
  let failed = false;
  try {
    const [api, db] = await Promise.all([fromApi(), fromDb(conn)]);
    for (const table of TABLES) {
      const a = sha256(api[table]);
      const d = sha256(db[table]);
      const ok = a === d && api[table].length === db[table].length;
      if (!ok) failed = true;
      console.log(
        `${ok ? "ok  " : "DIFF"} ${table.padEnd(26)} api ${String(api[table].length).padStart(3)} ${a.slice(0, 16)}  db ${String(db[table].length).padStart(3)} ${d.slice(0, 16)}`,
      );
    }
    const [[{ linked, total }]] = await conn.query(
      "SELECT COUNT(Organization_ID) AS linked, COUNT(*) AS total FROM Impact_charities",
    );
    console.log(`     charities linked to an organization: ${linked} of ${total}`);
  } finally {
    await conn.end();
  }
  if (failed) process.exit(1);
}

const command = process.argv[2];
const run = command === "generate" ? generate : command === "verify" ? verify : null;
if (!run) {
  console.error("Usage: node scripts/impact-data.mjs generate|verify");
  process.exit(2);
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
