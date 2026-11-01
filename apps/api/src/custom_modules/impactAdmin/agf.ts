import { rows, type RowMeta } from "./dao";
import { dbClockColumn } from "../osloDays";

/**
 * GiveWell's All Grants Fund as reference data (Impact_fund_portfolio, Impact_givewell_grants;
 * docs/impact-givewell-numbers.md › All Grants Fund grants). Filled by scripts/agf-grants.mjs
 * through data migrations; the admin only reads them. No donor-facing figure uses them.
 */

/** program | research | scoping | ta | org_support, guessed from the title */
export type GivewellGrantType = "program" | "research" | "scoping" | "ta" | "org_support";

export type AgfPortfolioRow = RowMeta & {
  id: number;
  fund: string;
  metricsYear: number;
  organization: string;
  organizationKey: string;
  program: string | null;
  /** USD cents */
  amountCents: number;
  organizationId: number | null;
  organizationName: string | null;
  sourceName: string;
  sourceUrl: string;
};

export type GivewellGrantRow = RowMeta & {
  id: number;
  slug: string;
  title: string;
  organization: string;
  organizationKey: string;
  organizationId: number | null;
  organizationName: string | null;
  location: string | null;
  grantType: GivewellGrantType | null;
  /** YYYY-MM-01 */
  recommendedMonth: string | null;
  publishedMonth: string | null;
  /** Whole grant, USD cents; rounded as in the write-up unless amountExact */
  amountCents: number | null;
  amountExact: boolean;
  /** "AGF", "AGF, Unrestricted"; null: GiveWell hasn't said */
  funders: string | null;
  /** The All Grants Fund's part, USD cents */
  fundAmountCents: number | null;
  ceLow: number | null;
  ceHigh: number | null;
  ceBenchmark: string | null;
  outputs: number | null;
  outputUnit: string | null;
  centsPerOutput: number | null;
  deathsAverted: number | null;
  sources: string[];
  sourceUrl: string | null;
  notes: string | null;
  /** GiveWell published a cost-effectiveness multiple, outputs, cost per output or deaths averted */
  hasFigures: boolean;
};

type Meta = {
  created_at: Date | string;
  created_by: string;
  updated_at: Date | string | null;
  updated_by: string | null;
};
const iso = (value: Date | string) => new Date(value).toISOString();
const toMeta = (r: Meta): RowMeta => ({
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: r.updated_at === null ? null : iso(r.updated_at),
  updatedBy: r.updated_by,
});
const num = (v: number | string | bigint | null): number | null => (v === null ? null : Number(v));
const meta = (t: string) =>
  `${dbClockColumn(`${t}.created_at`)}, ${t}.created_by, ${t}.updated_at, ${t}.updated_by`;

async function readPortfolio(): Promise<AgfPortfolioRow[]> {
  const result = await rows<
    Meta & {
      ID: number;
      fund: string;
      metrics_year: number;
      organization: string;
      organization_key: string;
      program: string | null;
      amount_cents: number | string;
      Organization_ID: number | null;
      organization_name: string | null;
      source_name: string;
      source_url: string;
    }
  >(
    `SELECT p.ID, p.fund, p.metrics_year, p.organization, p.organization_key, p.program,
            p.amount_cents, p.Organization_ID, o.full_name AS organization_name, p.source_name,
            p.source_url, ${meta("p")}
       FROM Impact_fund_portfolio p
       LEFT JOIN Organizations o ON o.ID = p.Organization_ID
      ORDER BY p.metrics_year DESC, p.amount_cents DESC, p.ID`,
  );
  return result.map((r) => ({
    id: r.ID,
    fund: r.fund,
    metricsYear: r.metrics_year,
    organization: r.organization,
    organizationKey: r.organization_key,
    program: r.program,
    amountCents: Number(r.amount_cents),
    organizationId: r.Organization_ID,
    organizationName: r.organization_name,
    sourceName: r.source_name,
    sourceUrl: r.source_url,
    ...toMeta(r),
  }));
}

async function readGivewellGrants(): Promise<GivewellGrantRow[]> {
  const result = await rows<
    Meta & {
      ID: number;
      slug: string;
      title: string;
      organization: string;
      organization_key: string;
      Organization_ID: number | null;
      organization_name: string | null;
      location: string | null;
      grant_type: GivewellGrantType | null;
      recommended_month: string | null;
      published_month: string | null;
      amount_cents: number | string | null;
      amount_exact: number;
      funders: string | null;
      fund_amount_cents: number | string | null;
      ce_low: string | null;
      ce_high: string | null;
      ce_benchmark: string | null;
      outputs: number | null;
      output_unit: string | null;
      cents_per_output: number | null;
      deaths_averted: number | null;
      sources: string;
      source_url: string | null;
      notes: string | null;
    }
  >(
    `SELECT g.ID, g.slug, g.title, g.organization, g.organization_key, g.Organization_ID,
            o.full_name AS organization_name, g.location, g.grant_type,
            DATE_FORMAT(g.recommended_month, '%Y-%m-%d') AS recommended_month,
            DATE_FORMAT(g.published_month, '%Y-%m-%d') AS published_month,
            g.amount_cents, g.amount_exact, g.funders, g.fund_amount_cents, g.ce_low, g.ce_high,
            g.ce_benchmark, g.outputs, g.output_unit, g.cents_per_output, g.deaths_averted,
            g.sources, g.source_url, g.notes, ${meta("g")}
       FROM Impact_givewell_grants g
       LEFT JOIN Organizations o ON o.ID = g.Organization_ID
      ORDER BY g.recommended_month DESC, g.ID DESC`,
  );
  return result.map((r) => {
    const row = {
      id: r.ID,
      slug: r.slug,
      title: r.title,
      organization: r.organization,
      organizationKey: r.organization_key,
      organizationId: r.Organization_ID,
      organizationName: r.organization_name,
      location: r.location,
      grantType: r.grant_type,
      recommendedMonth: r.recommended_month,
      publishedMonth: r.published_month,
      amountCents: num(r.amount_cents),
      amountExact: !!r.amount_exact,
      funders: r.funders,
      fundAmountCents: num(r.fund_amount_cents),
      ceLow: num(r.ce_low),
      ceHigh: num(r.ce_high),
      ceBenchmark: r.ce_benchmark,
      outputs: r.outputs,
      outputUnit: r.output_unit,
      centsPerOutput: r.cents_per_output,
      deathsAverted: r.deaths_averted,
      sources: r.sources.split(",").filter(Boolean),
      sourceUrl: r.source_url,
      notes: r.notes,
      ...toMeta(r),
    };
    return { ...row, hasFigures: hasFigures(row) };
  });
}

export const hasFigures = (g: {
  ceLow: number | null;
  outputs: number | null;
  centsPerOutput: number | null;
  deathsAverted: number | null;
}) =>
  g.ceLow !== null || g.outputs !== null || g.centsPerOutput !== null || g.deathsAverted !== null;

/** Kept on one object so tests can stub the reads */
export const agfDao = { readPortfolio, readGivewellGrants };
