import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Callout } from "@/components/domain/callout";
import { ErrorState } from "@/components/domain/error-state";
import { DateTime, Num } from "@/components/domain/format";
import { Stat, StatGroup } from "@/components/domain/stat";
import { DetailPage, PageSection } from "@/components/templates";
import { Pending } from "@/components/ui/pending";
import { formatDate, formatNumber } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_app/impact/exchange-rates")({
  component: ExchangeRatesPage,
});

const th = "text-left text-xs text-muted-foreground [&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold";
const td = "[&>td]:border-t [&>td]:border-border [&>td]:px-3 [&>td]:py-1.5";

/** The job's answer, as POST /scheduled/exchange-rates returns it */
type JobResult = { from?: string; to?: string; days?: number; rows?: number };

/** ECB publishes on business days; more than four days without a rate is late */
const STALE_DAYS = 4;

function ExchangeRatesPage() {
  const trpc = useTRPC();
  const query = useQuery(trpc.impact.exchangeRates.queryOptions());

  if (query.isError)
    return (
      <div className="p-6">
        <ErrorState
          error={query.error}
          title="Couldn't load the exchange rates"
          onRetry={() => void query.refetch()}
        />
      </div>
    );

  const r = query.data;
  const nok = r?.currencies.find((c) => c.currency === "NOK");
  const lastRun = r?.jobRuns[0];
  const stale = r && (r.daysSinceLatest === null || r.daysSinceLatest > STALE_DAYS);

  return (
    <DetailPage
      title="Exchange rates"
      meta={[
        <span key="source">
          ECB reference rates, per US dollar. Filled every day at 17:00 by the exchange-rate job;
          read-only here.
        </span>,
      ]}
      stats={
        <StatGroup>
          <Stat
            label="NOK per USD"
            pending={!r}
            placeholder="00,0000"
            value={r && (nok ? formatNumber(Number(nok.perUsd), { decimals: 4 }) : "–")}
            hint={r && (nok ? formatDate(nok.latestDate) : "No NOK rates stored")}
          />
          <Stat
            label="Newest rate"
            pending={!r}
            placeholder="00.00.0000"
            value={r && (r.latestDate ? formatDate(r.latestDate) : "–")}
            hint={
              r &&
              r.daysSinceLatest !== null &&
              (r.daysSinceLatest === 0 ? "today" : `${r.daysSinceLatest} days ago`)
            }
          />
          <Stat
            label="Last job run"
            pending={!r}
            placeholder="00.00.0000 00:00"
            value={r && (lastRun ? formatDate(lastRun.at, "datetime") : "–")}
            hint={
              r &&
              lastRun &&
              `${formatNumber((lastRun.result as JobResult | null)?.rows ?? 0)} rows`
            }
          />
          <Stat
            label="Gaps, last 12 months"
            pending={!r}
            placeholder="0"
            value={r && <Num value={r.gaps.length} />}
            hint={r && "More than 4 days without a rate"}
          />
        </StatGroup>
      }
    >
      {!r ? (
        <Pending className="min-h-96" label="Loading the exchange rates" />
      ) : (
        <>
          {stale && (
            <Callout tone="warning" title="The rates are behind">
              {r.latestDate
                ? `The newest rate is from ${formatDate(r.latestDate)}.`
                : "No rates are stored."}{" "}
              Figures use the newest earlier rate until the job catches up. Check the last runs
              below, or the job's alerts.
            </Callout>
          )}
          <PageSection title="Currencies" description="The newest rate stored for each currency.">
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm" aria-label="Currencies">
                <thead>
                  <tr className={th}>
                    <th scope="col">Currency</th>
                    <th scope="col" className="text-right">
                      Per USD
                    </th>
                    <th scope="col">Date</th>
                    <th scope="col">Since</th>
                    <th scope="col" className="text-right">
                      Days stored
                    </th>
                    <th scope="col">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {r.currencies.map((c) => (
                    <tr key={c.currency} className={td}>
                      <td className="num font-semibold">{c.currency}</td>
                      <td className="num text-right">
                        {formatNumber(Number(c.perUsd), { decimals: 4 })}
                      </td>
                      <td>
                        <DateTime value={c.latestDate} />
                      </td>
                      <td>
                        <DateTime value={c.firstDate} />
                      </td>
                      <td className="num text-right">{formatNumber(c.days)}</td>
                      <td>{c.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </PageSection>
          <PageSection
            title="Gaps"
            description="Stretches of more than four days without a rate in the last 12 months. Figures in a gap use the rate before it."
          >
            {r.gaps.length === 0 ? (
              <p className="text-sm text-muted-foreground">No gaps in the last 12 months.</p>
            ) : (
              <ul className="grid gap-1 text-sm">
                {r.gaps.map((gap) => (
                  <li key={gap.from}>
                    <DateTime value={gap.from} /> – <DateTime value={gap.to} />{" "}
                    <span className="text-muted-foreground">({gap.days} days)</span>
                  </li>
                ))}
              </ul>
            )}
          </PageSection>
          <PageSection
            title="Job runs"
            description="The exchange-rate job's newest entries in the import log."
          >
            {r.jobRuns.length === 0 ? (
              <p className="text-sm text-muted-foreground">The job hasn't run yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm" aria-label="Job runs">
                  <thead>
                    <tr className={th}>
                      <th scope="col">Ran</th>
                      <th scope="col">Fetched</th>
                      <th scope="col" className="text-right">
                        Days
                      </th>
                      <th scope="col" className="text-right">
                        Rows
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.jobRuns.map((run) => {
                      const result = (run.result ?? {}) as JobResult;
                      return (
                        <tr key={run.id} className={td}>
                          <td>
                            <Link
                              to="/logs/$id"
                              params={{ id: String(run.id) }}
                              className="rounded-xs text-accent hover:underline focus-ring"
                            >
                              <DateTime value={run.at} format="datetime" />
                            </Link>
                          </td>
                          <td>
                            {result.from && result.to ? (
                              <>
                                <DateTime value={result.from} /> – <DateTime value={result.to} />
                              </>
                            ) : (
                              "–"
                            )}
                          </td>
                          <td className="num text-right">{formatNumber(result.days ?? null)}</td>
                          <td className="num text-right">{formatNumber(result.rows ?? null)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </PageSection>
        </>
      )}
    </DetailPage>
  );
}
