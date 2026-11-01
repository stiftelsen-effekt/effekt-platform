import { TRPCError } from "@trpc/server";
import { DateTime } from "luxon";
import {
  impactAdminDao as dao,
  type AdminAllotment,
  type AdminCharity,
  type AdminEvaluation,
  type AdminGrant,
  type AdminImpactTables,
  type AdminIntervention,
  type ExchangeRateCurrency,
  type ExchangeRateJobRun,
} from "../../custom_modules/impactAdmin/dao";
import { coverage, monthsApplied, type Month } from "../../custom_modules/impactAdmin/timeline";
import { OSLO_ZONE } from "../../custom_modules/osloDays";
import {
  impactByIdInput,
  impactCharityInput,
  impactEstimatesListInput,
  impactGrantsListInput,
} from "../schemas/impact";
import { adminProcedure, router } from "../trpc";

/**
 * The impact data (GiveWell cost per output) for the admin: cost estimates per charity, fund
 * grants with their split, charities and interventions, and the exchange rates the figures are
 * converted with (docs/impact-api-migration.md, phase 4). Replaces the legacy impact API's
 * Django admin.
 *
 * The rules are custom_modules/impact's: a donation uses the charity's latest estimate on or
 * before its month; money to the Top Charities Fund is split like the fund's latest grant on or
 * before its month. Months are YYYY-MM-01, cents are USD cents, and "NOK" figures use the newest
 * stored ECB rate.
 */

/** Items grouped by a key, in first-seen order */
function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const list = groups.get(key(item));
    if (list) list.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

const osloToday = () => DateTime.now().setZone(OSLO_ZONE);
const currentMonth = (): Month => osloToday().startOf("month").toISODate()!;

/** What a month of an estimate or grant covers, and whether it applies now */
type Coverage = {
  /** The last month it applies to (YYYY-MM-01), null while it is the newest */
  validTo: string | null;
  /** Months it has applied to, up to and including this month */
  monthsApplied: number;
  /** It applies to this month's donations */
  current: boolean;
};

export type ImpactEstimateRow = AdminEvaluation &
  Coverage & {
    charityName: string;
    charityAbbreviation: string;
    interventionName: string;
    /** Cost per output in NOK at the newest rate, two decimals; null without a NOK rate */
    costPerOutputNok: string | null;
  };

export type ImpactNokRate = { date: string; perUsd: number } | null;

const nokCost = (cents: number, rate: ImpactNokRate) =>
  rate ? (Math.round(cents * rate.perUsd) / 100).toFixed(2) : null;

async function nokRateToday(): Promise<ImpactNokRate> {
  return dao.readRateOn("NOK", osloToday().toISODate()!);
}

function estimateRows(tables: AdminImpactTables, rate: ImpactNokRate): ImpactEstimateRow[] {
  const charities = new Map(tables.charities.map((c) => [c.id, c]));
  const interventions = new Map(tables.interventions.map((i) => [i.id, i]));
  const month = currentMonth();
  const byCharity = groupBy(tables.evaluations, (e) => e.charityId);
  const rows: ImpactEstimateRow[] = [];
  for (const [charityId, evaluations] of byCharity) {
    const charity = charities.get(charityId);
    for (const { item, range } of coverage(evaluations)) {
      rows.push({
        ...item,
        validTo: range.to,
        monthsApplied: monthsApplied(range, month),
        current: range.from <= month && (range.to === null || range.to >= month),
        charityName: charity?.name ?? "",
        charityAbbreviation: charity?.abbreviation ?? "",
        interventionName: interventions.get(item.interventionId)?.shortDescription ?? "",
        costPerOutputNok: nokCost(item.centsPerOutput, rate),
      });
    }
  }
  return rows;
}

const overlapsYear = (row: { validFrom: string; validTo: string | null }, year: number) =>
  row.validFrom <= `${year}-12-01` && (row.validTo === null || row.validTo >= `${year}-01-01`);

export type ImpactCharityTimeline = {
  charity: AdminCharity;
  /** Oldest first */
  estimates: ImpactEstimateRow[];
  nokRate: ImpactNokRate;
  currentMonth: string;
};

export type ImpactCharityRow = AdminCharity & {
  estimates: number;
  allotments: number;
  /** The estimate that applies this month */
  currentEstimate: {
    id: number;
    validFrom: string;
    centsPerOutput: number;
    interventionName: string;
  } | null;
};

export type ImpactInterventionRow = AdminIntervention & { estimates: number; allotments: number };

export type ImpactGrantRow = Omit<AdminGrant, "allotments"> &
  Coverage & {
    allotments: number;
    totalCents: number;
    /** Distinct charity names, in allotment order */
    charities: string[];
  };

