import { DAO } from "../DAO";

/**
 * The impact tables (Impact_*, docs/impact-api-migration.md), loaded whole: they hold ~200 rows
 * and change about once a year, so every lookup works on this in-memory copy. Cached for 15
 * minutes; clearImpactDataCache() drops the copy after an edit.
 */

export type ImpactLanguage = "en" | "no" | "sv" | "et" | "dk";
export const IMPACT_LANGUAGES: ImpactLanguage[] = ["en", "no", "sv", "et", "dk"];

/** GiveWell funds with grants: Top Charities Fund ("Max Impact Fund" in the old API), All Grants Fund */
export type ImpactFund = "TCF" | "AGF";

export type ImpactCharity = {
  id: number;
  name: string;
  abbreviation: string;
  organizationId: number | null;
  /** The linked organization's abbreviation (Organizations.abbriv), if linked */
  organizationAbbreviation: string | null;
};

export type ImpactIntervention = {
  id: number;
  /** English */
  shortDescription: string;
  longDescription: string;
  /** Other languages; a missing language uses the English texts */
  texts: Partial<Record<ImpactLanguage, { shortDescription: string; longDescription: string }>>;
};

export type ImpactEvaluation = {
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

export type ImpactAllotment = {
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

export type ImpactGrant = {
  id: number;
  fund: ImpactFund;
  /** YYYY-MM-01 */
  validFrom: string;
  /** The grant's ID in the old impact API */
  legacyId: number | null;
  allotments: ImpactAllotment[];
};

export type ImpactData = {
  charities: Map<number, ImpactCharity>;
  interventions: Map<number, ImpactIntervention>;
  /** Per charity, oldest first */
  evaluationsByCharity: Map<number, ImpactEvaluation[]>;
  /** Per fund, oldest first */
  grantsByFund: Map<ImpactFund, ImpactGrant[]>;
  charityByOrganization: Map<number, ImpactCharity>;
  /**
   * Organizations whose donations are split by a fund's grants. Only the Top Charities Fund:
   * AGF keeps "no estimate" (decision 3), as it has no evaluation.
   */
  fundByOrganization: Map<number, ImpactFund>;
  /** Organizations.abbriv by ID for every organization (results page, receipts) */
  organizationAbbreviations: Map<number, string>;
  /** Organizations.full_name by ID */
  organizationNames: Map<number, string>;
};

/** Organizations.abbriv of the organization donors give to for each fund split by its grants */
export const FUND_ORGANIZATION_ABBREVIATIONS: Partial<Record<ImpactFund, string>> = { TCF: "TCF" };

export type ImpactRows = {
  charities: {
    ID: number;
    name: string;
    abbreviation: string;
    Organization_ID: number | null;
  }[];
  interventions: { ID: number; short_description: string; long_description: string }[];
  texts: {
    Intervention_ID: number;
    language: string;
    short_description: string;
    long_description: string;
  }[];
  evaluations: {
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
  }[];
  grants: { ID: number; fund: string; valid_from: string; legacy_id: number | null }[];
  allotments: {
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
  }[];
  organizations: { ID: number; abbriv: string; full_name: string }[];
};

/** Builds the lookup structure from table rows (pure; the loader and tests use it) */
export function buildImpactData(rows: ImpactRows): ImpactData {
  const organizationAbbreviations = new Map(rows.organizations.map((o) => [o.ID, o.abbriv]));
  const organizationNames = new Map(rows.organizations.map((o) => [o.ID, o.full_name]));

  const charities = new Map<number, ImpactCharity>();
  const charityByOrganization = new Map<number, ImpactCharity>();
  for (const c of rows.charities) {
    const charity: ImpactCharity = {
      id: c.ID,
      name: c.name,
      abbreviation: c.abbreviation,
      organizationId: c.Organization_ID,
      organizationAbbreviation:
        c.Organization_ID === null
          ? null
          : (organizationAbbreviations.get(c.Organization_ID) ?? null),
    };
    charities.set(c.ID, charity);
    if (c.Organization_ID !== null) charityByOrganization.set(c.Organization_ID, charity);
  }

  const interventions = new Map<number, ImpactIntervention>();
  for (const i of rows.interventions) {
    interventions.set(i.ID, {
      id: i.ID,
      shortDescription: i.short_description,
      longDescription: i.long_description,
      texts: {},
    });
  }
  for (const t of rows.texts) {
    const intervention = interventions.get(t.Intervention_ID);
    if (!intervention || !IMPACT_LANGUAGES.includes(t.language as ImpactLanguage)) continue;
    intervention.texts[t.language as ImpactLanguage] = {
      shortDescription: t.short_description,
      longDescription: t.long_description,
    };
  }

  const evaluationsByCharity = new Map<number, ImpactEvaluation[]>();
  for (const e of rows.evaluations) {
    const list = evaluationsByCharity.get(e.Charity_ID) ?? [];
    list.push({
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
    });
    evaluationsByCharity.set(e.Charity_ID, list);
  }
  for (const list of evaluationsByCharity.values())
    list.sort((a, b) => a.validFrom.localeCompare(b.validFrom));

  const grantsById = new Map<number, ImpactGrant>();
  const grantsByFund = new Map<ImpactFund, ImpactGrant[]>();
  for (const g of rows.grants) {
    const grant: ImpactGrant = {
      id: g.ID,
      fund: g.fund as ImpactFund,
      validFrom: g.valid_from,
      legacyId: g.legacy_id,
      allotments: [],
    };
    grantsById.set(g.ID, grant);
    const list = grantsByFund.get(grant.fund) ?? [];
    list.push(grant);
    grantsByFund.set(grant.fund, list);
  }
  for (const a of [...rows.allotments].sort((x, y) => x.ID - y.ID)) {
    grantsById.get(a.Grant_ID)?.allotments.push({
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
  }
  for (const list of grantsByFund.values())
    list.sort((a, b) => a.validFrom.localeCompare(b.validFrom));

  const fundByOrganization = new Map<number, ImpactFund>();
  for (const [fund, abbriv] of Object.entries(FUND_ORGANIZATION_ABBREVIATIONS)) {
    for (const o of rows.organizations)
      if (o.abbriv.toLowerCase() === abbriv!.toLowerCase())
        fundByOrganization.set(o.ID, fund as ImpactFund);
  }

  return {
    charities,
    interventions,
    evaluationsByCharity,
    grantsByFund,
    charityByOrganization,
    fundByOrganization,
    organizationAbbreviations,
    organizationNames,
  };
}

const date = (column: string) => `DATE_FORMAT(${column}, '%Y-%m-%d') AS ${column}`;

/** Reads every impact table (seven small queries, run in parallel) */
export async function readImpactRows(): Promise<ImpactRows> {
  const q = async <T>(sql: string) => (await DAO.query<T[]>(sql))[0] as T[];
  const [charities, interventions, texts, evaluations, grants, allotments, organizations] =
    await Promise.all([
      q<ImpactRows["charities"][number]>(
        "SELECT ID, name, abbreviation, Organization_ID FROM Impact_charities",
      ),
      q<ImpactRows["interventions"][number]>(
        "SELECT ID, short_description, long_description FROM Impact_interventions",
      ),
      q<ImpactRows["texts"][number]>(
        "SELECT Intervention_ID, language, short_description, long_description FROM Impact_intervention_texts",
      ),
      q<ImpactRows["evaluations"][number]>(
        `SELECT ID, Charity_ID, Intervention_ID, ${date("valid_from")}, cents_per_output,
                cents_per_output_lower_bound, cents_per_output_upper_bound, source_name, source_url, comment
           FROM Impact_evaluations`,
      ),
      q<ImpactRows["grants"][number]>(
        `SELECT ID, fund, ${date("valid_from")}, legacy_id FROM Impact_grants`,
      ),
      q<ImpactRows["allotments"][number]>(
        `SELECT ID, Grant_ID, Charity_ID, Intervention_ID, sum_in_cents, number_outputs_purchased,
                number_outputs_purchased_lower_bound, number_outputs_purchased_upper_bound,
                source_name, source_url, comment
           FROM Impact_grant_allotments`,
      ),
      q<ImpactRows["organizations"][number]>("SELECT ID, abbriv, full_name FROM Organizations"),
    ]);
  return { charities, interventions, texts, evaluations, grants, allotments, organizations };
}

const CACHE_MS = 15 * 60 * 1000;
let cached: { at: number; data: Promise<ImpactData> } | null = null;

/** The impact data, cached for 15 minutes */
export function getImpactData(now = Date.now()): Promise<ImpactData> {
  if (!cached || now - cached.at > CACHE_MS) {
    const data = readImpactRows().then(buildImpactData);
    cached = { at: now, data };
    // A failed read is not cached
    data.catch(() => {
      if (cached?.data === data) cached = null;
    });
  }
  return cached.data;
}

/** Drops the cached copy (after an edit to the impact tables) */
export function clearImpactDataCache() {
  cached = null;
}
