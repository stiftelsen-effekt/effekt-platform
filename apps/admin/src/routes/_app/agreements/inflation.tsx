import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { cellPlaceholder, createColumns, DataTable } from "@/components/data-table";
import { Callout } from "@/components/domain/callout";
import { ConfirmDialog } from "@/components/domain/confirm-dialog";
import { ErrorState, describeError } from "@/components/domain/error-state";
import { DateTime, Money, Num } from "@/components/domain/format";
import { Stat, StatGroup } from "@/components/domain/stat";
import { ListPage } from "@/components/templates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  emails,
  offerStatuses,
  offers,
  providerOf,
  sendInBatches,
  type EligibleRow,
  type InflationOverview,
  type SendProgress,
  type UnsentRow,
} from "@/features/agreements/inflation";
import { agreementTypes } from "@/features/agreements/model";
import { notify } from "@/lib/notify";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_app/agreements/inflation")({
  loader: ({ context: { queryClient, trpc } }) => {
    void queryClient.prefetchQuery(trpc.inflation.overview.queryOptions());
  },
  component: InflationAdjustmentPage,
});

const none = <span className="text-faint-foreground">–</span>;

const typeBadge = (type: "avtaleGiro" | "vipps") => (
  <Badge tone="outline">{agreementTypes[providerOf(type)].label}</Badge>
);

const eligibleCol = createColumns<EligibleRow>();
const eligibleColumns = eligibleCol.columns([
  eligibleCol.accessor("donorName", {
    header: "Donor",
    meta: { cellClassName: "font-semibold max-w-56 truncate", placeholder: cellPlaceholder.name },
    cell: ({ getValue }) => getValue() || none,
  }),
  eligibleCol.accessor("email", {
    header: "Email",
    meta: { cellClassName: "max-w-64 truncate", placeholder: cellPlaceholder.email },
  }),
  eligibleCol.accessor("type", {
    header: "Type",
    cell: ({ getValue }) => typeBadge(getValue()),
  }),
  eligibleCol.accessor("currentAmount", {
    header: "Now",
    meta: { numeric: true, placeholder: cellPlaceholder.money },
    cell: ({ getValue }) => <Money value={getValue()} />,
  }),
  eligibleCol.accessor("proposedAmount", {
    header: "Proposed",
    meta: { numeric: true, placeholder: cellPlaceholder.money, cellClassName: "font-semibold" },
    cell: ({ getValue }) => <Money value={getValue()} />,
  }),
  eligibleCol.accessor("inflation", {
    header: "Inflation",
    meta: { numeric: true },
    cell: ({ getValue }) => <Num value={getValue()} percent />,
  }),
  eligibleCol.accessor("lastChange", {
    header: "Amount set",
    meta: { numeric: true, label: "Amount last set (month)" },
    cell: ({ getValue }) => <DateTime value={`${getValue()}-01`} format="month" />,
  }),
  eligibleCol.accessor("monthsSinceChange", {
    header: "Months",
    meta: { numeric: true, label: "Months since the amount was set" },
    cell: ({ getValue }) => <Num value={getValue()} />,
  }),
]);

