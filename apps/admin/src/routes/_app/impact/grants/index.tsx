import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { cellPlaceholder, createColumns, DataTable, TableSummary } from "@/components/data-table";
import { ErrorState } from "@/components/domain/error-state";
import { DateTime, Num } from "@/components/domain/format";
import { ChoiceFilter, FilterBar, ListEmpty, useListState } from "@/components/filters";
import { defineList, param } from "@/components/filters/list-state";
import { ListPage } from "@/components/templates";
import { Badge } from "@/components/ui/badge";
import {
  formatMonthRange,
  formatMonths,
  fundLabels,
  impactFunds,
  osloCurrentMonth,
  type ImpactGrantRow,
} from "@/features/impact/model";
import { CoverageStatus, UsdCents } from "@/features/impact/ui";
import { usePageQuery } from "@/lib/query";
import { useTRPC } from "@/lib/trpc";

const grantsList = defineList({
  id: "impact-grants",
  filters: { fund: param.oneOf(impactFunds) },
  sortable: ["validFrom"],
  defaultSort: { id: "validFrom", desc: true },
});

export const Route = createFileRoute("/_app/impact/grants/")({
  validateSearch: grantsList.validateSearch,
  component: GrantsPage,
});

const col = createColumns<ImpactGrantRow>();
const columns = (currentMonth: string) =>
  col.columns([
    col.accessor("validFrom", {
      header: "Applies to",
      meta: { cellClassName: "font-semibold", placeholder: "Jan 2025 – Jan 2025" },
      cell: ({ row: { original: g } }) => (
        <span title={`${formatMonths(g.monthsApplied)} so far`}>
          {formatMonthRange(g.validFrom, g.validTo)}
        </span>
      ),
    }),
    col.accessor("fund", {
      header: "Fund",
      enableSorting: false,
      cell: ({ getValue }) => <Badge title={fundLabels[getValue()]}>{getValue()}</Badge>,
    }),
    col.accessor("current", {
      header: "Status",
      enableSorting: false,
      cell: ({ row: { original: g } }) => <CoverageStatus row={g} currentMonth={currentMonth} />,
    }),
    col.accessor("charities", {
      header: "Charities",
      enableSorting: false,
      meta: { cellClassName: "max-w-80 truncate" },
      cell: ({ getValue }) => <span title={getValue().join(", ")}>{getValue().join(", ")}</span>,
    }),
    col.accessor("allotments", {
      header: "Allotments",
      enableSorting: false,
      meta: { align: "right", placeholder: cellPlaceholder.count },
      cell: ({ getValue }) => <Num value={getValue()} />,
    }),
    col.accessor("totalCents", {
      header: "Granted",
      enableSorting: false,
      meta: { align: "right", placeholder: "00 000 000,00 USD" },
      cell: ({ getValue }) => <UsdCents value={getValue()} />,
    }),
    col.accessor("updatedAt", {
      header: "Last changed",
      enableSorting: false,
      meta: { placeholder: cellPlaceholder.date },
      cell: ({ row: { original: g } }) => (
        <span title={g.updatedBy ?? g.createdBy}>
          <DateTime value={g.updatedAt ?? g.createdAt} />
        </span>
      ),
    }),
  ]);

function GrantsPage() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const list = useListState(grantsList);
  const query = usePageQuery(trpc.impact.grants.list.queryOptions({ fund: list.filters.fund }));
  const currentMonth = osloCurrentMonth();
  const tableColumns = useMemo(() => columns(currentMonth), [currentMonth]);
  const rows = useMemo(() => {
    const dir = list.sort.desc ? 1 : -1;
    // The API sends newest first
    return [...(query.data ?? [])].sort(
      (a, b) => dir * b.validFrom.localeCompare(a.validFrom) || a.fund.localeCompare(b.fund),
    );
  }, [query.data, list.sort.desc]);

  return (
    <ListPage
      title="Fund grants"
      description="How GiveWell's funds granted their money. Donations to the Top Charities Fund are split like the fund's latest grant on or before their month."
      filters={
        <FilterBar list={list}>
          <ChoiceFilter
            field="fund"
            label="Fund"
            options={impactFunds.map((f) => ({ value: f, label: fundLabels[f] }))}
          />
        </FilterBar>
      }
    >
      {query.isError ? (
        <div className="px-4 sm:px-6">
          <ErrorState
            error={query.error}
            title="Couldn't load the fund grants"
            onRetry={() => void query.refetch()}
          />
        </div>
      ) : (
        <DataTable
          label="Fund grants"
          columns={tableColumns}
          data={query.data ? rows : undefined}
          isLoading={query.isPending}
          isFetching={query.isFetching}
          getRowId={(row) => String(row.id)}
          sorting={list.tableState.sorting}
          onSortingChange={list.tableState.onSortingChange}
          onRowOpen={(row) =>
            void navigate({ to: "/impact/grants/$id", params: { id: String(row.id) } })
          }
          getRowHref={(row) => `/impact/grants/${row.id}`}
          pageHotkeys
          empty={<ListEmpty list={list} noun="grants" hint="Grants come from GiveWell." />}
          summary={
            query.data && (
              <TableSummary items={[{ value: <Num value={rows.length} />, suffix: "grants" }]} />
            )
          }
        />
      )}
    </ListPage>
  );
}
