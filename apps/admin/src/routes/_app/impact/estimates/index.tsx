import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { cellPlaceholder, createColumns, DataTable, TableSummary } from "@/components/data-table";
import { ErrorState } from "@/components/domain/error-state";
import { DateTime, Money, Num } from "@/components/domain/format";
import {
  ChoiceFilter,
  FilterBar,
  ListEmpty,
  OptionsFilter,
  useListState,
} from "@/components/filters";
import { defineList, param } from "@/components/filters/list-state";
import { ListPage } from "@/components/templates";
import {
  formatMonthRange,
  formatMonths,
  osloCurrentMonth,
  type ImpactEstimate,
} from "@/features/impact/model";
import { CoverageStatus, UsdCents } from "@/features/impact/ui";
import { usePageQuery } from "@/lib/query";
import { useTRPC } from "@/lib/trpc";

const estimatesList = defineList({
  id: "impact-estimates",
  filters: {
    q: param.text,
    charity: param.numberList,
    intervention: param.numberList,
    year: param.text,
  },
  sortable: ["validFrom", "charity", "cost"],
  defaultSort: { id: "validFrom", desc: true },
});

export const Route = createFileRoute("/_app/impact/estimates/")({
  validateSearch: estimatesList.validateSearch,
  component: EstimatesPage,
});

const col = createColumns<ImpactEstimate>();
const columns = (currentMonth: string) =>
  col.columns([
    col.accessor("charityName", {
      id: "charity",
      header: "Charity",
      meta: { cellClassName: "font-semibold max-w-64 truncate" },
      cell: ({ row: { original: e } }) => (
        <span title={e.charityName}>
          {e.charityName}{" "}
          <span className="font-normal text-muted-foreground">{e.charityAbbreviation}</span>
        </span>
      ),
    }),
    col.accessor("interventionName", {
      header: "Intervention",
      enableSorting: false,
      meta: { cellClassName: "max-w-48 truncate" },
    }),
    col.accessor("validFrom", {
      header: "Applies to",
      meta: { placeholder: "Jan 2023 – Dec 2024" },
      cell: ({ row: { original: e } }) => (
        <span title={formatMonths(e.monthsApplied) + " so far"}>
          {formatMonthRange(e.validFrom, e.validTo)}
        </span>
      ),
    }),
    col.accessor("centsPerOutput", {
      id: "cost",
      header: "Cost per output",
      meta: { align: "right", placeholder: "00,00 USD" },
      cell: ({ getValue }) => <UsdCents value={getValue()} />,
    }),
    col.accessor("costPerOutputNok", {
      header: "In NOK today",
      enableSorting: false,
      meta: { align: "right", placeholder: cellPlaceholder.money },
      cell: ({ getValue }) => <Money value={getValue()} />,
    }),
    col.accessor("current", {
      header: "Status",
      enableSorting: false,
      cell: ({ row: { original: e } }) => <CoverageStatus row={e} currentMonth={currentMonth} />,
    }),
    col.accessor("updatedAt", {
      header: "Last changed",
      enableSorting: false,
      meta: { placeholder: cellPlaceholder.date },
      cell: ({ row: { original: e } }) => (
        <span title={e.updatedBy ?? e.createdBy}>
          <DateTime value={e.updatedAt ?? e.createdAt} />
        </span>
      ),
    }),
  ]);

function EstimatesPage() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const list = useListState(estimatesList);
  const year = /^\d{4}$/.test(list.filters.year ?? "") ? Number(list.filters.year) : undefined;
  const query = usePageQuery(
    trpc.impact.estimates.list.queryOptions({
      charityIds: list.filters.charity,
      interventionIds: list.filters.intervention,
      year,
    }),
  );
  const charities = useQuery(trpc.impact.charities.list.queryOptions());
  const interventions = useQuery(trpc.impact.interventions.list.queryOptions());
  const currentMonth = osloCurrentMonth();
  const tableColumns = useMemo(() => columns(currentMonth), [currentMonth]);
  const years = useMemo(() => {
    const last = Number(currentMonth.slice(0, 4));
    return Array.from({ length: last - 2012 }, (_, i) => String(last - i));
  }, [currentMonth]);

  const rows = useMemo(() => {
    const q = list.filters.q?.trim().toLowerCase();
    const dir = list.sort.desc ? -1 : 1;
    return (query.data ?? [])
      .filter(
        (e) =>
          !q ||
          e.charityName.toLowerCase().includes(q) ||
          e.charityAbbreviation.toLowerCase() === q ||
          e.interventionName.toLowerCase().includes(q) ||
          e.sourceName.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        if (list.sort.id === "cost") return dir * (a.centsPerOutput - b.centsPerOutput);
        if (list.sort.id === "charity")
          return (
            dir * a.charityName.localeCompare(b.charityName, "nb") ||
            b.validFrom.localeCompare(a.validFrom)
          );
        return (
          dir * a.validFrom.localeCompare(b.validFrom) ||
          a.charityName.localeCompare(b.charityName, "nb")
        );
      });
  }, [query.data, list.filters.q, list.sort.id, list.sort.desc]);
  const inEffect = rows.filter((r) => r.current).length;

  return (
    <ListPage
      title="Cost estimates"
      description="What one output costs at each charity, from GiveWell. A donation uses the charity's latest estimate on or before its month: on Min Side, in receipts and on the results page."
      filters={
        <FilterBar list={list} searchPlaceholder="Charity, intervention or source">
          <OptionsFilter
            field="charity"
            label="Charity"
            options={(charities.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
          <OptionsFilter
            field="intervention"
            label="Intervention"
            options={(interventions.data ?? []).map((i) => ({
              value: i.id,
              label: i.shortDescription,
            }))}
          />
          <ChoiceFilter
            field="year"
            label="Applied in"
            options={years.map((y) => ({ value: y, label: y }))}
          />
        </FilterBar>
      }
    >
      {query.isError ? (
        <div className="px-4 sm:px-6">
          <ErrorState
            error={query.error}
            title="Couldn't load the cost estimates"
            onRetry={() => void query.refetch()}
          />
        </div>
      ) : (
        <DataTable
          label="Cost estimates"
          columns={tableColumns}
          data={query.data ? rows : undefined}
          isLoading={query.isPending}
          isFetching={query.isFetching}
          getRowId={(row) => String(row.id)}
          sorting={list.tableState.sorting}
          onSortingChange={list.tableState.onSortingChange}
          onRowOpen={(row) =>
            void navigate({
              to: "/impact/estimates/$charityId",
              params: { charityId: String(row.charityId) },
            })
          }
          getRowHref={(row) => `/impact/estimates/${row.charityId}`}
          pageHotkeys
          empty={<ListEmpty list={list} noun="estimates" hint="Estimates come from GiveWell." />}
          summary={
            query.data && (
              <TableSummary
                items={[
                  { value: <Num value={rows.length} />, suffix: "estimates" },
                  { value: <Num value={inEffect} />, suffix: "in effect" },
                ]}
              />
            )
          }
        />
      )}
    </ListPage>
  );
}
