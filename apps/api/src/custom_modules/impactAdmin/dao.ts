import { DAO } from "../DAO";
import { dbClockColumn } from "../osloDays";

/**
 * The impact tables as the admin edits them (docs/impact-api-migration.md, phase 4): every
 * column, with who created and last changed each row. The tables hold ~200 rows, so reads load
 * them whole. The figures Min Side, receipts and the widget use come from custom_modules/impact,
 * which caches these tables; writes clear that cache.
 */

export type ImpactFundCode = "TCF" | "AGF";
export const IMPACT_FUND_CODES: ImpactFundCode[] = ["TCF", "AGF"];
export type TextLanguage = "no" | "sv" | "et" | "dk";
export const TEXT_LANGUAGES: TextLanguage[] = ["no", "sv", "et", "dk"];

export type RowMeta = {
  createdAt: string;
  createdBy: string;
  updatedAt: string | null;
  updatedBy: string | null;
};

export type AdminCharity = RowMeta & {
  id: number;
  name: string;
  abbreviation: string;
  organizationId: number | null;
  organizationName: string | null;
};

export type InterventionText = { shortDescription: string; longDescription: string };

export type AdminIntervention = RowMeta & {
  id: number;
  /** English */
  shortDescription: string;
  longDescription: string;
  texts: Partial<Record<TextLanguage, InterventionText>>;
};

export type AdminEvaluation = RowMeta & {
  id: number;
  charityId: number;
  interventionId: number;
  /** YYYY-MM-01 */
  validFrom: string;
  /** USD cents */
  centsPerOutput: number;
  centsPerOutputLowerBound: number;
  centsPerOutputUpperBound: number | null;
  sourceName: string;
  sourceUrl: string;
  comment: string;
};

export type AdminAllotment = {
  id: number;
  charityId: number;
  interventionId: number;
  /** USD cents */
  sumInCents: number;
  numberOutputsPurchased: number;
  numberOutputsPurchasedLowerBound: number;
  numberOutputsPurchasedUpperBound: number | null;
  sourceName: string;
  sourceUrl: string;
  comment: string;
};

export type AdminGrant = RowMeta & {
  id: number;
  fund: ImpactFundCode;
  /** YYYY-MM-01 */
  validFrom: string;
  /** The ID the old impact API (and the compatibility REST) shows */
  legacyId: number | null;
  allotments: AdminAllotment[];
};

export type AdminImpactTables = {
  charities: AdminCharity[];
  interventions: AdminIntervention[];
  evaluations: AdminEvaluation[];
  grants: AdminGrant[];
};

/** Anything with mysql2's query(sql, params): the pool or a transaction's connection */
export type Queryable = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

const poolQueryable: Queryable = {
  query: (sql, params) => DAO.query(sql, params as any[]),
};

export async function rows<T>(
  sql: string,
  params: unknown[] = [],
  conn: Queryable = poolQueryable,
): Promise<T[]> {
  const [result] = (await conn.query(sql, params)) as [T[]];
  return result;
}

const date = (column: string, alias = column.split(".").pop()!) =>
  `DATE_FORMAT(${column}, '%Y-%m-%d') AS ${alias}`;
const meta = (t: string) =>
  `${dbClockColumn(`${t}.created_at`)}, ${t}.created_by, ${t}.updated_at, ${t}.updated_by`;

type MetaRow = {
  created_at: Date | string;
  created_by: string;
  updated_at: Date | string | null;
  updated_by: string | null;
};

const iso = (value: Date | string) => new Date(value).toISOString();
const toMeta = (row: MetaRow): RowMeta => ({
  createdAt: iso(row.created_at),
  createdBy: row.created_by,
  updatedAt: row.updated_at === null ? null : iso(row.updated_at),
  updatedBy: row.updated_by,
});

