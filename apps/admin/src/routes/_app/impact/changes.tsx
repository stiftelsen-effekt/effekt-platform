import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { cellPlaceholder, createColumns, DataTable, TableSummary } from "@/components/data-table";
import { ErrorState } from "@/components/domain/error-state";
import { DateTime, Num } from "@/components/domain/format";
import { ChoiceFilter, FilterBar, ListEmpty, useListState } from "@/components/filters";
import { defineList, param } from "@/components/filters/list-state";
import { ListPage } from "@/components/templates";
import { Badge } from "@/components/ui/badge";
import {
  actionLabels,
  ChangeLink,
  describeFields,
  entityLabels,
  type ImpactChange,
} from "@/features/impact/history";
import { usePageQuery } from "@/lib/query";
import { useTRPC } from "@/lib/trpc";

const entities = ["estimate", "grant", "charity", "intervention"] as const;

const changesList = defineList({
  id: "impact-changes",
  filters: { q: param.text, entity: param.oneOf(entities) },
  sortable: ["changedAt"],
  defaultSort: { id: "changedAt", desc: true },
});

export const Route = createFileRoute("/_app/impact/changes")({
  validateSearch: changesList.validateSearch,
  component: ChangesPage,
});

const col = createColumns<ImpactChange>();
const columns = col.columns([
  col.accessor("changedAt", {
    header: "When",
    enableSorting: false,
    meta: { placeholder: cellPlaceholder.dateTime },
    cell: ({ getValue }) => <DateTime value={getValue()} format="datetime" />,
  }),
  col.accessor("changedBy", {
    header: "Who",
    enableSorting: false,
    meta: { cellClassName: "max-w-56 truncate", placeholder: cellPlaceholder.email },
  }),
  col.accessor("action", {
    header: "What",
    enableSorting: false,
    meta: { placeholder: "Changed AMF estimate from Jan 2023" },
    cell: ({ row: { original: c } }) => (
      <span>
        <Badge tone={c.action === "delete" ? "danger" : undefined}>{actionLabels[c.action]}</Badge>{" "}
        <ChangeLink change={c} />
      </span>
    ),
  }),
  col.accessor("fields", {
    header: "Changes",
    enableSorting: false,
    meta: { cellClassName: "max-w-md" },
    cell: ({ row: { original: c } }) => {
      const lines = describeFields(c);
      return (
        <span className="num block truncate" title={lines.join("\n")}>
          {lines.join(" · ")}
        </span>
      );
    },
  }),
]);

function ChangesPage() {
  const trpc = useTRPC();
  const list = useListState(changesList);
  const query = usePageQuery(
    trpc.impact.changes.list.queryOptions({ entity: list.filters.entity, limit: 500 }),
  );
  const rows = useMemo(() => {
    const q = list.filters.q?.trim().toLowerCase();
    return (query.data ?? []).filter(
      (c) => !q || c.summary.toLowerCase().includes(q) || c.changedBy.toLowerCase().includes(q),
    );
  }, [query.data, list.filters.q]);

  return (
    <ListPage
      title="Change log"
      description="Every change to the impact data made in the admin: who, when, and the values before and after. The newest 500."
      filters={
        <FilterBar list={list} searchPlaceholder="Charity, grant or person">
          <ChoiceFilter
            field="entity"
            label="Kind"
            options={entities.map((e) => ({ value: e, label: entityLabels[e] }))}
          />
        </FilterBar>
      }
    >
      {query.isError ? (
        <div className="px-4 sm:px-6">
          <ErrorState
            error={query.error}
            title="Couldn't load the change log"
            onRetry={() => void query.refetch()}
          />
        </div>
      ) : (
        <DataTable
          label="Change log"
          columns={columns}
          data={query.data ? rows : undefined}
          isLoading={query.isPending}
          isFetching={query.isFetching}
          getRowId={(row) => String(row.id)}
          pageHotkeys
          empty={
            <ListEmpty
              list={list}
              noun="changes"
              hint="Changes appear here once someone edits the impact data."
            />
          }
          summary={
            query.data && (
              <TableSummary items={[{ value: <Num value={rows.length} />, suffix: "changes" }]} />
            )
          }
        />
      )}
    </ListPage>
  );
}
