import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRightIcon } from "lucide-react";
import { useMemo } from "react";
import { createColumns, DataTable, TableSummary } from "@/components/data-table";
import { ErrorState } from "@/components/domain/error-state";
import { DateTime, Num } from "@/components/domain/format";
import {
  BooleanFilter,
  ChoiceFilter,
  FilterBar,
  ListEmpty,
  useListState,
} from "@/components/filters";
import { defineList, param } from "@/components/filters/list-state";
import { ListPage } from "@/components/templates";
import { Badge } from "@/components/ui/badge";
import {
  formatCeMultiple,
  givewellGrantTypes,
  grantTypeLabels,
  type GivewellGrant,
} from "@/features/impact/model";
import { UsdCents } from "@/features/impact/ui";
import { formatNumber } from "@/lib/format";
import { usePageQuery } from "@/lib/query";
import { useTRPC } from "@/lib/trpc";

const fundedBy = ["agf", "unknown"] as const;
const fundedByLabels: Record<(typeof fundedBy)[number], string> = {
  agf: "All Grants Fund (named by GiveWell)",
  unknown: "Not published",
};

const agfList = defineList({
  id: "impact-agf-grants",
  filters: {
    q: param.text,
    year: param.text,
    funder: param.oneOf(fundedBy),
    figures: param.boolean,
    type: param.oneOf(givewellGrantTypes),
  },
  sortable: ["recommendedMonth"],
  defaultSort: { id: "recommendedMonth", desc: true },
});

export const Route = createFileRoute("/_app/impact/agf")({
  validateSearch: agfList.validateSearch,
  component: AgfGrantsPage,
});