export type ImpactAllotmentRow = AdminAllotment & {
  charityName: string;
  /** The charity's organization (Organizations.ID), if linked */
  organizationId: number | null;
  charityAbbreviation: string;
  interventionName: string;
  /** Share of the grant's total, 0..1 (custom_modules/impact grantSplit) */
  share: number;
  /** sumInCents / numberOutputsPurchased */
  centsPerOutput: number;
  costPerOutputNok: string | null;
};

export type ImpactGrantDetail = Omit<AdminGrant, "allotments"> &
  Coverage & {
    allotments: ImpactAllotmentRow[];
    totalCents: number;
    nokRate: ImpactNokRate;
    /** The grants of the same fund just before and after, for stepping through */
    previousId: number | null;
    nextId: number | null;
  };

function grantRows(tables: AdminImpactTables): (ImpactGrantRow & { grant: AdminGrant })[] {
  const charities = new Map(tables.charities.map((c) => [c.id, c]));
  const month = currentMonth();
  return [...groupBy(tables.grants, (g) => g.fund).values()].flatMap((grants) =>
    coverage(grants).map(({ item, range }) => {
      const { allotments, ...grant } = item;
      return {
        ...grant,
        grant: item,
        validTo: range.to,
        monthsApplied: monthsApplied(range, month),
        current: range.from <= month && (range.to === null || range.to >= month),
        allotments: allotments.length,
        totalCents: allotments.reduce((sum, a) => sum + a.sumInCents, 0),
        charities: [...new Set(allotments.map((a) => charities.get(a.charityId)?.name ?? ""))],
      };
    }),
  );
}

export type ImpactRatesGap = { from: string; to: string; days: number };

export type ImpactExchangeRates = {
  currencies: ExchangeRateCurrency[];
  /** Newest first */
  jobRuns: ExchangeRateJobRun[];
  /** The newest day with rates, across currencies */
  latestDate: string | null;
  /** Calendar days from latestDate to today (Oslo) */
  daysSinceLatest: number | null;
  /**
   * Stretches of more than four days without rates in the last 365 days (the ECB publishes on
   * business days, so weekends and Easter leave up to four), newest first
   */
  gaps: ImpactRatesGap[];
  today: string;
};

const GAP_DAYS = 4;

/** Stretches between consecutive days longer than GAP_DAYS, as the missing days */
export function rateGaps(days: string[]): ImpactRatesGap[] {
  const gaps: ImpactRatesGap[] = [];
  for (let i = 1; i < days.length; i++) {
    const a = DateTime.fromISO(days[i - 1]!);
    const b = DateTime.fromISO(days[i]!);
    const missing = b.diff(a, "days").days - 1;
    if (missing > GAP_DAYS)
      gaps.push({
        from: a.plus({ days: 1 }).toISODate()!,
        to: b.minus({ days: 1 }).toISODate()!,
        days: missing,
      });
  }
  return gaps.reverse();
}

const notFound = (what: string, id: number) =>
  new TRPCError({ code: "NOT_FOUND", message: `${what} ${id} not found` });

