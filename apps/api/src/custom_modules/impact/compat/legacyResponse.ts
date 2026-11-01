import { DateTime } from "luxon";
import type {
  ImpactAllotment,
  ImpactCharity,
  ImpactData,
  ImpactEvaluation,
  ImpactFund,
  ImpactGrant,
  ImpactLanguage,
} from "../data";
import { IMPACT_LANGUAGES } from "../data";
import { interventionText } from "../rules";
import { convertUsd, type LegacyRates } from "./legacyRates";
import { pyFloat, type PyJson } from "./pythonJson";

/**
 * The legacy impact API's three endpoints (stiftelsen-effekt/impact-api, Django: api/views.py,
 * api/serializers.py, api/middleware.py), answered from our tables with the same JSON, for the
 * third parties that still call impact.gieffektivt.no (docs/impact-api-migration.md, phase 5).
 *
 * Kept from the legacy API on purpose, so the JSON stays identical:
 * - field names and order, `max_impact_fund_grants` for the Top Charities Fund (decision 8), and
 *   each grant's `id` is its legacy_id;
 * - the start_/end_ year and month filters compare years and months separately (2020-06 to
 *   2022-03 matches nothing);
 * - with donation_year: per requested abbreviation (in request order, repeats kept) the latest
 *   evaluation on or before the donation month; without: every matching row, in the order MySQL
 *   returned them (see `evaluationOrder`);
 * - exchange_rate_date is the requested day, not the day of the rate used.
 *
 * Deliberate differences (all documented in the migration doc):
 * - `language=dk` without a currency answers in DKK (the legacy API failed with a 500);
 * - without `language`, the answer is in English. The legacy API used the thread's last
 *   activated language, so it could answer in another request's language;
 * - malformed numbers or dates answer 400 with `errors` instead of a 500 page;
 * - no answer cache. The legacy Datastore cache keyed only on the last charity_abbreviation, so a
 *   request for several charities could get another request's cached answer;
 * - rates come from Exchange_rates, which starts in 2013: earlier days use the first rate, and
 *   currencies that left the ECB's list before 2013 are not supported.
 */

export type LegacyEndpoint = "evaluations" | "max_impact_fund_grants" | "all_grants_fund_grants";
export const LEGACY_ENDPOINTS: LegacyEndpoint[] = [
  "evaluations",
  "max_impact_fund_grants",
  "all_grants_fund_grants",
];

const ENDPOINT_FUND: Record<Exclude<LegacyEndpoint, "evaluations">, ImpactFund> = {
  max_impact_fund_grants: "TCF",
  all_grants_fund_grants: "AGF",
};

/** language → currency when none is given; dk is new (the legacy API had no default for it) */
export const DEFAULT_CURRENCY: Record<ImpactLanguage, string> = {
  no: "NOK",
  en: "USD",
  et: "EUR",
  sv: "SEK",
  dk: "DKK",
};

/** Query parameters with Django QueryDict semantics: get() is the last value */
export class QueryParams {
  constructor(private readonly params: URLSearchParams) {}
  static fromQueryString(query: string) {
    return new QueryParams(new URLSearchParams(query.replace(/^\?/, "")));
  }
  has(key: string) {
    return this.params.has(key);
  }
  get(key: string): string | undefined {
    const all = this.params.getAll(key);
    return all.length ? all[all.length - 1] : undefined;
  }
  getAll(key: string) {
    return this.params.getAll(key);
  }
}

export class BadRequest extends Error {}

export type LegacyAnswer = { status: number; body: PyJson };

/** What the request needs before an answer can be built */
export function requestedCurrency(query: QueryParams): {
  language: ImpactLanguage;
  currency: string;
} {
  const language = (query.get("language")?.toLowerCase() || "en") as ImpactLanguage;
  const lang = IMPACT_LANGUAGES.includes(language) ? language : "en";
  return {
    language: lang,
    currency: (query.get("currency") || DEFAULT_CURRENCY[lang]).toUpperCase(),
  };
}

/** The legacy QueriesMiddleware: unknown currency or language → 200 with `errors` */
export function validationErrors(query: QueryParams, currencies: Set<string>): string[] {
  const errors: string[] = [];
  const currency = query.get("currency");
  const language = query.get("language");
  if (currency && !currencies.has(currency.toUpperCase()))
    errors.push(`Currency ${currency.toUpperCase()} not supported`);
  if (language && !IMPACT_LANGUAGES.includes(language.toLowerCase() as ImpactLanguage))
    errors.push(`Language code ${language.toLowerCase()} not supported`);
  return errors;
}

/** Python int() of a query value */
function int(value: string | number, name: string): number {
  if (typeof value === "number") return value;
  const trimmed = value.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) throw new BadRequest(`Invalid ${name}: ${value}`);
  return Number(trimmed);
}