const unsentCol = createColumns<UnsentRow>();
const unsentColumns = unsentCol.columns([
  unsentCol.accessor("donorName", {
    header: "Donor",
    meta: { cellClassName: "font-semibold max-w-56 truncate", placeholder: cellPlaceholder.name },
    cell: ({ getValue }) => getValue() || none,
  }),
  unsentCol.accessor("email", {
    header: "Email",
    meta: { cellClassName: "max-w-64 truncate", placeholder: cellPlaceholder.email },
    cell: ({ getValue }) => getValue() || none,
  }),
  unsentCol.accessor("type", {
    header: "Type",
    cell: ({ getValue }) => typeBadge(getValue()),
  }),
  unsentCol.accessor("currentAmount", {
    header: "Now",
    meta: { numeric: true, placeholder: cellPlaceholder.money },
    cell: ({ getValue }) => <Money value={getValue()} />,
  }),
  unsentCol.accessor("proposedAmount", {
    header: "Proposed",
    meta: { numeric: true, placeholder: cellPlaceholder.money, cellClassName: "font-semibold" },
    cell: ({ getValue }) => <Money value={getValue()} />,
  }),
  unsentCol.accessor("inflation", {
    header: "Inflation",
    meta: { numeric: true },
    cell: ({ getValue }) => <Num value={getValue()} percent />,
  }),
  unsentCol.accessor("prepared", {
    header: "Prepared",
    meta: { numeric: true, placeholder: cellPlaceholder.date },
    cell: ({ getValue }) => <DateTime value={getValue()} />,
  }),
  unsentCol.accessor("stillValid", {
    header: "Agreement",
    cell: ({ getValue }) =>
      getValue() ? (
        <span className="text-sm text-muted-foreground">Unchanged</span>
      ) : (
        <Badge tone="warning" title="Stopped or amount changed: this offer won't be sent">
          Changed
        </Badge>
      ),
  }),
]);

const agreementHref = (row: { type: "avtaleGiro" | "vipps"; agreementId: string }) =>
  `/agreements/${providerOf(row.type)}/${row.agreementId}`;

function Totals({ overview }: { overview: InflationOverview | undefined }) {
  const count = (status: string) => overview?.statuses.find((s) => s.status === status)?.count ?? 0;
  const pending = !overview;
  return (
    <StatGroup columns={4}>
      <Stat
        pending={pending}
        label="Eligible now"
        placeholder="000"
        value={overview && <Num value={overview.eligibleTotals.count} />}
        hint={
          overview &&
          `${formatCount(overview.eligibleTotals.avtaleGiro)} AvtaleGiro · ${formatCount(overview.eligibleTotals.vipps)} Vipps`
        }
      />
      <Stat
        pending={pending}
        label="If all accept"
        value={overview && <Money value={overview.eligibleTotals.monthlyIncrease} />}
        hint={
          overview && (
            <>
              a month · <Money value={overview.eligibleTotals.yearlyIncrease} /> a year
            </>
          )
        }
      />
      <Stat
        pending={pending}
        label="Prepared, not sent"
        placeholder="000"
        value={overview && <Num value={overview.unsentTotals.count} />}
        hint={
          overview && (
            <>
              <Money value={overview.unsentTotals.monthlyIncrease} /> a month if all accept
            </>
          )
        }
      />
      <Stat
        pending={pending}
        label="Awaiting answer"
        placeholder="000"
        value={overview && <Num value={count("pending")} />}
        hint={overview && `${formatCount(count("accepted"))} accepted so far`}
      />
    </StatGroup>
  );
}

const formatCount = (n: number) => n.toLocaleString("nb-NO");

function PrepareButton({ overview }: { overview: InflationOverview | undefined }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const prepare = useMutation(trpc.inflation.prepare.mutationOptions());
  const count = overview?.eligibleTotals.count ?? 0;
  return (
    <ConfirmDialog
      trigger={
        <Button variant={overview?.unsentTotals.count ? "secondary" : "primary"} disabled={!count}>
          Prepare {offers(count)}
        </Button>
      }
      title={`Prepare ${offers(count)}?`}
      consequences={[
        `Adds an offer for each of the ${formatCount(count)} eligible agreements, with the amounts shown.`,
        "Nothing is emailed. You send the prepared offers in the next step.",
        "Agreements that already have an open offer are skipped.",
      ]}
      confirmLabel={`Prepare ${offers(count)}`}
      onConfirm={async () => {
        const result = await prepare.mutateAsync();
        await queryClient.invalidateQueries({ queryKey: trpc.inflation.pathKey() });
        notify.success(
          `Prepared ${offers(result.created)}`,
          result.alreadyOpen > 0
            ? `${offers(result.alreadyOpen)} already open, left as they were`
            : undefined,
        );
      }}
    />
  );
}