export const impactRouter = router({
  estimates: router({
    /** Every cost estimate with the months it covers, newest first */
    list: adminProcedure
      .input(impactEstimatesListInput)
      .query(async ({ input }): Promise<ImpactEstimateRow[]> => {
        const [tables, rate] = await Promise.all([dao.readTables(), nokRateToday()]);
        return estimateRows(tables, rate)
          .filter((r) => !input.charityIds?.length || input.charityIds.includes(r.charityId))
          .filter(
            (r) =>
              !input.interventionIds?.length || input.interventionIds.includes(r.interventionId),
          )
          .filter((r) => input.year === undefined || overlapsYear(r, input.year))
          .sort(
            (a, b) =>
              b.validFrom.localeCompare(a.validFrom) || a.charityName.localeCompare(b.charityName),
          );
      }),

    /** One charity's estimates through time: which months each one covers */
    charity: adminProcedure
      .input(impactCharityInput)
      .query(async ({ input }): Promise<ImpactCharityTimeline> => {
        const [tables, rate] = await Promise.all([dao.readTables(), nokRateToday()]);
        const charity = tables.charities.find((c) => c.id === input.charityId);
        if (!charity) throw notFound("Charity", input.charityId);
        return {
          charity,
          estimates: estimateRows(tables, rate)
            .filter((r) => r.charityId === charity.id)
            .sort((a, b) => a.validFrom.localeCompare(b.validFrom)),
          nokRate: rate,
          currentMonth: currentMonth(),
        };
      }),
  }),

  grants: router({
    /** Fund grants (Top Charities Fund, All Grants Fund) with the months each split covers, newest first */
    list: adminProcedure
      .input(impactGrantsListInput)
      .query(async ({ input }): Promise<ImpactGrantRow[]> => {
        const tables = await dao.readTables();
        return grantRows(tables)
          .filter((g) => !input.fund || g.fund === input.fund)
          .map(({ grant: _grant, ...row }) => row)
          .sort((a, b) => b.validFrom.localeCompare(a.validFrom) || a.fund.localeCompare(b.fund));
      }),

    /** One grant with its allotments, each one's share of the grant and cost per output */
    get: adminProcedure
      .input(impactByIdInput)
      .query(async ({ input }): Promise<ImpactGrantDetail> => {
        const [tables, rate] = await Promise.all([dao.readTables(), nokRateToday()]);
        const rows = grantRows(tables);
        const row = rows.find((g) => g.id === input.id);
        if (!row) throw notFound("Grant", input.id);
        const charities = new Map(tables.charities.map((c) => [c.id, c]));
        const interventions = new Map(tables.interventions.map((i) => [i.id, i]));
        const sameFund = rows.filter((g) => g.fund === row.fund);
        const index = sameFund.indexOf(row);
        const { grant, ...rest } = row;
        return {
          ...rest,
          allotments: grant.allotments.map((a) => {
            const centsPerOutput = a.sumInCents / a.numberOutputsPurchased;
            return {
              ...a,
              charityName: charities.get(a.charityId)?.name ?? "",
              organizationId: charities.get(a.charityId)?.organizationId ?? null,
              charityAbbreviation: charities.get(a.charityId)?.abbreviation ?? "",
              interventionName: interventions.get(a.interventionId)?.shortDescription ?? "",
              share: row.totalCents > 0 ? a.sumInCents / row.totalCents : 0,
              centsPerOutput,
              costPerOutputNok: nokCost(centsPerOutput, rate),
            };
          }),
          nokRate: rate,
          previousId: sameFund[index - 1]?.id ?? null,
          nextId: sameFund[index + 1]?.id ?? null,
        };
      }),
  }),

  charities: router({
    /** Every charity with its link to our organizations and the estimate that applies now */
    list: adminProcedure.query(async (): Promise<ImpactCharityRow[]> => {
      const tables = await dao.readTables();
      const month = currentMonth();
      const interventions = new Map(tables.interventions.map((i) => [i.id, i]));
      return tables.charities.map((charity) => {
        const evaluations = tables.evaluations.filter((e) => e.charityId === charity.id);
        const current = evaluations
          .filter((e) => e.validFrom <= month)
          .reduce<AdminEvaluation | null>(
            (latest, e) => (!latest || e.validFrom > latest.validFrom ? e : latest),
            null,
          );
        return {
          ...charity,
          estimates: evaluations.length,
          allotments: tables.grants
            .flatMap((g) => g.allotments)
            .filter((a) => a.charityId === charity.id).length,
          currentEstimate: current && {
            id: current.id,
            validFrom: current.validFrom,
            centsPerOutput: current.centsPerOutput,
            interventionName: interventions.get(current.interventionId)?.shortDescription ?? "",
          },
        };
      });
    }),
  }),

  interventions: router({
    /** Every intervention with its texts per language and how often it is used */
    list: adminProcedure.query(async (): Promise<ImpactInterventionRow[]> => {
      const tables = await dao.readTables();
      return tables.interventions.map((intervention) => ({
        ...intervention,
        estimates: tables.evaluations.filter((e) => e.interventionId === intervention.id).length,
        allotments: tables.grants
          .flatMap((g) => g.allotments)
          .filter((a) => a.interventionId === intervention.id).length,
      }));
    }),
  }),

  /**
   * The ECB rates the figures are converted with (read-only; the daily job fills them): the
   * newest rate per currency, the job's last runs (Import_logs) and gaps in the last year
   */
  exchangeRates: adminProcedure.query(async (): Promise<ImpactExchangeRates> => {
    const today = osloToday();
    const [currencies, jobRuns, days] = await Promise.all([
      dao.readLatestRates(),
      dao.readJobRuns(),
      dao.readRateDays(today.minus({ days: 365 }).toISODate()!),
    ]);
    const latestDate = currencies.reduce<string | null>(
      (latest, c) => (latest === null || c.latestDate > latest ? c.latestDate : latest),
      null,
    );
    return {
      currencies,
      jobRuns,
      latestDate,
      daysSinceLatest:
        latestDate === null
          ? null
          : Math.round(
              today.startOf("day").diff(DateTime.fromISO(latestDate, { zone: OSLO_ZONE }), "days")
                .days,
            ),
      gaps: rateGaps(days),
      today: today.toISODate()!,
    };
  }),
});
