import { TRPCError } from "@trpc/server";
import { DateTime } from "luxon";
import { z } from "zod";
import { clearImpactCostsMemo } from "../../custom_modules/impact/costs";
import { clearImpactDataCache } from "../../custom_modules/impact/data";
import { clearMonthlyOutputsMemo } from "../../custom_modules/monthlyOutputs";
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
  type Queryable,
} from "../../custom_modules/impactAdmin/dao";
import {
  addMonths,
  changedMonths,
  coverage,
  effectiveAt,
  monthsApplied,
  type Month,
  type MonthRange,
} from "../../custom_modules/impactAdmin/timeline";
import { OSLO_ZONE } from "../../custom_modules/osloDays";
import { adminIdentity } from "../identity";
import {
  impactByIdInput,
  impactCharityCreateInput,
  impactCharityInput,
  impactCharityUpdateInput,
  impactEstimateCreateInput,
  impactEstimatePreviewInput,
  impactEstimatesListInput,
  impactEstimateUpdateInput,
  impactGrantCreateInput,
  impactGrantsListInput,
  impactGrantUpdateInput,
  impactInterventionCreateInput,
  impactInterventionUpdateInput,
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

/**
 * After a write: drop the impact module's cached tables and the answers built from them (the
 * widget's costs, the results page), so this instance shows the change at once. Other API
 * instances pick it up within 15 minutes (their cache's lifetime).
 */
export function afterImpactEdit() {
  clearImpactDataCache();
  clearImpactCostsMemo();
  clearMonthlyOutputsMemo();
}

/** An input error on one field, shown next to it in the admin (error.data.fieldErrors) */
const fieldError = (path: string, message: string) =>
  new TRPCError({
    code: "BAD_REQUEST",
    message,
    // A real ZodError, so the error formatter adds data.fieldErrors as for invalid input
    cause: z
      .unknown()
      .superRefine((_, ctx) => ctx.addIssue({ code: "custom", path: [path], message }))
      .safeParse(null).error,
  });

const monthName = (month: string) => DateTime.fromISO(month).toFormat("LLL yyyy");

function assertCharity(tables: AdminImpactTables, id: number, path = "charityId") {
  const charity = tables.charities.find((c) => c.id === id);
  if (!charity) throw fieldError(path, `Charity ${id} doesn't exist`);
  return charity;
}

function assertIntervention(tables: AdminImpactTables, id: number, path = "interventionId") {
  if (!tables.interventions.some((i) => i.id === id))
    throw fieldError(path, `Intervention ${id} doesn't exist`);
}

/** One estimate per charity and month (Impact_evaluations_charity_valid_from_key) */
function assertFreeMonth(
  tables: AdminImpactTables,
  charity: AdminCharity,
  validFrom: string,
  exceptId?: number,
) {
  const clash = tables.evaluations.find(
    (e) => e.charityId === charity.id && e.validFrom === validFrom && e.id !== exceptId,
  );
  if (clash)
    throw fieldError(
      "validFrom",
      `${charity.abbreviation} already has an estimate from ${monthName(validFrom)}; edit that one instead`,
    );
}

function assertFreeGrantMonth(
  tables: AdminImpactTables,
  fund: string,
  validFrom: string,
  exceptId?: number,
) {
  if (tables.grants.some((g) => g.fund === fund && g.validFrom === validFrom && g.id !== exceptId))
    throw fieldError(
      "validFrom",
      `The ${fund} already has a grant from ${monthName(validFrom)}; edit that one instead`,
    );
}

function assertAllotments(
  tables: AdminImpactTables,
  allotments: { id?: number; charityId: number; interventionId: number }[],
  grant: AdminGrant | null,
) {
  allotments.forEach((a, i) => {
    assertCharity(tables, a.charityId, `allotments.${i}.charityId`);
    assertIntervention(tables, a.interventionId, `allotments.${i}.interventionId`);
    if (a.id && !grant?.allotments.some((existing) => existing.id === a.id))
      throw fieldError(`allotments.${i}`, `Allotment ${a.id} isn't part of this grant`);
  });
}

/** What a month shows for an estimate: its cost per output and what that buys */
const estimateKey = (e: { centsPerOutput: number; interventionId: number } | null) =>
  e ? `${e.centsPerOutput}|${e.interventionId}` : "none";

/** Instants (Oslo months) for counting donations in the changed months */
const monthRangeInstants = (ranges: MonthRange[]) =>
  ranges.map((r) => ({
    from: DateTime.fromISO(r.from, { zone: OSLO_ZONE }).toJSDate(),
    before:
      r.to === null ? null : DateTime.fromISO(addMonths(r.to, 1), { zone: OSLO_ZONE }).toJSDate(),
  }));

type PreviewFigure = {
  centsPerOutput: number;
  interventionName: string;
  costPerOutputNok: string | null;
  validFrom: string;
} | null;

export type ImpactEstimatePreview = {
  charityId: number;
  /** The figure the first changed month shows today, and after saving */
  before: PreviewFigure;
  after: PreviewFigure;
  /** Months whose figure changes; `to` null = until a newer estimate is added */
  changedMonths: MonthRange[];
  /** How many of those are this month or earlier (months donors may have given in) */
  monthsChanged: number;
  /** Donations and donors in the changed months with a share to the charity's organization */
  donations: number;
  donors: number;
  /** False when the charity has no organization: no donation uses its estimates */
  organizationLinked: boolean;
  nokRate: ImpactNokRate;
};

const notFound = (what: string, id: number) =>
  new TRPCError({ code: "NOT_FOUND", message: `${what} ${id} not found` });

/** One charity per organization (Impact_charities_Organization_ID_key), and it must exist */
async function assertOrganization(
  conn: Queryable,
  tables: AdminImpactTables,
  organizationId: number | null,
  charityId?: number,
) {
  if (organizationId === null) return;
  const other = tables.charities.find(
    (c) => c.organizationId === organizationId && c.id !== charityId,
  );
  if (other)
    throw fieldError("organizationId", `That organization is already linked to ${other.name}`);
  if (!(await dao.organizationExists(conn, organizationId)))
    throw fieldError("organizationId", `Organization ${organizationId} doesn't exist`);
}

/** Short descriptions are unique (Impact_interventions_short_description_key) */
function assertFreeInterventionName(tables: AdminImpactTables, name: string, exceptId?: number) {
  if (
    tables.interventions.some(
      (i) => i.shortDescription.toLowerCase() === name.toLowerCase() && i.id !== exceptId,
    )
  )
    throw fieldError("shortDescription", `An intervention called ${name} already exists`);
}

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

    /**
     * What saving an estimate (new, edited or deleted) would change on Min Side, in receipts and
     * on the results page: the months whose figure changes and the donations in them
     */
    preview: adminProcedure
      .input(impactEstimatePreviewInput)
      .query(async ({ input }): Promise<ImpactEstimatePreview> => {
        const [tables, rate] = await Promise.all([dao.readTables(), nokRateToday()]);
        const existing =
          input.id === undefined ? null : tables.evaluations.find((e) => e.id === input.id);
        if (existing === undefined) throw notFound("Estimate", input.id!);
        const charity = assertCharity(
          tables,
          existing?.charityId ?? ("charityId" in input ? input.charityId : 0),
        );
        const interventions = new Map(tables.interventions.map((i) => [i.id, i]));
        const before = tables.evaluations.filter((e) => e.charityId === charity.id);
        const others = before.filter((e) => e.id !== existing?.id);
        const after =
          "remove" in input
            ? others
            : [
                ...others,
                {
                  id: existing?.id ?? 0,
                  validFrom: input.validFrom,
                  centsPerOutput: input.centsPerOutput,
                  interventionId: input.interventionId,
                },
              ];
        const month = currentMonth();
        const ranges = changedMonths<{
          validFrom: string;
          centsPerOutput: number;
          interventionId: number;
        }>(before, after, estimateKey, month);
        const first =
          ranges[0]?.from ?? ("remove" in input ? existing!.validFrom : input.validFrom);
        const figure = (
          e: { validFrom: string; centsPerOutput: number; interventionId: number } | null,
        ): PreviewFigure =>
          e && {
            validFrom: e.validFrom,
            centsPerOutput: e.centsPerOutput,
            interventionName: interventions.get(e.interventionId)?.shortDescription ?? "",
            costPerOutputNok: nokCost(e.centsPerOutput, rate),
          };
        const counts =
          charity.organizationId === null
            ? { donations: 0, donors: 0 }
            : await dao.countDonations(
                charity.organizationId,
                monthRangeInstants(ranges.filter((r) => r.from <= month)),
              );
        return {
          charityId: charity.id,
          before: figure(effectiveAt(before, first)),
          after: figure(effectiveAt(after, first)),
          changedMonths: ranges,
          monthsChanged: ranges
            .filter((r) => r.from <= month)
            .reduce((sum, r) => sum + monthsApplied(r, month), 0),
          ...counts,
          organizationLinked: charity.organizationId !== null,
          nokRate: rate,
        };
      }),

    /** A new estimate for a charity (a new GiveWell number). Returns its id. */
    create: adminProcedure
      .input(impactEstimateCreateInput)
      .mutation(async ({ input, ctx }): Promise<{ id: number }> => {
        const { charityId, ...values } = input;
        const id = await dao.inTransaction(async (conn) => {
          const tables = await dao.readTables(conn);
          const charity = assertCharity(tables, charityId);
          assertIntervention(tables, values.interventionId);
          assertFreeMonth(tables, charity, values.validFrom);
          return dao.insertEstimate(conn, charityId, values, adminIdentity(ctx.auth));
        });
        afterImpactEdit();
        return { id };
      }),

    /** Corrects an estimate: month, intervention, cost, range, source. Not its charity. */
    update: adminProcedure
      .input(impactEstimateUpdateInput)
      .mutation(async ({ input, ctx }): Promise<{ id: number }> => {
        const { id, ...values } = input;
        await dao.inTransaction(async (conn) => {
          const tables = await dao.readTables(conn);
          const existing = tables.evaluations.find((e) => e.id === id);
          if (!existing) throw notFound("Estimate", id);
          const charity = assertCharity(tables, existing.charityId);
          assertIntervention(tables, values.interventionId);
          assertFreeMonth(tables, charity, values.validFrom, id);
          await dao.updateEstimate(conn, id, values, adminIdentity(ctx.auth));
        });
        afterImpactEdit();
        return { id };
      }),

    /** Removes an estimate: its months fall back to the one before (or to no estimate) */
    delete: adminProcedure
      .input(impactByIdInput)
      .mutation(async ({ input }): Promise<{ id: number }> => {
        await dao.inTransaction(async (conn) => {
          const tables = await dao.readTables(conn);
          if (!tables.evaluations.some((e) => e.id === input.id))
            throw notFound("Estimate", input.id);
          await dao.deleteEstimate(conn, input.id);
        });
        afterImpactEdit();
        return { id: input.id };
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

    /**
     * A new fund grant with its allotments, in one transaction. It gets the fund's next
     * legacy_id, the ID the compatibility REST shows. Returns its id.
     */
    create: adminProcedure
      .input(impactGrantCreateInput)
      .mutation(async ({ input, ctx }): Promise<{ id: number }> => {
        const actor = adminIdentity(ctx.auth);
        const id = await dao.inTransaction(async (conn) => {
          const tables = await dao.readTables(conn);
          assertFreeGrantMonth(tables, input.fund, input.validFrom);
          assertAllotments(tables, input.allotments, null);
          const grantId = await dao.insertGrant(conn, input, actor);
          await dao.replaceAllotments(conn, grantId, input.allotments, actor);
          return grantId;
        });
        afterImpactEdit();
        return { id };
      }),

    /**
     * A grant's month and allotments, in one transaction: allotments with an id keep it, new
     * ones are added, the rest removed. The fund and the grant's IDs don't change.
     */
    update: adminProcedure
      .input(impactGrantUpdateInput)
      .mutation(async ({ input, ctx }): Promise<{ id: number }> => {
        const actor = adminIdentity(ctx.auth);
        await dao.inTransaction(async (conn) => {
          const tables = await dao.readTables(conn);
          const grant = tables.grants.find((g) => g.id === input.id);
          if (!grant) throw notFound("Grant", input.id);
          assertFreeGrantMonth(tables, grant.fund, input.validFrom, grant.id);
          assertAllotments(tables, input.allotments, grant);
          await dao.updateGrant(conn, grant.id, input.validFrom, actor);
          await dao.replaceAllotments(conn, grant.id, input.allotments, actor);
        });
        afterImpactEdit();
        return { id: input.id };
      }),

    /** Removes a grant and its allotments: its months use the fund's grant before it */
    delete: adminProcedure
      .input(impactByIdInput)
      .mutation(async ({ input }): Promise<{ id: number }> => {
        await dao.inTransaction(async (conn) => {
          const tables = await dao.readTables(conn);
          if (!tables.grants.some((g) => g.id === input.id)) throw notFound("Grant", input.id);
          await dao.deleteGrant(conn, input.id);
        });
        afterImpactEdit();
        return { id: input.id };
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

    /** A new charity. Its abbreviation is fixed from here on. Returns its id. */
    create: adminProcedure
      .input(impactCharityCreateInput)
      .mutation(async ({ input, ctx }): Promise<{ id: number }> => {
        const id = await dao.inTransaction(async (conn) => {
          const tables = await dao.readTables(conn);
          if (tables.charities.some((c) => c.abbreviation === input.abbreviation))
            throw fieldError("abbreviation", `${input.abbreviation} is already taken`);
          await assertOrganization(conn, tables, input.organizationId);
          return dao.insertCharity(conn, input, adminIdentity(ctx.auth));
        });
        afterImpactEdit();
        return { id };
      }),

    /** Name and the organization whose donations use the charity's estimates */
    update: adminProcedure
      .input(impactCharityUpdateInput)
      .mutation(async ({ input, ctx }): Promise<{ id: number }> => {
        await dao.inTransaction(async (conn) => {
          const tables = await dao.readTables(conn);
          if (!tables.charities.some((c) => c.id === input.id)) throw notFound("Charity", input.id);
          await assertOrganization(conn, tables, input.organizationId, input.id);
          await dao.updateCharity(conn, input.id, input, adminIdentity(ctx.auth));
        });
        afterImpactEdit();
        return { id: input.id };
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

    /** A new intervention with its texts. Returns its id. */
    create: adminProcedure
      .input(impactInterventionCreateInput)
      .mutation(async ({ input, ctx }): Promise<{ id: number }> => {
        const id = await dao.inTransaction(async (conn) => {
          const tables = await dao.readTables(conn);
          assertFreeInterventionName(tables, input.shortDescription);
          return dao.insertIntervention(conn, input, adminIdentity(ctx.auth));
        });
        afterImpactEdit();
        return { id };
      }),

    /** The English texts and the other languages' (a language left out shows the English) */
    update: adminProcedure
      .input(impactInterventionUpdateInput)
      .mutation(async ({ input, ctx }): Promise<{ id: number }> => {
        const { id, ...values } = input;
        await dao.inTransaction(async (conn) => {
          const tables = await dao.readTables(conn);
          if (!tables.interventions.some((i) => i.id === id)) throw notFound("Intervention", id);
          assertFreeInterventionName(tables, values.shortDescription, id);
          await dao.updateIntervention(conn, id, values, adminIdentity(ctx.auth));
        });
        afterImpactEdit();
        return { id };
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