/** Every impact table with its admin columns, oldest estimate and grant first */
async function readTables(conn?: Queryable): Promise<AdminImpactTables> {
  const [charities, interventions, texts, evaluations, grants, allotments] = await Promise.all([
    rows<
      MetaRow & {
        ID: number;
        name: string;
        abbreviation: string;
        Organization_ID: number | null;
        full_name: string | null;
      }
    >(
      `SELECT C.ID, C.name, C.abbreviation, C.Organization_ID, O.full_name, ${meta("C")}
         FROM Impact_charities C LEFT JOIN Organizations O ON O.ID = C.Organization_ID
        ORDER BY C.name`,
      [],
      conn,
    ),
    rows<MetaRow & { ID: number; short_description: string; long_description: string }>(
      `SELECT I.ID, I.short_description, I.long_description, ${meta("I")}
         FROM Impact_interventions I ORDER BY I.short_description`,
      [],
      conn,
    ),
    rows<{
      Intervention_ID: number;
      language: string;
      short_description: string;
      long_description: string;
    }>(
      `SELECT Intervention_ID, language, short_description, long_description FROM Impact_intervention_texts`,
      [],
      conn,
    ),
    rows<
      MetaRow & {
        ID: number;
        Charity_ID: number;
        Intervention_ID: number;
        valid_from: string;
        cents_per_output: number;
        cents_per_output_lower_bound: number;
        cents_per_output_upper_bound: number | null;
        source_name: string;
        source_url: string;
        comment: string;
      }
    >(
      `SELECT E.ID, E.Charity_ID, E.Intervention_ID, ${date("E.valid_from")}, E.cents_per_output,
              E.cents_per_output_lower_bound, E.cents_per_output_upper_bound, E.source_name,
              E.source_url, E.comment, ${meta("E")}
         FROM Impact_evaluations E ORDER BY E.valid_from, E.ID`,
      [],
      conn,
    ),
    rows<MetaRow & { ID: number; fund: string; valid_from: string; legacy_id: number | null }>(
      `SELECT G.ID, G.fund, ${date("G.valid_from")}, G.legacy_id, ${meta("G")}
         FROM Impact_grants G ORDER BY G.valid_from, G.ID`,
      [],
      conn,
    ),
    rows<{
      ID: number;
      Grant_ID: number;
      Charity_ID: number;
      Intervention_ID: number;
      sum_in_cents: number | string;
      number_outputs_purchased: number;
      number_outputs_purchased_lower_bound: number;
      number_outputs_purchased_upper_bound: number | null;
      source_name: string;
      source_url: string;
      comment: string;
    }>(
      `SELECT ID, Grant_ID, Charity_ID, Intervention_ID, sum_in_cents, number_outputs_purchased,
              number_outputs_purchased_lower_bound, number_outputs_purchased_upper_bound,
              source_name, source_url, comment
         FROM Impact_grant_allotments ORDER BY ID`,
      [],
      conn,
    ),
  ]);

  const textsById = new Map<number, AdminIntervention["texts"]>();
  for (const t of texts) {
    if (!TEXT_LANGUAGES.includes(t.language as TextLanguage)) continue;
    const entry = textsById.get(t.Intervention_ID) ?? {};
    entry[t.language as TextLanguage] = {
      shortDescription: t.short_description,
      longDescription: t.long_description,
    };
    textsById.set(t.Intervention_ID, entry);
  }

  const allotmentsByGrant = new Map<number, AdminAllotment[]>();
  for (const a of allotments) {
    const list = allotmentsByGrant.get(a.Grant_ID) ?? [];
    list.push({
      id: a.ID,
      charityId: a.Charity_ID,
      interventionId: a.Intervention_ID,
      sumInCents: Number(a.sum_in_cents),
      numberOutputsPurchased: Number(a.number_outputs_purchased),
      numberOutputsPurchasedLowerBound: Number(a.number_outputs_purchased_lower_bound),
      numberOutputsPurchasedUpperBound:
        a.number_outputs_purchased_upper_bound === null
          ? null
          : Number(a.number_outputs_purchased_upper_bound),
      sourceName: a.source_name,
      sourceUrl: a.source_url,
      comment: a.comment,
    });
    allotmentsByGrant.set(a.Grant_ID, list);
  }

  return {
    charities: charities.map((c) => ({
      id: c.ID,
      name: c.name,
      abbreviation: c.abbreviation,
      organizationId: c.Organization_ID,
      organizationName: c.full_name,
      ...toMeta(c),
    })),
    interventions: interventions.map((i) => ({
      id: i.ID,
      shortDescription: i.short_description,
      longDescription: i.long_description,
      texts: textsById.get(i.ID) ?? {},
      ...toMeta(i),
    })),
    evaluations: evaluations.map((e) => ({
      id: e.ID,
      charityId: e.Charity_ID,
      interventionId: e.Intervention_ID,
      validFrom: e.valid_from,
      centsPerOutput: Number(e.cents_per_output),
      centsPerOutputLowerBound: Number(e.cents_per_output_lower_bound),
      centsPerOutputUpperBound:
        e.cents_per_output_upper_bound === null ? null : Number(e.cents_per_output_upper_bound),
      sourceName: e.source_name,
      sourceUrl: e.source_url,
      comment: e.comment,
      ...toMeta(e),
    })),
    grants: grants.map((g) => ({
      id: g.ID,
      fund: g.fund as ImpactFundCode,
      validFrom: g.valid_from,
      legacyId: g.legacy_id,
      allotments: allotmentsByGrant.get(g.ID) ?? [],
      ...toMeta(g),
    })),
  };
}

