/**
 * GiveWell's All Grants Fund (AGF): what the fund granted, from GiveWell's public sources, into
 * Impact_fund_portfolio and Impact_givewell_grants (docs/impact-givewell-numbers.md › All Grants
 * Fund grants). Donor-facing figures do not read these tables.
 *
 *   node -r ts-node/register/transpile-only scripts/agf-grants.ts fetch [--cache DIR] [--airtable-csv FILE] > agf.json
 *     Reads GiveWell's public sources and prints a snapshot (deterministic for the same sources):
 *       - the yearly metrics report spreadsheets' "All Grants Fund Grants Summary" (AGF money by
 *         organisation and programme per metrics year) → `portfolio`
 *       - every grant write-up in givewell.org's sitemap (/research/grants/…) recommended in or
 *         after August 2022, when the AGF started → `grants` (amount, month, cost-effectiveness)
 *       - the "Selected grants from the fund" on givewell.org/all-grants-fund and the AGF rows of
 *         GiveWell's impact estimates sheet: grants GiveWell itself names as AGF-funded, with the
 *         exact amount, location, outputs and cost per output where given
 *       - optionally the CSV of GiveWell's grants database (Airtable), downloaded by hand from
 *         givewell.org/research/all-grants (view filtered to the AGF, "Download CSV"): the funder
 *         of every grant, including those without a write-up
 *     --cache DIR keeps every fetched page in DIR and reads it from there next time.
 *
 *   node -r ts-node/register/transpile-only scripts/agf-grants.ts report agf.json
 *     Rows per year, how many have figures, and each year's AGF total against the metrics report.
 *
 *   DB_URL=mysql://… node -r ts-node/register/transpile-only scripts/agf-grants.ts diff agf.json
 *     Dry run: what `sql` would add or change in DB_URL's tables (needs only SELECT).
 *
 *   node -r ts-node/register/transpile-only scripts/agf-grants.ts sql agf.json --by migration:<name> > migration.sql
 *     Upserts for a Prisma data migration, keyed by slug (grants) and fund + year + row key
 *     (portfolio). Rows edited in the admin (updated_by set) keep their values; rows that are no
 *     longer in the sources are left alone (the diff lists them). Each new row gets an
 *     Impact_changes row by the same author.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as mysql from "mysql2/promise";

const GIVEWELL = "https://www.givewell.org";
const SHEET = (id, gid) =>
  `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;

/**
 * GiveWell's yearly metrics report spreadsheets (linked from each year's report PDF on
 * givewell.org/about/impact). Add the new year's sheet here when GiveWell publishes it (August).
 * The AGF table is on the "<year> Funds Directed" tab (gid 849330215 in every year so far).
 */
const METRICS_SHEETS = [
  { year: 2022, id: "1Sm0QjRqib5jniQbJiEi_Y4iE6xy10ebgQlZNyDWNVMk", gid: "849330215" },
  { year: 2023, id: "1w2p0PrgfF7TGBDyIs7hSUTAK0E4EX7GF5WkdMCNVqpQ", gid: "849330215" },
  { year: 2024, id: "1cZyuEQobu6RQXb0cGSgYtfpVjQ686n_HL8FARkb3CZ4", gid: "849330215" },
  { year: 2025, id: "1O0wGjOD9Sr25tCL4HaXY7dEEGV7ftnsEbgiAYRbngyo", gid: "849330215" },
];
/** GiveWell's impact estimates sheet (givewell.org/impact-estimates), grant-level tab */
const IMPACT_ESTIMATES = { id: "1z065ab9PPMu9i5KiQ4yLyQJPFQCfEzHSgtHulPiZeBo", gid: "0" };
/** The AGF launched in August 2022; earlier write-ups can't be AGF grants */
const FIRST_MONTH = "2022-08-01";

/**
 * GiveWell writes the same organisation several ways ("CHAI", "Clinton Health Access Initiative,
 * Inc."). `key` groups them; `abbriv` links to our Organizations row (by Organizations.abbriv) when
 * donors can give to it through us. Names not listed keep their own key.
 */