function SendButton({
  overview,
  progress,
  onStart,
}: {
  overview: InflationOverview | undefined;
  progress: SendProgress | null;
  onStart: (count: number) => void;
}) {
  const available = overview?.unsent.filter((row) => row.stillValid).length ?? 0;
  const [count, setCount] = useState("");
  const requested = Math.min(available, Math.max(0, Math.floor(Number(count || available))));
  const sending = progress !== null && !progress.done;
  return (
    <ConfirmDialog
      trigger={
        <Button variant="primary" disabled={!available || sending}>
          Send {emails(available)}
        </Button>
      }
      title={`Send ${emails(requested)}?`}
      consequences={[
        `${formatCount(requested)} donors get an email asking them to raise their monthly amount.`,
        "Each offer is open for 30 days from its email. Nothing changes unless the donor accepts.",
        "Emails go out in small batches; keep this page open until it's done. You can stop between batches.",
        "An email is never sent twice for the same offer.",
      ]}
      confirmLabel={`Send ${emails(requested)}`}
      disabled={requested < 1}
      onConfirm={() => {
        onStart(requested);
        setCount("");
      }}
    >
      <Field
        label="How many"
        hint={`At most ${formatCount(available)}. Start with a few to check the email, then send the rest.`}
      >
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          max={available}
          value={count}
          placeholder={String(available)}
          onChange={(e) => setCount(e.target.value)}
        />
      </Field>
    </ConfirmDialog>
  );
}

function ProgressCallout({ progress, onStop }: { progress: SendProgress; onStop: () => void }) {
  const handled = progress.sent + progress.failed + progress.cancelled;
  const detail = [
    `${formatCount(progress.sent)} sent`,
    progress.failed > 0 && `${formatCount(progress.failed)} failed`,
    progress.cancelled > 0 && `${formatCount(progress.cancelled)} cancelled (agreement changed)`,
  ]
    .filter(Boolean)
    .join(" · ");
  if (!progress.done) {
    return (
      <Callout
        tone="accent"
        title={`Sending: ${formatCount(handled)} of ${formatCount(progress.requested)}`}
        action={
          <Button size="sm" variant="secondary" onClick={onStop}>
            Stop after this batch
          </Button>
        }
      >
        {detail}. Keep this page open.
      </Callout>
    );
  }
  return (
    <Callout
      tone={progress.error || progress.failed > 0 ? "warning" : "success"}
      title={progress.error ? "Sending stopped" : `Sent ${emails(progress.sent)}`}
    >
      {detail}.{" "}
      {progress.error
        ? `${describeError(progress.error).title}. Offers that weren't sent stay prepared; send again to continue.`
        : `${formatCount(progress.remaining)} prepared offers left.`}
    </Callout>
  );
}

/**
 * Inflation adjustment round: offers to raise recurring amounts by the inflation since the
 * amount was last set (docs/inflation-adjustment.md). Two deliberate steps: prepare, then send.
 */
function InflationAdjustmentPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const query = useQuery(trpc.inflation.overview.queryOptions());
  const send = useMutation(trpc.inflation.send.mutationOptions());
  const [progress, setProgress] = useState<SendProgress | null>(null);
  const stop = useRef(false);
  const overview = query.data;
  const statusCount = (status: string) =>
    overview?.statuses.find((s) => s.status === status)?.count ?? 0;

  const start = (requested: number) => {
    if (!overview) return;
    stop.current = false;
    void sendInBatches({
      requested,
      maxBatch: overview.maxSendBatch,
      sendBatch: (batchSize) => send.mutateAsync({ batchSize }),
      onProgress: setProgress,
      shouldStop: () => stop.current,
    }).then(() => queryClient.invalidateQueries({ queryKey: trpc.inflation.pathKey() }));
  };

  return (
    <ListPage
      breadcrumbs={[{ label: "Agreements", to: "/agreements" }]}
      title="Inflation adjustment"
      description={
        overview
          ? `Offers to raise a monthly amount by the inflation since it was set, when that's at least 12 months ago, inflation is 5 % or more and the increase is at least 10 kr. Inflation from SSB until ${overview.inflationUntil}.`
          : "Offers to raise a monthly amount by the inflation since it was set."
      }
      actions={
        <div className="flex gap-2">
          <PrepareButton overview={overview} />
          <SendButton overview={overview} progress={progress} onStart={start} />
        </div>
      }
    >
      <div className="grid gap-4 px-4 pb-8 sm:px-6">
        {query.isError ? (
          <ErrorState
            error={query.error}
            title="Couldn't load the inflation adjustment"
            onRetry={() => void query.refetch()}
          />
        ) : (
          <>
            {progress && (
              <ProgressCallout progress={progress} onStop={() => (stop.current = true)} />
            )}
            {statusCount("sending") > 0 && !(progress && !progress.done) && (
              <Callout tone="warning" title={`${offers(statusCount("sending"))} stuck in sending`}>
                A send stopped while these were being emailed. They are never sent again
                automatically; check MailerSend to see whether the emails went out.
              </Callout>
            )}
            <Totals overview={overview} />
            <Tabs defaultValue="eligible">
              <TabsList>
                <TabsTrigger value="eligible" count={overview?.eligible.length ?? null}>
                  Eligible
                </TabsTrigger>
                <TabsTrigger value="unsent" count={overview?.unsent.length ?? null}>
                  Prepared, not sent
                </TabsTrigger>
                <TabsTrigger value="statuses">All offers</TabsTrigger>
              </TabsList>
              <TabsContent value="eligible">
                <DataTable
                  label="Eligible agreements"
                  columns={eligibleColumns}
                  data={overview?.eligible}
                  isLoading={query.isPending}
                  isFetching={query.isFetching}
                  getRowId={(row) => `${row.type}:${row.agreementId}`}
                  getRowHref={agreementHref}
                  empty={
                    <p className="px-4 py-6 text-sm text-muted-foreground">
                      No agreement qualifies now. Agreements with an open offer, or one from the
                      last 12 months, aren't listed.
                    </p>
                  }
                />
              </TabsContent>
              <TabsContent value="unsent">
                <DataTable
                  label="Prepared offers not sent"
                  columns={unsentColumns}
                  data={overview?.unsent}
                  isLoading={query.isPending}
                  isFetching={query.isFetching}
                  getRowId={(row) => String(row.id)}
                  getRowHref={agreementHref}
                  empty={
                    <p className="px-4 py-6 text-sm text-muted-foreground">
                      No prepared offers. Prepare offers first.
                    </p>
                  }
                />
              </TabsContent>
              <TabsContent value="statuses">
                <StatusTable overview={overview} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </ListPage>
  );
}

function StatusTable({ overview }: { overview: InflationOverview | undefined }) {
  if (!overview) return null;
  if (overview.statuses.length === 0) {
    return <p className="text-sm text-muted-foreground">No offers yet.</p>;
  }
  return (
    <div className="min-w-0 overflow-x-auto rounded-md border border-border bg-surface">
      <table className="w-full text-sm" aria-label="Offers by status">
        <thead>
          <tr className="text-left text-xs text-muted-foreground [&>th]:border-b [&>th]:border-border [&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold">
            <th scope="col">Status</th>
            <th scope="col" className="text-right">
              Offers
            </th>
            <th scope="col" className="text-right">
              Monthly increase
            </th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody className="[&>tr>td]:border-b [&>tr>td]:border-border [&>tr>td]:px-3 [&>tr>td]:py-1.5">
          {overview.statuses.map((s) => {
            const meta = offerStatuses[s.status] ?? {
              label: s.status,
              tone: "outline" as const,
              hint: "",
            };
            return (
              <tr key={s.status}>
                <td>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </td>
                <td className="text-right">
                  <Num value={s.count} />
                </td>
                <td className="text-right">
                  <Money value={s.monthlyIncrease} />
                </td>
                <td className="text-muted-foreground">{meta.hint}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
