import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { createColumns, DataTable, TableSummary } from "@/components/data-table";
import { CopyValue } from "@/components/domain/copy-value";
import { ErrorState } from "@/components/domain/error-state";
import { DateTime, Money, Num } from "@/components/domain/format";
import { Stat, StatGroup } from "@/components/domain/stat";
import { Status } from "@/components/domain/status";
import {
  FilterBar,
  ListEmpty,
  OptionsFilter,
  SavedViews,
  useListState,
} from "@/components/filters";
import { ListPage } from "@/components/templates";
import {
  deliveryLabel,
  displayStatus,
  giftcardDeliveries,
  giftcardFilterStatusLabels,
  giftcardFilterStatuses,
  giftcardsList,
  toGiftcardFilter,
  type GiftcardListRow,
} from "@/features/giftcards/model";
import { nextPage, usePageQuery } from "@/lib/query";
import { giftcardStatus } from "@/lib/status";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_app/giftcards/")({
  validateSearch: giftcardsList.validateSearch,
  component: GiftcardsPage,
});

const none = <span className="text-faint-foreground">–</span>;

const col = createColumns<GiftcardListRow>();
const columns = col.columns([
  col.accessor("recipientName", {
    header: "Recipient",
    enableSorting: false,
    meta: { cellClassName: "font-semibold max-w-48 truncate" },
    cell: ({ row }) => (
      <span>
        {row.original.recipientName}
        {row.original.recipientPhone && (
          <span className="ml-1.5 font-normal text-muted-foreground num">
            {row.original.recipientPhone}
          </span>
        )}
      </span>
    ),
  }),
  col.accessor("status", {
    header: "Status",
    enableSorting: false,
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-1.5">
        <Status catalog={giftcardStatus} value={displayStatus(row.original)} />
        {row.original.status === "failed" && row.original.lastError && (
          <span
            className="max-w-48 truncate text-xs text-muted-foreground"
            title={row.original.lastError}
          >
            {row.original.lastError}
          </span>
        )}
      </span>
    ),
  }),
  col.accessor("productName", {
    id: "product",
    header: "Gift",
    enableSorting: false,
    meta: { cellClassName: "max-w-56 truncate" },
    cell: ({ row }) => (
      <span title={row.original.productName}>
        <span className="num">{row.original.units}</span> × {row.original.productName}
      </span>
    ),
  }),
  col.accessor("amount", {
    header: "Amount",
    meta: { numeric: true, cellClassName: "font-semibold" },
    cell: ({ getValue }) => <Money value={getValue()} />,
  }),
  col.accessor("delivery", {
    header: "Delivery",
    enableSorting: false,
    cell: ({ getValue }) => deliveryLabel[getValue()],
  }),
  col.accessor("sendAt", {
    header: "Send at",
    meta: { numeric: true },
    cell: ({ getValue }) => {
      const value = getValue();
      return value ? <DateTime value={value} format="datetime" /> : none;
    },
  }),
  col.accessor("sentAt", {
    header: "Sent",
    enableSorting: false,
    meta: { numeric: true },
    cell: ({ getValue }) => {
      const value = getValue();
      return value ? <DateTime value={value} format="datetime" /> : none;
    },
  }),
  col.accessor("donorName", {
    id: "buyer",
    header: "Buyer",
    enableSorting: false,
    meta: { cellClassName: "max-w-48 truncate" },
    cell: ({ row }) =>
      row.original.donorId ? (
        <Link
          to="/donors/$id"
          params={{ id: String(row.original.donorId) }}
          className="underline-offset-2 hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {row.original.donorName || row.original.donorEmail || `Donor #${row.original.donorId}`}
        </Link>
      ) : (
        none
      ),
  }),
  col.accessor("KID", {
    header: "KID",
    enableSorting: false,
    cell: ({ getValue }) => <CopyValue value={getValue()} label="KID" />,
  }),
  col.accessor("created", {
    header: "Bought",
    meta: { numeric: true },
    cell: ({ getValue }) => <DateTime value={getValue()} format="datetime" />,
  }),
]);