const ORGANIZATIONS = [
  { key: "Against Malaria Foundation", abbriv: "AMF", match: [/^against malaria/, /^amf\b/] },
  { key: "Malaria Consortium", abbriv: "MC", match: [/^malaria consortium/] },
  { key: "Helen Keller Intl", abbriv: "HKI", match: [/^helen keller/, /^hki\b/] },
  { key: "New Incentives", abbriv: "NI", match: [/^new incentives/] },
  { key: "GiveDirectly", abbriv: "GD", match: [/^givedirectly/, /^give directly/] },
  { key: "Sightsavers", abbriv: "Sight", match: [/^sightsavers/] },
  { key: "Evidence Action", abbriv: null, match: [/^evidence action/] },
  { key: "The END Fund", abbriv: "End", match: [/^(the )?end fund/] },
  { key: "Unlimit Health", abbriv: "SCI", match: [/^unlimit health/, /^sci foundation/] },
  { key: "The Taimaka Project", abbriv: "TMK", match: [/^(the )?taimaka/] },
  { key: "One Acre Fund", abbriv: "OAF", match: [/^one acre fund/] },
  { key: "Clear Solutions", abbriv: "CS", match: [/^clear solutions/] },
  { key: "Access to Medicines Initiative", abbriv: "AMI", match: [/^access to medicines/] },
  { key: "MiracleFeet", abbriv: "MF", match: [/^miracle ?feet/] },
  { key: "Lafiya", abbriv: "LAF", match: [/^lafiya/] },
  { key: "Fortify Health", abbriv: "FH", match: [/^fortify health/] },
  { key: "Family Empowerment Media", abbriv: "FEM", match: [/^family empowerment media/] },
  {
    key: "Clinton Health Access Initiative",
    abbriv: null,
    match: [/^clinton health access/, /^chai\b/],
  },
  { key: "ALIMA", abbriv: null, match: [/^alima\b/, /alliance for international medical action/] },
  { key: "IRD Global", abbriv: null, match: [/^interactive research/, /^ird global/] },
  {
    key: "Innovations for Poverty Action",
    abbriv: null,
    match: [/^innovations for poverty/, /^ipa\b/],
  },
  { key: "IDinsight", abbriv: null, match: [/^id ?insight/] },
  { key: "PATH", abbriv: null, match: [/^path\b/] },
  { key: "Precision Development", abbriv: null, match: [/^precision development/, /^pxd\b/] },
  { key: "Development Innovation Lab", abbriv: "DIL", match: [/development innovation lab/] },
  { key: "University of Chicago", abbriv: null, match: [/^university of chicago/] },
  {
    key: "UC Berkeley",
    abbriv: null,
    match: [/^university of california,? berkeley/, /^uc berkeley/],
  },
  {
    key: "Medicines Development for Global Health",
    abbriv: null,
    match: [/^medicines development/, /^mdgh\b/],
  },
  { key: "Dimagi", abbriv: null, match: [/^dimagi/] },
  {
    key: "International Rescue Committee",
    abbriv: null,
    match: [/^international rescue committee/, /^irc\b/],
  },
  { key: "UNICEF", abbriv: null, match: [/^unicef/] },
  {
    key: "Population Services International",
    abbriv: null,
    match: [/^population services international/, /^psi\b/],
  },
  { key: "Results for Development", abbriv: null, match: [/^results for development/] },
  { key: "RICE Institute", abbriv: null, match: [/^r\.?i\.?c\.?e\.?\b/] },
  { key: "Jhpiego", abbriv: null, match: [/^jhpiego/] },
  { key: "Suvita", abbriv: null, match: [/^suvita/] },
  {
    key: "3ie",
    abbriv: null,
    match: [/^international initiative for impact evaluation/, /^3ie\b/],
  },
  { key: "Y-RISE", abbriv: null, match: [/^yale research initiative on innovation/, /^y-rise\b/] },
  { key: "CEGA", abbriv: null, match: [/^center for effective global action/, /^cega\b/] },
  { key: "Nutrition International", abbriv: null, match: [/^nutrition international/] },
  { key: "Healthy Futures", abbriv: null, match: [/^healthy futures/] },
];

