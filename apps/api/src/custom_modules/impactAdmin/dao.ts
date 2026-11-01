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

/** Kept on one object so tests can stub single reads */
export const impactAdminDao = {
  readTables,
  readLatestRates,
  readRateDays,
  readRateOn,
  readJobRuns,
  countDonations,
};