export type ExchangeRateCurrency = {
  currency: string;
  latestDate: string;
  perUsd: string;
  source: string;
  days: number;
  firstDate: string;
};

/** Per currency: the newest rate, how many days are stored, and since when */
async function readLatestRates(): Promise<ExchangeRateCurrency[]> {
  const result = await rows<{
    currency: string;
    latest: string;
    first: string;
    days: number;
    per_usd: string;
    source: string;
  }>(
    `SELECT R.currency, DATE_FORMAT(R.date, '%Y-%m-%d') AS latest, S.first, S.days, R.per_usd, R.source
       FROM (SELECT currency, MAX(date) AS latest, DATE_FORMAT(MIN(date), '%Y-%m-%d') AS first,
                    COUNT(*) AS days
               FROM Exchange_rates GROUP BY currency) S
       JOIN Exchange_rates R ON R.currency = S.currency AND R.date = S.latest
      ORDER BY R.currency`,
  );
  return result.map((r) => ({
    currency: r.currency,
    latestDate: r.latest,
    firstDate: r.first,
    days: Number(r.days),
    perUsd: String(r.per_usd),
    source: r.source,
  }));
}

/** The distinct days with rates on or after `from` (YYYY-MM-DD), oldest first */
async function readRateDays(from: string): Promise<string[]> {
  const result = await rows<{ day: string }>(
    `SELECT DISTINCT DATE_FORMAT(date, '%Y-%m-%d') AS day FROM Exchange_rates WHERE date >= ?
      ORDER BY day`,
    [from],
  );
  return result.map((r) => r.day);
}

/** The newest stored rate on or before `day` for `currency` */
async function readRateOn(
  currency: string,
  day: string,
): Promise<{ date: string; perUsd: number } | null> {
  if (currency === "USD") return { date: day, perUsd: 1 };
  const [row] = await rows<{ date: string; per_usd: string }>(
    `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS date, per_usd FROM Exchange_rates
      WHERE currency = ? AND date <= ? ORDER BY date DESC LIMIT 1`,
    [currency, day],
  );
  return row ? { date: row.date, perUsd: Number(row.per_usd) } : null;
}

export type ExchangeRateJobRun = { id: number; at: string; result: unknown };

/** The newest Import_logs entries of the daily exchange-rate job (label "ExchangeRates") */
async function readJobRuns(limit = 5): Promise<ExchangeRateJobRun[]> {
  const result = await rows<{ ID: number; timestamp: Date | string; result: unknown }>(
    `SELECT ID, ${dbClockColumn("timestamp")}, result FROM Import_logs
      WHERE label = 'ExchangeRates' ORDER BY Import_logs.timestamp DESC, ID DESC LIMIT ?`,
    [limit],
  );
  return result.map((r) => ({
    id: r.ID,
    at: iso(r.timestamp),
    result: typeof r.result === "string" ? JSON.parse(r.result) : r.result,
  }));
}

/**
 * Donations and donors with a share to `organizationId` whose time falls in any of the ranges
 * (UTC instants, `before` exclusive). Donations are counted once, however many shares they have.
 */
async function countDonations(
  organizationId: number,
  ranges: { from: Date; before: Date | null }[],
): Promise<{ donations: number; donors: number }> {
  if (ranges.length === 0) return { donations: 0, donors: 0 };
  const clauses = ranges.map((r) =>
    r.before
      ? "(D.timestamp_confirmed >= ? AND D.timestamp_confirmed < ?)"
      : "(D.timestamp_confirmed >= ?)",
  );
  const params: unknown[] = [organizationId];
  for (const r of ranges) params.push(r.from, ...(r.before ? [r.before] : []));
  const [row] = await rows<{ donations: number; donors: number }>(
    `SELECT COUNT(DISTINCT D.ID) AS donations, COUNT(DISTINCT D.Donor_ID) AS donors
       FROM Donations D
       JOIN Distribution_cause_areas CA ON CA.Distribution_KID = D.KID_fordeling
       JOIN Distribution_cause_area_organizations CAO ON CAO.Distribution_cause_area_ID = CA.ID
      WHERE CAO.Organization_ID = ? AND CA.Percentage_share > 0 AND CAO.Percentage_share > 0
        AND (${clauses.join(" OR ")})`,
    params,
  );
  return { donations: Number(row?.donations ?? 0), donors: Number(row?.donors ?? 0) };
}

