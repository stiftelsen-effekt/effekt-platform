import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { createColumns, DataTable, TableSummary } from "@/components/data-table";
import { ErrorState } from "@/components/domain/error-state";
import { Num } from "@/components/domain/format";
import { ChoiceFilter, FilterBar, ListEmpty, useListState } from "@/components/filters";
import { defineList, param } from "@/components/filters/list-state";
import { ListPage } from "@/components/templates";
import type { AgfPortfolioRow } from "@/features/impact/model";
import { SourceLinks, UsdCents } from "@/features/impact/ui";
import { usePageQuery } from "@/lib/query";
import { useTRPC } from "@/lib/trpc";

const summaryList = defineList({
  id: "impact-agf-summary",
  filters: { q: param.text, year: param.text },
  sortable: ["metricsYear"],
  defaultSort: { id: "metricsYear", desc: true },
});

export const Route = createFileRoute("/_app/impact/agf-summary")({
  validateSearch: summaryList.validateSearch,
  component: AgfSummaryPage,
});

const col = createColumns<AgfPortfolioRow>();
const columns = col.columns([
  col.accessor("metricsYear", {
    header: "Year",
    meta: { cellClassName: "font-semibold", placeholder: "2025" },
  }),
  col.accessor("organization", {
    header: "Organisation",
    enableSorting: false,
    meta: { cellClassName: "max-w-72 truncate", placeholder: "Clinton Health Access Initiative" },
    cell: ({ row: { original: r } }) => (
      <span title={r.organization}>
        {r.organization}
        {r.organizationName && (
          <span className="text-muted-foreground"> · ours: {r.organizationName}</span>
        )}
      </span>
    ),
  }),
  col.accessor("program", {
    header: "Programme",
    enableSorting: false,
    meta: { cellClassName: "max-w-72 truncate", placeholder: "malaria vaccines" },
    cell: ({ getValue }) => getValue() ?? <span className="text-muted-foreground">–</span>,
  }),
  col.accessor("amountCents", {
    header: "From the AGF",
    enableSorting: false,
    meta: { align: "right", placeholder: "00 000 000,00 USD" },
    cell: ({ getValue }) => <UsdCents value={getValue()} />,
  }),
  col.accessor("sourceName", {
    header: "Source",
    enableSorting: false,
    meta: { placeholder: "GiveWell metrics report 2025" },
    cell: ({ row: { original: r } }) => <SourceLinks name={r.sourceName} url={r.sourceUrl} />,
  }),
]);

function AgfSummaryPage() {
  const trpc = useTRPC();
  const list = useListState(summaryList);
  const query = usePageQuery(trpc.impact.agf.portfolio.queryOptions());
  const years = useMemo(
    () => [...new Set((query.data ?? []).map((r) => String(r.metricsYear)))].sort().reverse(),
    [query.data],
  );
  const { filters } = list;
  const rows = useMemo(() => {
    const q = filters.q?.trim().toLowerCase();
    const dir = list.sort.desc ? 1 : -1;
    return (query.data ?? [])
      .filter(
        (r) =>
          (!q ||
            r.organization.toLowerCase().includes(q) ||
            r.organizationKey.toLowerCase().includes(q) ||
            !!r.program?.toLowerCase().includes(q)) &&
          (filters.year === undefined || String(r.metricsYear) === filters.year),
      )
      .sort((a, b) => dir * (b.metricsYear - a.metricsYear) || b.amountCents - a.amountCents);
  }, [query.data, filters, list.sort.desc]);
  const total = rows.reduce((sum, r) => sum + r.amountCents, 0);

  return (
    <ListPage
      title="AGF by year"
      description={
        <>
          What GiveWell's All Grants Fund granted per metrics year, by organisation (and programme
          up to 2024), from GiveWell's yearly metrics reports. Each year adds up to the report's AGF
          total. Single grants are in{" "}
          <Link to="/impact/agf" className="text-accent hover:underline">
            All Grants Fund grants
          </Link>
          . Reference data: nothing donors see uses it.
        </>
      }
      filters={
        <FilterBar list={list} searchPlaceholder="Organisation or programme">
          <ChoiceFilter
            field="year"
            label="Year"
            options={years.map((y) => ({ value: y, label: y }))}
          />
        </FilterBar>
      }
    >
      {query.isError ? (
        <div className="px-4 sm:px-6">
          <ErrorState
            error={query.error}
            title="Couldn't load the AGF totals"
            onRetry={() => void query.refetch()}
          />
        </div>
      ) : (
        <DataTable
          label="AGF by year"
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
              noun="rows"
              hint="Rows come from GiveWell's metrics reports through scripts/agf-grants.mjs."
            />
          }
          summary={
            query.data && (
              <TableSummary
                items={[
                  { value: <Num value={rows.length} />, suffix: "rows" },
                  { value: <UsdCents value={total} />, suffix: "in all" },
                ]}
              />
            )
          }
        />
      )}
    </ListPage>
  );
}