/** Python date(y, m, d) as YYYY-MM-DD */
function isoDate(year: number, month: number, day: number): string {
  const dt = DateTime.utc(year, month, day);
  if (!dt.isValid || dt.year !== year || dt.month !== month || dt.day !== day || year < 1)
    throw new BadRequest(`Invalid date ${year}-${month}-${day}`);
  return dt.toISODate()!;
}

type Lookup = {
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  donation: { year: number; month: number } | null;
  /** The day amounts are converted on, or null for each row's own start */
  conversionDate: string | null;
};

function lookup(query: QueryParams, today: string): Lookup {
  const orDefault = (key: string, fallback: number) => {
    const v = query.get(key);
    return v ? int(v, key) : fallback;
  };
  const donationYear = query.get("donation_year");
  const donation = donationYear
    ? {
        year: int(donationYear, "donation_year"),
        month: int(query.get("donation_month") ?? 1, "donation_month"),
      }
    : null;

  let conversionDate: string | null = null;
  const conversionYear = query.get("conversion_year");
  if (conversionYear) {
    conversionDate = isoDate(
      int(conversionYear, "conversion_year"),
      int(query.get("conversion_month") ?? 1, "conversion_month"),
      int(query.get("conversion_day") ?? 1, "conversion_day"),
    );
  } else if (donation) {
    conversionDate = isoDate(
      donation.year,
      donation.month,
      int(query.get("donation_day") ?? 1, "donation_day"),
    );
  }

  return {
    startYear: orDefault("start_year", 2000),
    startMonth: orDefault("start_month", 1),
    endYear: orDefault("end_year", Number(today.slice(0, 4))),
    endMonth: orDefault("end_month", 12),
    donation,
    conversionDate,
  };
}

const ym = (validFrom: string) => ({
  year: Number(validFrom.slice(0, 4)),
  month: Number(validFrom.slice(5, 7)),
});

/** The legacy `_records` filter (years and months compared separately) */
function inRange(validFrom: string, l: Lookup) {
  const { year, month } = ym(validFrom);
  return year >= l.startYear && month >= l.startMonth && year <= l.endYear && month <= l.endMonth;
}

/** start on or before the donation month, the legacy `_record_by_donation_date` */
function onOrBefore(validFrom: string, donation: { year: number; month: number }) {
  const { year, month } = ym(validFrom);
  return (year === donation.year && month <= donation.month) || year < donation.year;
}

/** The latest of `items` on or before the donation month, as `order_by('-start_year', '-start_month')[0]` */
function latestByDonation<T extends { validFrom: string }>(
  items: T[],
  donation: { year: number; month: number },
): T | null {
  let best: T | null = null;
  for (const item of items)
    if (onOrBefore(item.validFrom, donation) && (!best || item.validFrom > best.validFrom))
      best = item;
  return best;
}

/**
 * The order MySQL returned evaluations in without donation_year, measured against the live API
 * on 2026-11-01: with up to four charity abbreviations in the request it read the unique index
 * (charity, start_month, start_year); with five or more, or none, the primary key.
 */
export function evaluationOrder(requestedAbbreviations: string[]): "index" | "id" {
  const distinct = new Set(requestedAbbreviations.map((a) => a.toUpperCase()));
  return distinct.size > 0 && distinct.size <= 4 ? "index" : "id";
}

type Context = {
  data: ImpactData;
  rates: LegacyRates;
  language: ImpactLanguage;
  currency: string;
  conversionDate: string | null;
};

function convert(ctx: Context, usd: number, start: string): { value: PyJson; date: string } {
  const date = ctx.conversionDate ?? start;
  const value = convertUsd(ctx.rates, usd, ctx.currency, date);
  if (value === null) throw new Error(`No ${ctx.currency} rate for ${date}`);
  return { value: pyFloat(value), date };
}

function interventionJson(ctx: Context, interventionId: number): PyJson {
  const intervention = ctx.data.interventions.get(interventionId);
  if (!intervention) throw new Error(`Intervention ${interventionId} missing`);
  const text = interventionText(intervention, ctx.language);
  return {
    long_description: text.longDescription,
    short_description: text.shortDescription,
    id: intervention.id,
  };
}

function charityJson(ctx: Context, charityId: number): PyJson {
  const charity = ctx.data.charities.get(charityId);
  if (!charity) throw new Error(`Charity ${charityId} missing`);
  return { id: charity.id, charity_name: charity.name, abbreviation: charity.abbreviation };
}

function evaluationJson(ctx: Context, e: ImpactEvaluation): PyJson {
  const { year, month } = ym(e.validFrom);
  const converted = convert(ctx, e.centsPerOutput / 100, e.validFrom);
  return {
    id: e.id,
    intervention: interventionJson(ctx, e.interventionId),
    converted_cost_per_output: converted.value,
    exchange_rate_date: converted.date,
    currency: ctx.currency,
    language: ctx.language,
    start_year: year,
    start_month: month,
    cents_per_output: e.centsPerOutput,
    cents_per_output_upper_bound: e.centsPerOutputUpperBound,
    cents_per_output_lower_bound: e.centsPerOutputLowerBound,
    source_name: e.sourceName,
    source_url: e.sourceUrl,
    comment: e.comment,
    charity: charityJson(ctx, e.charityId),
  };
}