function GiftcardsPage() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const list = useListState(giftcardsList);

  const filter = toGiftcardFilter(list.filters);
  const sort = { id: list.sort.id, desc: list.sort.desc };
  const listOptions = (page: number) =>
    trpc.giftcards.list.queryOptions({ page: page - 1, limit: list.pageSize, sort, filter });
  const query = usePageQuery(listOptions(list.page), {
    prefetch: (data) => nextPage(list.page, data.pages, listOptions),
  });
  const summary = useQuery(trpc.giftcards.summary.queryOptions());
  const products = useQuery(trpc.giftcards.products.queryOptions());

  const showStatus = (status: "paid" | "sent" | "failed", delivery?: "sms") =>
    void navigate({
      to: "/giftcards",
      search: { status, ...(delivery ? { delivery } : {}) },
    });

  return (
    <ListPage
      title="Gift cards"
      filters={
        <div className="grid gap-3">
          <StatGroup>
            <Stat
              label={
                <button
                  type="button"
                  className="hover:underline"
                  onClick={() => showStatus("paid", "sms")}
                >
                  Waiting to send
                </button>
              }
              value={<Num value={summary.data?.waiting} />}
              pending={summary.isPending}
              placeholder="00"
              hint="paid SMS gift cards"
            />
            <Stat
              label={
                <button
                  type="button"
                  className="hover:underline"
                  onClick={() => showStatus("sent")}
                >
                  Sent
                </button>
              }
              value={<Num value={summary.data?.sent} />}
              pending={summary.isPending}
              placeholder="00"
            />
            <Stat
              label={
                <button
                  type="button"
                  className="hover:underline"
                  onClick={() => showStatus("failed")}
                >
                  Failed
                </button>
              }
              value={
                <span className={summary.data?.failed ? "text-danger" : undefined}>
                  <Num value={summary.data?.failed} />
                </span>
              }
              pending={summary.isPending}
              placeholder="00"
              hint={summary.data?.failed ? "need a retry or a look" : "nothing to do"}
            />
          </StatGroup>
          <FilterBar
            list={list}
            searchPlaceholder="Recipient, buyer, sender or KID"
            end={<SavedViews list={list} />}
          >
            <OptionsFilter
              field="status"
              label="Status"
              options={giftcardFilterStatuses.map((status) => ({
                value: status,
                label: giftcardFilterStatusLabels[status],
              }))}
            />
            <OptionsFilter
              field="delivery"
              label="Delivery"
              options={giftcardDeliveries.map((delivery) => ({
                value: delivery,
                label: deliveryLabel[delivery],
              }))}
            />
            <OptionsFilter
              field="product"
              label="Product"
              options={(products.data ?? []).map((product) => ({
                value: product.slug,
                label: product.name,
              }))}
            />
          </FilterBar>
        </div>
      }
    >
      {query.isError ? (
        <div className="px-4 sm:px-6">
          <ErrorState
            error={query.error}
            title="Couldn't load gift cards"
            onRetry={() => void query.refetch()}
          />
        </div>
      ) : (
        <DataTable
          label="Gift cards"
          columns={columns}
          data={query.data?.rows}
          rowCount={query.data?.count}
          isLoading={query.isPending}
          isFetching={query.isFetching}
          getRowId={(row) => String(row.id)}
          {...list.tableState}
          onRowOpen={(row) =>
            void navigate({ to: "/giftcards/$id", params: { id: String(row.id) } })
          }
          getRowHref={(row) => `/giftcards/${row.id}`}
          pageHotkeys
          empty={
            <ListEmpty
              list={list}
              noun="gift cards"
              hint="Gift cards show up here when someone buys one on the website."
            />
          }
          summary={
            query.data && (
              <TableSummary
                items={[{ value: <Num value={query.data.count} />, suffix: "gift cards" }]}
              />
            )
          }
        />
      )}
    </ListPage>
  );
}