//region Writes

/** Runs fn in a transaction; commits if it resolves, rolls back if it throws */
async function inTransaction<T>(fn: (conn: Queryable) => Promise<T>): Promise<T> {
  const conn = await DAO.startTransaction();
  try {
    const result = await fn(conn as unknown as Queryable);
    await DAO.commitTransaction(conn);
    return result;
  } catch (ex) {
    await DAO.rollbackTransaction(conn);
    throw ex;
  }
}

type Header = { insertId: number; affectedRows: number };
async function exec(conn: Queryable, sql: string, params: unknown[]): Promise<Header> {
  const [result] = (await conn.query(sql, params)) as [Header];
  return result;
}

export type EstimateValues = {
  interventionId: number;
  validFrom: string;
  centsPerOutput: number;
  centsPerOutputLowerBound: number;
  centsPerOutputUpperBound: number | null;
  sourceName: string;
  sourceUrl: string;
  comment: string;
};

const estimateParams = (v: EstimateValues) => [
  v.interventionId,
  v.validFrom,
  v.centsPerOutput,
  v.centsPerOutputLowerBound,
  v.centsPerOutputUpperBound,
  v.sourceName,
  v.sourceUrl,
  v.comment,
];

async function insertEstimate(
  conn: Queryable,
  charityId: number,
  v: EstimateValues,
  actor: string,
): Promise<number> {
  const result = await exec(
    conn,
    `INSERT INTO Impact_evaluations (Charity_ID, Intervention_ID, valid_from, cents_per_output,
       cents_per_output_lower_bound, cents_per_output_upper_bound, source_name, source_url, comment,
       created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [charityId, ...estimateParams(v), actor, new Date()],
  );
  return result.insertId;
}

async function updateEstimate(conn: Queryable, id: number, v: EstimateValues, actor: string) {
  await exec(
    conn,
    `UPDATE Impact_evaluations SET Intervention_ID = ?, valid_from = ?, cents_per_output = ?,
       cents_per_output_lower_bound = ?, cents_per_output_upper_bound = ?, source_name = ?,
       source_url = ?, comment = ?, updated_by = ?, updated_at = ?
     WHERE ID = ?`,
    [...estimateParams(v), actor, new Date(), id],
  );
}

async function deleteEstimate(conn: Queryable, id: number) {
  await exec(conn, "DELETE FROM Impact_evaluations WHERE ID = ?", [id]);
}

export type AllotmentValues = Omit<AdminAllotment, "id"> & { id?: number };

const allotmentParams = (a: AllotmentValues) => [
  a.charityId,
  a.interventionId,
  a.sumInCents,
  a.numberOutputsPurchased,
  a.numberOutputsPurchasedLowerBound,
  a.numberOutputsPurchasedUpperBound,
  a.sourceName,
  a.sourceUrl,
  a.comment,
];

/** The next legacy_id of a fund: the compatibility REST shows it as the grant's `id` */
async function nextLegacyId(conn: Queryable, fund: ImpactFundCode): Promise<number> {
  const [row] = await rows<{ next: number }>(
    "SELECT COALESCE(MAX(legacy_id), 0) + 1 AS next FROM Impact_grants WHERE fund = ? FOR UPDATE",
    [fund],
    conn,
  );
  return Number(row!.next);
}

async function insertGrant(
  conn: Queryable,
  grant: { fund: ImpactFundCode; validFrom: string },
  actor: string,
): Promise<number> {
  const legacyId = await nextLegacyId(conn, grant.fund);
  const result = await exec(
    conn,
    `INSERT INTO Impact_grants (fund, valid_from, legacy_id, created_by, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [grant.fund, grant.validFrom, legacyId, actor, new Date()],
  );
  return result.insertId;
}

async function updateGrant(conn: Queryable, id: number, validFrom: string, actor: string) {
  await exec(
    conn,
    "UPDATE Impact_grants SET valid_from = ?, updated_by = ?, updated_at = ? WHERE ID = ?",
    [validFrom, actor, new Date(), id],
  );
}

async function deleteGrant(conn: Queryable, id: number) {
  await exec(conn, "DELETE FROM Impact_grant_allotments WHERE Grant_ID = ?", [id]);
  await exec(conn, "DELETE FROM Impact_grants WHERE ID = ?", [id]);
}

/**
 * Makes the grant's allotments these: rows with an id are updated in place (IDs are kept), rows
 * without one inserted, and the grant's other allotments deleted.
 */
async function replaceAllotments(
  conn: Queryable,
  grantId: number,
  allotments: AllotmentValues[],
  actor: string,
) {
  const keep = allotments.flatMap((a) => (a.id ? [a.id] : []));
  await exec(
    conn,
    `DELETE FROM Impact_grant_allotments WHERE Grant_ID = ?${keep.length ? " AND ID NOT IN (?)" : ""}`,
    keep.length ? [grantId, keep] : [grantId],
  );
  for (const a of allotments) {
    if (a.id)
      await exec(
        conn,
        `UPDATE Impact_grant_allotments SET Charity_ID = ?, Intervention_ID = ?, sum_in_cents = ?,
           number_outputs_purchased = ?, number_outputs_purchased_lower_bound = ?,
           number_outputs_purchased_upper_bound = ?, source_name = ?, source_url = ?, comment = ?,
           updated_by = ?, updated_at = ?
         WHERE ID = ? AND Grant_ID = ?`,
        [...allotmentParams(a), actor, new Date(), a.id, grantId],
      );
    else
      await exec(
        conn,
        `INSERT INTO Impact_grant_allotments (Grant_ID, Charity_ID, Intervention_ID, sum_in_cents,
           number_outputs_purchased, number_outputs_purchased_lower_bound,
           number_outputs_purchased_upper_bound, source_name, source_url, comment, created_by,
           created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [grantId, ...allotmentParams(a), actor, new Date()],
      );
  }
}

async function insertCharity(
  conn: Queryable,
  c: { name: string; abbreviation: string; organizationId: number | null },
  actor: string,
): Promise<number> {
  const result = await exec(
    conn,
    `INSERT INTO Impact_charities (name, abbreviation, Organization_ID, created_by, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [c.name, c.abbreviation, c.organizationId, actor, new Date()],
  );
  return result.insertId;
}

async function updateCharity(
  conn: Queryable,
  id: number,
  c: { name: string; organizationId: number | null },
  actor: string,
) {
  await exec(
    conn,
    `UPDATE Impact_charities SET name = ?, Organization_ID = ?, updated_by = ?, updated_at = ?
      WHERE ID = ?`,
    [c.name, c.organizationId, actor, new Date(), id],
  );
}

async function organizationExists(conn: Queryable, id: number): Promise<boolean> {
  return (await rows("SELECT ID FROM Organizations WHERE ID = ?", [id], conn)).length > 0;
}

export type InterventionValues = {
  shortDescription: string;
  longDescription: string;
  texts: Partial<Record<TextLanguage, InterventionText>>;
};

async function writeTexts(conn: Queryable, id: number, texts: InterventionValues["texts"]) {
  await exec(conn, "DELETE FROM Impact_intervention_texts WHERE Intervention_ID = ?", [id]);
  for (const language of TEXT_LANGUAGES) {
    const text = texts[language];
    if (!text) continue;
    await exec(
      conn,
      `INSERT INTO Impact_intervention_texts (Intervention_ID, language, short_description, long_description)
       VALUES (?, ?, ?, ?)`,
      [id, language, text.shortDescription, text.longDescription],
    );
  }
}

async function insertIntervention(
  conn: Queryable,
  v: InterventionValues,
  actor: string,
): Promise<number> {
  const result = await exec(
    conn,
    `INSERT INTO Impact_interventions (short_description, long_description, created_by, created_at)
     VALUES (?, ?, ?, ?)`,
    [v.shortDescription, v.longDescription, actor, new Date()],
  );
  await writeTexts(conn, result.insertId, v.texts);
  return result.insertId;
}

async function updateIntervention(
  conn: Queryable,
  id: number,
  v: InterventionValues,
  actor: string,
) {
  await exec(
    conn,
    `UPDATE Impact_interventions SET short_description = ?, long_description = ?, updated_by = ?,
       updated_at = ?
     WHERE ID = ?`,
    [v.shortDescription, v.longDescription, actor, new Date(), id],
  );
  await writeTexts(conn, id, v.texts);
}

//endregion

/** Kept on one object so tests can stub single reads and writes */
export const impactAdminDao = {
  readTables,
  readLatestRates,
  readRateDays,
  readRateOn,
  readJobRuns,
  countDonations,
  inTransaction,
  insertEstimate,
  updateEstimate,
  deleteEstimate,
  insertGrant,
  updateGrant,
  deleteGrant,
  replaceAllotments,
  insertCharity,
  updateCharity,
  organizationExists,
  insertIntervention,
  updateIntervention,
};