function allotmentJson(ctx: Context, grant: ImpactGrant, a: ImpactAllotment): PyJson {
  const sum = convert(ctx, a.sumInCents / 100, grant.validFrom);
  const cost = convert(ctx, a.sumInCents / a.numberOutputsPurchased / 100, grant.validFrom);
  return {
    id: a.id,
    intervention: interventionJson(ctx, a.interventionId),
    converted_sum: sum.value,
    currency: ctx.currency,
    converted_cost_per_output: cost.value,
    exchange_rate_date: cost.date,
    sum_in_cents: a.sumInCents,
    number_outputs_purchased: a.numberOutputsPurchased,
    number_outputs_purchased_lower_bound: a.numberOutputsPurchasedLowerBound,
    number_outputs_purchased_upper_bound: a.numberOutputsPurchasedUpperBound,
    source_name: a.sourceName,
    source_url: a.sourceUrl,
    comment: a.comment,
    charity: charityJson(ctx, a.charityId),
  };
}

function grantJson(ctx: Context, g: ImpactGrant): PyJson {
  const { year, month } = ym(g.validFrom);
  return {
    id: g.legacyId ?? g.id,
    allotment_set: g.allotments.map((a) => allotmentJson(ctx, g, a)),
    language: ctx.language,
    start_year: year,
    start_month: month,
  };
}

function charitiesByAbbreviation(data: ImpactData, abbreviation: string): ImpactCharity[] {
  return [...data.charities.values()]
    .filter((c) => c.abbreviation.toUpperCase() === abbreviation)
    .sort((a, b) => a.id - b.id);
}

/**
 * The legacy answer for one endpoint and query. `currencies` is what validation accepts,
 * `rates` must hold the requested currency. Throws BadRequest for malformed numbers or dates.
 */
export function legacyResponse(
  endpoint: LegacyEndpoint,
  query: QueryParams,
  data: ImpactData,
  rates: LegacyRates,
  currencies: Set<string>,
  today = DateTime.now().setZone("Europe/Berlin").toISODate()!,
): LegacyAnswer {
  const errors = validationErrors(query, currencies);
  if (errors.length) return { status: 200, body: { errors } };

  const { language, currency } = requestedCurrency(query);
  const l = lookup(query, today);
  const ctx: Context = { data, rates, language, currency, conversionDate: l.conversionDate };

  let records: PyJson[];
  if (endpoint === "evaluations") {
    const requested = query.getAll("charity_abbreviation").map((a) => a.toUpperCase());
    const charities = [...data.charities.values()].sort((a, b) => a.id - b.id);
    const abbreviations = requested.length ? requested : charities.map((c) => c.abbreviation);
    const evaluationsOf = (abbreviation: string) =>
      charitiesByAbbreviation(data, abbreviation.toUpperCase()).flatMap(
        (c) => data.evaluationsByCharity.get(c.id) ?? [],
      );

    let rows: ImpactEvaluation[];
    if (l.donation) {
      const donation = l.donation;
      rows = abbreviations.flatMap((a) => {
        const found = latestByDonation(evaluationsOf(a), donation);
        return found ? [found] : [];
      });
    } else {
      const wanted = new Set(abbreviations.map((a) => a.toUpperCase()));
      rows = [...data.evaluationsByCharity.values()]
        .flat()
        .filter((e) => wanted.has(data.charities.get(e.charityId)!.abbreviation.toUpperCase()))
        .filter((e) => inRange(e.validFrom, l));
      if (evaluationOrder(requested) === "index") {
        rows.sort((a, b) => {
          const x = ym(a.validFrom);
          const y = ym(b.validFrom);
          return a.charityId - b.charityId || x.month - y.month || x.year - y.year;
        });
      } else rows.sort((a, b) => a.id - b.id);
    }
    records = rows.map((e) => evaluationJson(ctx, e));
  } else {
    const grants = data.grantsByFund.get(ENDPOINT_FUND[endpoint]) ?? [];
    let rows: ImpactGrant[];
    if (l.donation) {
      const found = latestByDonation(grants, l.donation);
      rows = found ? [found] : [];
    } else {
      // MySQL read the unique (start_year, start_month) index: oldest first
      rows = grants
        .filter((g) => inRange(g.validFrom, l))
        .sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    }
    records = rows.map((g) => grantJson(ctx, g));
  }

  const body: Record<string, PyJson> = { [endpoint]: records };
  if (records.length === 0) body.warnings = [`No ${endpoint} found with those parameters`];
  return { status: 200, body };
}