export function organizationKey(name) {
  const n = name
    .toLowerCase()
    .replace(/[’']s\b/g, "")
    .replace(/^the /, "")
    .trim();
  const org = ORGANIZATIONS.find((o) => o.match.some((re) => re.test(n)));
  return org ? org.key : name.replace(/,? (Inc\.?|USA|US|Inc)$/i, "").trim();
}
export const organizationAbbriv = (key) => ORGANIZATIONS.find((o) => o.key === key)?.abbriv ?? null;

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
/** "June 2025" / "Jun 2025" → "2025-06-01" */
export function monthOf(text: string | null | undefined): string | null {
  const m = /\b([A-Za-z]{3,9})\.?,? (\d{4})\b/.exec(text ?? "");
  if (!m) return null;
  const i = MONTHS.findIndex((name) => name.startsWith(m[1].toLowerCase().slice(0, 3)));
  return i < 0 ? null : `${m[2]}-${String(i + 1).padStart(2, "0")}-01`;
}

/** "$1,234,567" → 123456700 (cents); "$1.9 million" → 190000000 */
export function centsOf(text: string | null | undefined, scale?: string): number | null {
  const m = /\$?\s*([\d,]+(?:\.\d+)?)/.exec(text ?? "");
  if (!m) return null;
  const factor = /^(million|mil|m)$/i.test(scale ?? "")
    ? 1e6
    : /^(thousand|k)$/i.test(scale ?? "")
      ? 1e3
      : 1;
  return Math.round(Number(m[1].replace(/,/g, "")) * factor * 100);
}

// region Parsing

/** RFC 4180 CSV (quoted fields may hold commas and newlines) */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") endField();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else field += c;
  }
  if (field !== "" || row.length) endRow();
  return rows;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
    if (e[0] === "#")
      return String.fromCodePoint(
        e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)),
      );
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}
export function htmlText(html) {
  return decodeEntities(
    html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The AGF table of one "<year> Funds Directed" tab: rows between the AGF heading and "Total".
 * 2022–2024 name organisation and programme ("PATH - malaria vaccines"); 2025 the organisation.
 */
export function parseMetricsAgf(csv, year) {
  const rows = parseCsv(csv).map((r) => r.map((c) => c.trim()));
  const start = rows.findIndex((r) =>
    r.some((c) =>
      /all grants fund grants summary|funds directed from the all grants fund/i.test(c),
    ),
  );
  if (start < 0) throw new Error(`${year}: no All Grants Fund table`);
  const header = rows.findIndex((r, i) => i > start && r.some((c) => /^organization/i.test(c)));
  const byProgram = /program/i.test(rows[header].find((c) => /^organization/i.test(c)) ?? "");
  const out: any[] = [];
  let total: number | null = null;
  for (const r of rows.slice(header + 1)) {
    const cells = r.filter((c) => c !== "");
    if (cells.length === 0) continue;
    const name = cells[0];
    const amount = cells.find((c) => /^\$[\d,]+$/.test(c));
    if (/^total$/i.test(name)) {
      total = centsOf(amount);
      break;
    }
    if (!amount) continue;
    let organization: string = name;
    let program: string | null = null;
    if (byProgram) {
      const split = /^(.+?)\s+[–-]\s+(.+)$/.exec(name);
      if (split) [organization, program] = [split[1], split[2]];
    }
    const key = organizationKey(organization);
    out.push({
      fund: "AGF",
      metricsYear: year,
      rowKey: slugify(program ? `${key} ${program}` : key),
      organization,
      organizationKey: key,
      program,
      amountCents: centsOf(amount),
    });
  }
  if (total === null) throw new Error(`${year}: the All Grants Fund table has no Total row`);
  const sum = out.reduce((s, r) => s + r.amountCents, 0);
  // Duplicate keys within a year (same organisation and programme twice) get a counter
  const seen = new Map();
  for (const r of out) {
    const n = (seen.get(r.rowKey) ?? 0) + 1;
    seen.set(r.rowKey, n);
    if (n > 1) r.rowKey = `${r.rowKey}-${n}`;
  }
  return { rows: out, totalCents: total, sumCents: sum };
}

export function slugify(s) {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 180);
}

/** Title-based guess of what a grant pays for; the admin can correct it */
export function grantType(title) {
  const t = title.toLowerCase();
  if (/scoping|exploratory|desk[- ]based|landscap/.test(t)) return "scoping";
  if (
    /\b(rct|trial|study|research|evaluation|survey|monitoring|assessment|analysis|audit|review|data|forecast|pilot)\b|\bestimat/.test(
      t,
    )
  )
    return "research";
  if (/technical (assistance|support)|\bta\b|technical support unit/.test(t)) return "ta";
  if (/organi[sz]ational|operating support|capacity|incubator|accelerator|administrative/.test(t))
    return "org_support";
  return "program";
}

const CE_RE =
  /(?:(threshold|bar)[^.]{0,40})?\b(\d+(?:\.\d+)?)x?(?:\s*(?:to|–|-)\s*(\d+(?:\.\d+)?)x?)?\s*(?:times|x)\s+(?:as\s+)?cost-effective\s+as\s+((?:GiveWell[’']s\s+|our\s+)?(?:benchmark|unconditional cash transfers|direct cash transfers|cash transfers|cash|GiveDirectly))/gi;
const DEATHS_RE =
  /(?:\b([\d,]{2,})\s+deaths\s+averted|deaths\s+averted(?:\s+among[^0-9]{0,60})?\s+([\d,]{2,})\b|avert(?:s|ing)?\s+(?:approximately\s+|about\s+|roughly\s+|around\s+|an estimated\s+)?([\d,]{2,})\s+deaths)/i;

/** One /research/grants/ page → the facts GiveWell states in it (no funder: pages don't name it) */
export function parseGrantPage(html, slug) {
  const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(html);
  const title = decodeEntities(titleMatch?.[1] ?? slug)
    .replace(/\s*\|\s*GiveWell\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const text = htmlText(html);
  const body = text.slice(Math.max(0, text.toLowerCase().indexOf("in a nutshell")));
  const titleMonth = monthOf(/\(([^)]*\d{4})\)\s*$/.exec(title)?.[1]);
  const lead =
    /In ([A-Z][a-z]+ \d{4}),? GiveWell (?:recommended|made|granted)[^$]{0,80}?\$([\d.,]+)(\s*(?:million|thousand)\b|\s?(?:mil|m|k)\b)?/i.exec(
      body,
    );
  const published = /Published:\s*([A-Z][a-z]+ \d{4})/.exec(text);
  const organization = title
    .replace(/\s*\([^)]*\d{4}\)\s*$/, "")
    .split(/\s+[—–]\s+|\s+-\s+/)[0]
    .trim();

  let ce: { low: number; high: number; benchmark: string } | null = null;
  for (const m of body.slice(0, 20000).matchAll(CE_RE)) {
    // "our funding threshold of 10x cash", "grants … at least ~10x", "moved … from 7x to 2x": not
    // this grant's estimate
    const before = body.slice(Math.max(0, m.index! - 60), m.index);
    if (
      m[1] ||
      /at least\s*~?\s*$|from (roughly |about )?\d+(\.\d+)?x to (roughly |about )?$/i.test(before)
    )
      continue;
    ce = {
      low: Number(m[2]),
      high: m[3] ? Number(m[3]) : Number(m[2]),
      benchmark: m[4].replace(/^(GiveWell[’']s|our)\s+/i, "").toLowerCase(),
    };
    break;
  }
  const deaths = DEATHS_RE.exec(body.slice(0, 20000));
  return {
    slug,
    title,
    organization,
    organizationKey: organizationKey(organization),
    recommendedMonth: lead ? monthOf(lead[1]) : titleMonth,
    publishedMonth: published ? monthOf(published[1]) : null,
    amountCents: lead ? centsOf(lead[2], lead[3]?.trim()) : null,
    amountExact: lead ? !lead[3] : false,
    ceLow: ce?.low ?? null,
    ceHigh: ce?.high ?? null,
    ceBenchmark: ce?.benchmark ?? null,
    deathsAverted: deaths ? Number((deaths[1] ?? deaths[2] ?? deaths[3]).replace(/,/g, "")) : null,
    grantType: grantType(title),
  };
}

/** givewell.org/all-grants-fund › "Selected grants from the fund" */
export function parseAgfPage(html: string) {
  const out: any[] = [];
  for (const [article] of html.matchAll(
    /<article class="node node--type-grant[\s\S]*?<\/article>/g,
  )) {
    const get = (re) => re.exec(article)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
    out.push({
      month: get(/datetime="(\d{4}-\d{2})/) ? `${get(/datetime="(\d{4}-\d{2})/)}-01` : null,
      href: get(/<h3 class="recipient">\s*<a href="([^"]+)"/),
      recipient: decodeEntities(get(/<h3 class="recipient">[\s\S]*?<p>([\s\S]*?)<\/p>/) ?? ""),
      purpose: decodeEntities(
        get(/field--name-field-grant-subtitle[\s\S]*?<em>([\s\S]*?)<\/em>/) ?? "",
      ),
      amountCents: centsOf(get(/field--name-field-grant-amount[\s\S]*?<span>([\s\S]*?)<\/span>/)),
      location: decodeEntities(
        get(/field--name-field-locations[\s\S]*?<strong>([\s\S]*?)<\/strong>/) ?? "",
      ).replace(/\s*,\s*/g, ", "),
    });
  }
  return out;
}

/**
 * GiveWell's impact estimates sheet, grant tab: the rows whose funding source is the AGF. A grant
 * spans several rows (one per funding gap); figures are on the first row
 */
export function parseImpactEstimates(csv) {
  const rows = parseCsv(csv);
  const out: any[] = [];
  for (const r of rows) {
    if (!/all grants fund/i.test(r[1] ?? "")) continue;
    const num = (s) => (s && /\d/.test(s) ? Number(s.replace(/[$,]/g, "")) : null);
    out.push({
      name: r[0].trim(),
      organization: r[3].trim(),
      organizationKey: organizationKey(r[3].trim()),
      fundingGap: r[4].trim() || null,
      month: monthOf(r[8]),
      metricsYear: num(r[9]),
      fundAmountCents: centsOf(r[10]),
      intervention: r[12].trim() || null,
      outputUnit: r[13].trim() || null,
      centsPerOutput: num(r[15]) === null ? null : Math.round(num(r[15])! * 100),
      outputs: num(r[16]),
      deathsAverted: /lives saved/i.test(r[14] ?? "") ? num(r[18]) : null,
    });
  }
  return out;
}

/**
 * GiveWell's grants database as CSV (Airtable "Download CSV"). The column names below were not
 * checked against a real export; the importer stops and lists the headers if one is missing.
 */
const AIRTABLE_COLUMNS = {
  name: [/^(grant|name|grant name)$/i],
  organization: [/^(recipient|organization|grantee)/i],
  funders: [/^(funder|funders|funding source)/i],
  amount: [/^(amount|grant amount)/i],
  date: [/^(date|month|date of grant|grant date)/i],
  url: [/^(link|url|grant page|write-?up)/i],
};
export function parseAirtableCsv(csv) {
  const [header, ...rows] = parseCsv(csv);
  const col: Record<string, number> = {};
  for (const [field, patterns] of Object.entries(AIRTABLE_COLUMNS)) {
    col[field] = header.findIndex((h) => patterns.some((re) => re.test(h.trim())));
    if (col[field] < 0 && field !== "url")
      throw new Error(`Airtable CSV: no "${field}" column in ${JSON.stringify(header)}`);
  }
  return rows
    .filter((r) => r[col.name]?.trim())
    .map((r) => {
      const url = col.url >= 0 ? r[col.url]?.trim() : "";
      const slug = /\/research\/grants\/([^/?#\s]+)/.exec(url ?? "")?.[1] ?? null;
      return {
        name: r[col.name].trim(),
        slug,
        organization: r[col.organization].trim(),
        funders: r[col.funders].split(/\s*,\s*/).filter(Boolean),
        amountCents: centsOf(r[col.amount]),
        month:
          monthOf(r[col.date]) ??
          (/^\d{4}-\d{2}/.test(r[col.date]) ? `${r[col.date].slice(0, 7)}-01` : null),
      };
    });
}

// region Fetching

async function fetchText(
  url: string,
  cache: string | undefined,
  { redirect = "follow" as RequestRedirect } = {},
): Promise<{ status: number; location: string | null; body: string }> {
  const file = cache && path.join(cache, crypto.createHash("sha1").update(url).digest("hex"));
  if (file && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const res = await fetch(url, {
    redirect,
    headers: { "user-agent": "gieffektivt.no impact importer" },
  });
  if (redirect === "follow" && !res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const result = {
    status: res.status,
    location: res.headers.get("location"),
    body: await res.text(),
  };
  if (file) fs.writeFileSync(file, JSON.stringify(result));
  else await new Promise((r) => setTimeout(r, 250)); // be gentle with givewell.org
  return result;
}

const slugOfUrl = (url: string): string | null =>
  /\/research\/grants\/([^/?#]+)/.exec(url)?.[1] ?? null;

async function fetchAll({ cache, airtableCsv }: { cache?: string; airtableCsv?: string }) {
  if (cache) fs.mkdirSync(cache, { recursive: true });
  const get = async (url: string) => (await fetchText(url, cache)).body;

  // Portfolio: the metrics reports' AGF tables
  const portfolio: any[] = [];
  const metrics: { year: number; totalCents: number | null; sumCents: number }[] = [];
  for (const s of METRICS_SHEETS) {
    const parsed = parseMetricsAgf(await get(SHEET(s.id, s.gid)), s.year);
    const url = `https://docs.google.com/spreadsheets/d/${s.id}/edit?gid=${s.gid}`;
    for (const r of parsed.rows)
      portfolio.push({ ...r, sourceName: `GiveWell metrics report ${s.year}`, sourceUrl: url });
    metrics.push({ year: s.year, totalCents: parsed.totalCents, sumCents: parsed.sumCents });
  }

  // Grant write-ups listed in the sitemap
  const sitemap = await get(`${GIVEWELL}/sitemap.xml`);
  const slugs = [
    ...new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => slugOfUrl(m[1]))),
  ]
    .filter((slug): slug is string => !!slug)
    .sort();
  const grants = new Map<string, any>();
  for (const slug of slugs) {
    const page = parseGrantPage(await get(`${GIVEWELL}/research/grants/${slug}`), slug);
    if (!page.recommendedMonth || page.recommendedMonth < FIRST_MONTH) continue;
    grants.set(slug.toLowerCase(), {
      ...page,
      location: null,
      funders: null,
      fundAmountCents: null,
      outputs: null,
      outputUnit: null,
      centsPerOutput: null,
      sources: ["grant_page"],
      sourceUrl: `${GIVEWELL}/research/grants/${slug}`,
      notes: null,
    });
  }
  /** Replaces a grant in the map with the facts added (no in-place mutation) */
  const update = (grant, patch: Record<string, unknown>) =>
    grants.set(grant.slug.toLowerCase(), { ...grant, ...patch });
  const byOrgMonth = (key, month) =>
    [...grants.values()].filter((g) => g.organizationKey === key && g.recommendedMonth === month);

  // Grants GiveWell names as AGF grants
  for (const item of parseAgfPage(await get(`${GIVEWELL}/all-grants-fund`))) {
    let slug: string | null = null;
    if (item.href) {
      const res = await fetchText(new URL(item.href, GIVEWELL).toString(), cache, {
        redirect: "manual",
      });
      slug = slugOfUrl(res.location ?? item.href);
    }
    const key = organizationKey(item.recipient);
    const grant =
      (slug && grants.get(slug.toLowerCase())) ??
      (byOrgMonth(key, item.month).length === 1 ? byOrgMonth(key, item.month)[0] : null);
    const facts = {
      funders: ["AGF"],
      location: item.location || null,
      amountCents: item.amountCents,
      amountExact: true,
    };
    if (grant) update(grant, { ...facts, sources: [...grant.sources, "agf_page"] });
    else
      grants.set(`agf-page-${slugify(`${key} ${item.month}`)}`, {
        ...emptyGrant(`agf-page-${slugify(`${key} ${item.month}`)}`),
        title: `${item.recipient} ${item.purpose}`.trim(),
        organization: item.recipient,
        organizationKey: key,
        recommendedMonth: item.month,
        grantType: grantType(item.purpose),
        ...facts,
        sources: ["agf_page"],
        sourceUrl: `${GIVEWELL}/all-grants-fund`,
      });
  }

  // AGF rows of the impact estimates sheet: the AGF's part with outputs
  for (const ie of parseImpactEstimates(
    await get(SHEET(IMPACT_ESTIMATES.id, IMPACT_ESTIMATES.gid)),
  )) {
    const matches = byOrgMonth(ie.organizationKey, ie.month);
    const facts = {
      funders: ["AGF"],
      fundAmountCents: ie.fundAmountCents,
      outputs: ie.outputs,
      outputUnit: ie.outputUnit,
      centsPerOutput: ie.centsPerOutput,
      deathsAverted: ie.deathsAverted,
    };
    const note = `Impact estimates sheet: "${ie.name}"${ie.fundingGap ? `, ${ie.fundingGap}` : ""}`;
    if (matches.length === 1) {
      const g = matches[0];
      update(g, {
        ...facts,
        deathsAverted: ie.deathsAverted ?? g.deathsAverted,
        sources: [...g.sources, "impact_estimates"],
        notes: [g.notes, note].filter(Boolean).join("\n"),
      });
    } else {
      const slug = `impact-estimates-${slugify(ie.name)}`;
      grants.set(slug, {
        ...emptyGrant(slug),
        title: `${ie.organization}${ie.fundingGap ? ` – ${ie.fundingGap}` : ""} (${ie.name})`,
        organization: ie.organization,
        organizationKey: ie.organizationKey,
        recommendedMonth: ie.month,
        grantType: "program",
        amountCents: ie.fundAmountCents,
        amountExact: true,
        ...facts,
        sources: ["impact_estimates"],
        sourceUrl: "https://www.givewell.org/impact-estimates",
        notes: note,
      });
    }
  }

  // GiveWell's grants database, if downloaded
  if (airtableCsv) {
    for (const a of parseAirtableCsv(fs.readFileSync(airtableCsv, "utf8"))) {
      const key = organizationKey(a.organization);
      const g = (a.slug && grants.get(a.slug.toLowerCase())) ?? null;
      const funders = a.funders.map((f) =>
        /all grants/i.test(f)
          ? "AGF"
          : /top charities/i.test(f)
            ? "TCF"
            : /unrestricted/i.test(f)
              ? "Unrestricted"
              : f,
      );
      if (g) update(g, { funders, sources: [...new Set([...g.sources, "airtable"])] });
      else if (funders.includes("AGF")) {
        const slug = `airtable-${slugify(a.name)}`;
        grants.set(slug, {
          ...emptyGrant(slug),
          title: a.name,
          organization: a.organization,
          organizationKey: key,
          recommendedMonth: a.month,
          grantType: grantType(a.name),
          amountCents: a.amountCents,
          amountExact: true,
          funders,
          sources: ["airtable"],
          sourceUrl: `${GIVEWELL}/research/all-grants`,
        });
      }
    }
  }

  const sortedGrants = [...grants.values()]
    .map((g) => ({
      ...g,
      funders: g.funders ? [...new Set(g.funders)].join(", ") : null,
      sources: [...new Set(g.sources)].join(","),
    }))
    .sort(
      (a, b) =>
        (a.recommendedMonth ?? "").localeCompare(b.recommendedMonth ?? "") ||
        a.slug.localeCompare(b.slug),
    );
  portfolio.sort((a, b) => a.metricsYear - b.metricsYear || a.rowKey.localeCompare(b.rowKey));
  return { metrics, portfolio, grants: sortedGrants };
}

function emptyGrant(slug) {
  return {
    slug,
    title: slug,
    organization: "",
    organizationKey: "",
    recommendedMonth: null,
    publishedMonth: null,
    amountCents: null,
    amountExact: false,
    ceLow: null,
    ceHigh: null,
    ceBenchmark: null,
    deathsAverted: null,
    grantType: null,
    location: null,
    funders: null,
    fundAmountCents: null,
    outputs: null,
    outputUnit: null,
    centsPerOutput: null,
    sources: [],
    sourceUrl: null,
    notes: null,
  };
}

// region Report, SQL, diff

export const hasFigures = (g) =>
  g.ceLow !== null || g.outputs !== null || g.centsPerOutput !== null || g.deathsAverted !== null;

function report(data) {
  const usd = (c) => `$${Math.round(c / 100).toLocaleString("en-US")}`;
  console.log("Portfolio (metrics report AGF tables): rows, sum of rows vs the report's total");
  for (const m of data.metrics) {
    const rows = data.portfolio.filter((r) => r.metricsYear === m.year);
    console.log(
      `  ${m.year}: ${String(rows.length).padStart(3)} rows  ${usd(m.sumCents).padStart(14)}  total ${usd(m.totalCents).padStart(14)}  ${m.sumCents === m.totalCents ? "ok" : `DIFF ${usd(m.sumCents - m.totalCents)}`}`,
    );
  }
  console.log(
    "Grants by year recommended: all | AGF named by GiveWell | with figures (CE, outputs or deaths averted)",
  );
  const years = [...new Set(data.grants.map((g) => g.recommendedMonth?.slice(0, 4) ?? "?"))].sort();
  for (const y of years) {
    const gs = data.grants.filter((g) => (g.recommendedMonth?.slice(0, 4) ?? "?") === y);
    console.log(
      `  ${y}: ${String(gs.length).padStart(3)} | ${String(gs.filter((g) => g.funders?.includes("AGF")).length).padStart(3)} | ${String(gs.filter(hasFigures).length).padStart(3)}  (CE multiple ${gs.filter((g) => g.ceLow !== null).length}, outputs ${gs.filter((g) => g.outputs !== null).length}, deaths averted ${gs.filter((g) => g.deathsAverted !== null).length})`,
    );
  }
}

function sqlValue(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  return `'${String(v).replace(/\\/g, "\\\\").replace(/'/g, "''").replace(/\n/g, "\\n").replace(/\r/g, "\\r")}'`;
}

const PORTFOLIO_COLUMNS = {
  fund: "fund",
  metrics_year: "metricsYear",
  row_key: "rowKey",
  organization: "organization",
  organization_key: "organizationKey",
  program: "program",
  amount_cents: "amountCents",
  source_name: "sourceName",
  source_url: "sourceUrl",
};
const GRANT_COLUMNS = {
  slug: "slug",
  title: "title",
  organization: "organization",
  organization_key: "organizationKey",
  location: "location",
  grant_type: "grantType",
  recommended_month: "recommendedMonth",
  published_month: "publishedMonth",
  amount_cents: "amountCents",
  amount_exact: "amountExact",
  funders: "funders",
  fund_amount_cents: "fundAmountCents",
  ce_low: "ceLow",
  ce_high: "ceHigh",
  ce_benchmark: "ceBenchmark",
  outputs: "outputs",
  output_unit: "outputUnit",
  cents_per_output: "centsPerOutput",
  deaths_averted: "deathsAverted",
  sources: "sources",
  source_url: "sourceUrl",
  notes: "notes",
};
const KEYS = {
  Impact_fund_portfolio: ["fund", "metrics_year", "row_key"],
  Impact_givewell_grants: ["slug"],
};

function upsert(table, columns, rows, by) {
  const cols = Object.keys(columns);
  const keys = KEYS[table];
  const lines = [
    `INSERT INTO \`${table}\` (${[...cols, "created_by"].map((c) => `\`${c}\``).join(", ")}) VALUES`,
  ];
  rows.forEach((row, i) => {
    const values = cols.map((c) => sqlValue(row[columns[c]]));
    lines.push(`  (${[...values, sqlValue(by)].join(", ")})${i === rows.length - 1 ? "" : ","}`);
  });
  // Rows edited in the admin keep their values
  lines.push(
    `AS new ON DUPLICATE KEY UPDATE\n${cols
      .filter((c) => !keys.includes(c))
      .map(
        (c) =>
          `  \`${c}\` = IF(\`${table}\`.updated_by IS NULL, new.\`${c}\`, \`${table}\`.\`${c}\`)`,
      )
      .join(",\n")};`,
  );
  return lines.join("\n");
}

/** Our Organizations, by abbriv, for the organisations donors can give to through us */
function linkOrganizations(table) {
  const pairs = ORGANIZATIONS.filter((o) => o.abbriv);
  return `UPDATE \`${table}\` t JOIN \`Organizations\` o ON o.abbriv = CASE t.organization_key\n${pairs
    .map((o) => `  WHEN ${sqlValue(o.key)} THEN ${sqlValue(o.abbriv)}`)
    .join("\n")}\nEND\nSET t.Organization_ID = o.ID\nWHERE t.Organization_ID IS NULL;`;
}

function toSql(data, by) {
  if (!/^migration:[\w-]+$/.test(by ?? "")) throw new Error("--by migration:<name> is required");
  const changes = (table, entity, summary, json) =>
    `INSERT INTO \`Impact_changes\` (\`entity\`, \`entity_id\`, \`action\`, \`Charity_ID\`, \`summary\`, \`before\`, \`after\`, \`changed_by\`, \`changed_at\`)\nSELECT ${sqlValue(entity)}, t.ID, 'create', NULL, LEFT(${summary}, 255), NULL, ${json}, ${sqlValue(by)}, UTC_TIMESTAMP()\nFROM \`${table}\` t\nWHERE t.created_by = ${sqlValue(by)}\n  AND NOT EXISTS (SELECT 1 FROM \`Impact_changes\` c WHERE c.entity = ${sqlValue(entity)} AND c.entity_id = t.ID);`;
  const json = (columns) =>
    `JSON_OBJECT(${Object.entries(columns)
      .map(([col, field]) => `'${field}', t.\`${col}\``)
      .join(", ")})`;
  return [
    upsert("Impact_fund_portfolio", PORTFOLIO_COLUMNS, data.portfolio, by),
    upsert("Impact_givewell_grants", GRANT_COLUMNS, data.grants, by),
    linkOrganizations("Impact_fund_portfolio"),
    linkOrganizations("Impact_givewell_grants"),
    changes(
      "Impact_fund_portfolio",
      "agf_summary",
      "CONCAT('AGF ', t.metrics_year, ': ', t.organization, IFNULL(CONCAT(' – ', t.program), ''))",
      json(PORTFOLIO_COLUMNS),
    ),
    changes("Impact_givewell_grants", "givewell_grant", "t.title", json(GRANT_COLUMNS)),
    "",
  ].join("\n\n");
}

async function diff(data) {
  const url = process.env.DB_URL;
  if (!url) throw new Error("DB_URL is required");
  const conn = await mysql.createConnection({
    uri: url,
    supportBigNumbers: true,
    bigNumberStrings: false,
    dateStrings: true,
  });
  try {
    const tables: [string, Record<string, string>, any[], (r: any) => string][] = [
      [
        "Impact_fund_portfolio",
        PORTFOLIO_COLUMNS,
        data.portfolio,
        (r) => `${r.fund}|${r.metricsYear}|${r.rowKey}`,
      ],
      ["Impact_givewell_grants", GRANT_COLUMNS, data.grants, (r) => r.slug],
    ];
    for (const [table, columns, rows, keyOf] of tables) {
      const [dbRows] = (await conn.query(`SELECT * FROM \`${table}\``)) as [any[], unknown];
      const db = new Map(
        dbRows.map((row) => {
          const r = Object.fromEntries(
            Object.entries(columns).map(([c, f]) => [f, normalize(row[c])]),
          );
          return [keyOf(r), { r, edited: row.updated_by !== null }];
        }),
      );
      const seen = new Set();
      let added = 0;
      let changed = 0;
      for (const row of rows) {
        const key = keyOf(row);
        seen.add(key);
        const existing = db.get(key);
        if (!existing) {
          added++;
          console.log(`+ ${table} ${key}`);
          continue;
        }
        const fields = Object.values(columns).filter((f) => normalize(row[f]) !== existing.r[f]);
        if (fields.length) {
          changed++;
          console.log(
            `${existing.edited ? "= (edited in the admin, kept)" : "~"} ${table} ${key}: ${fields.map((f) => `${f} ${JSON.stringify(existing.r[f])} → ${JSON.stringify(normalize(row[f]))}`).join("; ")}`,
          );
        }
      }
      const gone = [...db.keys()].filter((k) => !seen.has(k));
      for (const k of gone)
        console.log(`? ${table} ${k}: in the database, not in the sources (kept)`);
      console.log(
        `${table}: ${added} new, ${changed} changed, ${gone.length} only in the database`,
      );
    }
  } finally {
    await conn.end();
  }
}

function normalize(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

// region CLI

function option(name) {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
}
const readSnapshot = () => {
  const file = process.argv[3];
  if (!file || file.startsWith("--")) throw new Error("Give the snapshot file from `fetch`");
  return JSON.parse(fs.readFileSync(file, "utf8"));
};

const commands = {
  fetch: async () =>
    process.stdout.write(
      `${JSON.stringify(await fetchAll({ cache: option("--cache"), airtableCsv: option("--airtable-csv") }), null, 1)}\n`,
    ),
  report: async () => report(readSnapshot()),
  sql: async () => process.stdout.write(toSql(readSnapshot(), option("--by"))),
  diff: async () => diff(readSnapshot()),
};

if (require.main === module) {
  const run = commands[process.argv[2]];
  if (!run) {
    console.error("Usage: agf-grants.ts fetch|report|diff|sql … (see the comment at the top)");
    process.exit(2);
  }
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