const col = createColumns<GivewellGrant>();
const columns = col.columns([
  col.accessor("recommendedMonth", {
    header: "Month",
    meta: { placeholder: "Jun 2025" },
    cell: ({ getValue }) => <DateTime value={getValue()} format="month" />,
  }),
  col.accessor("title", {
    header: "Grant",
    enableSorting: false,
    meta: { cellClassName: "max-w-md", placeholder: "ALIMA — Malnutrition Treatment in Chad" },
    cell: ({ row: { original: g } }) => (
      <span className="grid">
        {g.sourceUrl ? (
          <a
            href={g.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="truncate rounded-xs text-accent hover:underline focus-ring"
            title={g.title}
            onClick={(event) => event.stopPropagation()}
          >
            {g.title} <ArrowUpRightIcon className="inline size-3" aria-hidden />
          </a>
        ) : (
          <span className="truncate" title={g.title}>
            {g.title}
          </span>
        )}
        <span className="truncate text-xs text-muted-foreground" title={g.notes ?? undefined}>
          {[g.organizationName ? `${g.organizationKey} (ours)` : g.organizationKey, g.location]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
    ),
  }),
  col.accessor("funders", {
    header: "Funder",
    enableSorting: false,
    meta: { placeholder: "AGF" },
    cell: ({ getValue }) =>
      getValue() ? (
        <Badge title="GiveWell names the fund(s) that paid for this grant">{getValue()}</Badge>
      ) : (
        <span className="text-muted-foreground" title="GiveWell hasn't published which fund paid">
          –
        </span>
      ),
  }),
  col.accessor("grantType", {
    header: "Kind",
    enableSorting: false,
    meta: { placeholder: "Research" },
    cell: ({ getValue }) => {
      const type = getValue();
      return type ? <span title="Guessed from the title">{grantTypeLabels[type]}</span> : "–";
    },
  }),
  col.accessor("amountCents", {
    header: "Amount",
    enableSorting: false,
    meta: { align: "right", placeholder: "00 000 000,00 USD" },
    cell: ({ row: { original: g } }) => (
      <span title={g.amountExact ? undefined : "Rounded, as in GiveWell's write-up"}>
        {g.amountExact || g.amountCents === null ? "" : "≈ "}
        <UsdCents value={g.amountCents} />
      </span>
    ),
  }),
  col.accessor("fundAmountCents", {
    header: "AGF part",
    enableSorting: false,
    meta: { align: "right", placeholder: "0 000 000,00 USD" },
    cell: ({ getValue }) => <UsdCents value={getValue()} />,
  }),
  col.accessor("ceLow", {
    header: "Cost-effectiveness",
    enableSorting: false,
    meta: { placeholder: "10× cash transfers" },
    cell: ({ row: { original: g } }) => formatCeMultiple(g) ?? "–",
  }),
  col.accessor("outputs", {
    header: "Outputs",
    enableSorting: false,
    meta: { cellClassName: "max-w-56" },
    cell: ({ row: { original: g } }) => {
      const parts = [
        g.outputs !== null ? `${formatNumber(g.outputs)} ${g.outputUnit ?? ""}`.trim() : null,
        g.centsPerOutput !== null
          ? `${formatNumber(g.centsPerOutput / 100, { decimals: 2 })} USD each`
          : null,
        g.deathsAverted !== null ? `${formatNumber(g.deathsAverted)} deaths averted` : null,
      ].filter(Boolean);
      return parts.length ? (
        <span className="block truncate" title={parts.join("\n")}>
          {parts.join(" · ")}
        </span>
      ) : (
        "–"
      );
    },
  }),
]);

function AgfGrantsPage() {
  const trpc = useTRPC();
  const list = useListState(agfList);
  const query = usePageQuery(trpc.impact.agf.grants.queryOptions());
  const years = useMemo(
    () =>
      [...new Set((query.data ?? []).map((g) => g.recommendedMonth?.slice(0, 4)).filter(Boolean))]
        .sort()
        .reverse() as string[],
    [query.data],
  );
  const { filters } = list;
  const rows = useMemo(() => {
    const q = filters.q?.trim().toLowerCase();
    const dir = list.sort.desc ? 1 : -1;
    return (query.data ?? [])
      .filter(
        (g) =>
          (!q ||
            g.title.toLowerCase().includes(q) ||
            g.organizationKey.toLowerCase().includes(q) ||
            g.organization.toLowerCase().includes(q)) &&
          (filters.year === undefined || !!g.recommendedMonth?.startsWith(filters.year)) &&
          (filters.funder === undefined ||
            (filters.funder === "agf" ? !!g.funders?.includes("AGF") : g.funders === null)) &&
          (filters.figures === undefined || g.hasFigures === filters.figures) &&
          (filters.type === undefined || g.grantType === filters.type),
      )
      .sort((a, b) => dir * (b.recommendedMonth ?? "").localeCompare(a.recommendedMonth ?? ""));
  }, [query.data, filters, list.sort.desc]);
  const agfNamed = rows.filter((g) => g.funders?.includes("AGF")).length;
  const withFigures = rows.filter((g) => g.hasFigures).length;

  return (
    <ListPage
      title="All Grants Fund grants"
      description={
        <>
          GiveWell's grants since the All Grants Fund started (August 2022), from its grant pages,
          the fund's page and its impact estimates. GiveWell names the funder for only some of them;
          the fund's totals per year are in{" "}
          <Link to="/impact/agf-summary" className="text-accent hover:underline">
            AGF by year
          </Link>
          . Reference data: nothing donors see uses it.
        </>
      }
      filters={
        <FilterBar list={list} searchPlaceholder="Grant or organisation">
          <ChoiceFilter
            field="year"
            label="Year"
            options={years.map((y) => ({ value: y, label: y }))}
          />
          <ChoiceFilter
            field="funder"
            label="Funder"
            options={fundedBy.map((f) => ({ value: f, label: fundedByLabels[f] }))}
          />
          <BooleanFilter
            field="figures"
            label="Figures"
            trueLabel="Has figures"
            falseLabel="No figures"
          />
          <ChoiceFilter
            field="type"
            label="Kind"
            options={givewellGrantTypes.map((t) => ({ value: t, label: grantTypeLabels[t] }))}
          />
        </FilterBar>
      }
    >
      {query.isError ? (
        <div className="px-4 sm:px-6">
          <ErrorState
            error={query.error}
            title="Couldn't load the grants"
            onRetry={() => void query.refetch()}
          />
        </div>
      ) : (
        <DataTable
          label="All Grants Fund grants"
          columns={columns}
          data={query.data ? rows : undefined}
          isLoading={query.isPending}
          isFetching={query.isFetching}
          getRowId={(row) => String(row.id)}
          sorting={list.tableState.sorting}
          onSortingChange={list.tableState.onSortingChange}
          pageHotkeys
          empty={
            <ListEmpty
              list={list}
              noun="grants"
              hint="Grants come from GiveWell through scripts/agf-grants.mjs."
            />
          }
          summary={
            query.data && (
              <TableSummary
                items={[
                  { value: <Num value={rows.length} />, suffix: "grants" },
                  { value: <Num value={agfNamed} />, suffix: "named as AGF" },
                  { value: <Num value={withFigures} />, suffix: "with figures" },
                ]}
              />
            )
          }
        />
      )}
    </ListPage>
  );
}
