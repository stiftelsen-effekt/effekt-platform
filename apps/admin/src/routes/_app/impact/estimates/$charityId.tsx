import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { HeartPulseIcon } from "lucide-react";
import { Callout } from "@/components/domain/callout";
import { EmptyState } from "@/components/domain/empty-state";
import { ErrorState } from "@/components/domain/error-state";
import { DateTime, Money, Num } from "@/components/domain/format";
import { Stat, StatGroup } from "@/components/domain/stat";
import { useRecordParams } from "@/components/panels";
import { DetailPage, PageSection } from "@/components/templates";
import { Badge } from "@/components/ui/badge";
import { Pending } from "@/components/ui/pending";
import { SkeletonText } from "@/components/ui/skeleton";
import { EstimateTimeline } from "@/features/impact/timeline";
import { formatMonthRange, formatMonths, formatUsdCents } from "@/features/impact/model";
import { CoverageStatus, SourceLinks, UsdCents } from "@/features/impact/ui";
import { formatDate } from "@/lib/format";
import { loadPage } from "@/lib/route-data";
import { errorCode, useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_app/impact/estimates/$charityId")({
  loader: ({ context: { queryClient, trpc }, params, cause }) => {
    const charityId = Number(params.charityId);
    if (!Number.isInteger(charityId) || charityId <= 0) return;
    return loadPage(queryClient, cause, trpc.impact.estimates.charity.queryOptions({ charityId }));
  },
  component: CharityRoute,
});

function CharityRoute() {
  const { charityId } = useRecordParams(Route);
  const id = Number(charityId);
  if (!Number.isInteger(id) || id <= 0)
    return (
      <EmptyState
        icon={HeartPulseIcon}
        title="No such charity"
        description={`“${charityId}” isn't a charity ID.`}
        className="flex-1"
      />
    );
  return <CharityEstimatesPage charityId={id} />;
}

const th = "text-left text-xs text-muted-foreground [&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold";
const td = "[&>td]:border-t [&>td]:border-border [&>td]:px-3 [&>td]:py-1.5 [&>td]:align-top";

function CharityEstimatesPage({ charityId }: { charityId: number }) {
  const trpc = useTRPC();
  const query = useQuery(trpc.impact.estimates.charity.queryOptions({ charityId }));

  if (query.isError)
    return (
      <div className="p-6">
        <ErrorState
          back={{ to: "/impact/estimates", label: "All cost estimates" }}
          error={query.error}
          title={
            errorCode(query.error) === "NOT_FOUND"
              ? `No charity #${charityId}`
              : "Couldn't load the estimates"
          }
          onRetry={() => void query.refetch()}
        />
      </div>
    );

  const page = query.data;
  const charity = page?.charity;
  const current = page?.estimates.find((e) => e.current) ?? null;
  const first = page?.estimates[0];

  return (
    <DetailPage
      breadcrumbs={[{ label: "Cost estimates", to: "/impact/estimates" }]}
      title={charity?.name ?? <SkeletonText>Against Malaria Foundation</SkeletonText>}
      adornment={charity && <Badge>{charity.abbreviation}</Badge>}
      meta={
        charity
          ? [
              charity.organizationName ? (
                <span key="org">Donations to {charity.organizationName}</span>
              ) : (
                <span key="org">Not linked to an organization</span>
              ),
              <span key="id" className="num">
                Charity ID {charity.id}
              </span>,
            ]
          : [<SkeletonText key="org">Donations to Against Malaria Foundation</SkeletonText>]
      }
      stats={
        <StatGroup>
          <Stat
            label="Cost per output now"
            pending={!page}
            placeholder="0,00 USD"
            value={page && (current ? formatUsdCents(current.centsPerOutput) : "–")}
            hint={page && (current ? current.interventionName : "No estimate applies")}
          />
          <Stat
            label="In NOK today"
            pending={!page}
            placeholder="00,00 kr"
            value={page && <Money value={current?.costPerOutputNok ?? null} precision="exact" />}
            hint={
              page &&
              (page.nokRate
                ? `${formatDate(page.nokRate.date)} rate, ${page.nokRate.perUsd.toFixed(4).replace(".", ",")} per USD`
                : "No NOK rate stored")
            }
          />
          <Stat
            label="In effect since"
            pending={!page}
            placeholder="Jan 2023"
            value={page && (current ? formatDate(current.validFrom, "month") : "–")}
            hint={page && current && formatMonths(current.monthsApplied)}
          />
          <Stat
            label="Estimates"
            pending={!page}
            placeholder="00"
            value={page && <Num value={page.estimates.length} />}
            hint={page && first && `Since ${formatDate(first.validFrom, "month")}`}
          />
        </StatGroup>
      }
    >
      {!page ? (
        <Pending className="min-h-96" label="Loading the estimates" />
      ) : (
        <>
          {!page.charity.organizationId && (
            <Callout tone="warning" title="Not linked to one of our organizations">
              Donations can't use these estimates until the charity is linked to an organization
              (Impact › Charities & interventions).
            </Callout>
          )}
          <PageSection
            title="Timeline"
            description={
              first
                ? `Each estimate applies from its month until the next one. Donations before ${formatDate(first.validFrom, "month")} have no estimate.`
                : "No estimates yet: donations to this charity show no impact."
            }
          >
            {page.estimates.length > 0 && (
              <>
                <EstimateTimeline estimates={page.estimates} currentMonth={page.currentMonth} />
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-sm" aria-label="Estimates">
                    <thead>
                      <tr className={th}>
                        <th scope="col">Applies to</th>
                        <th scope="col">Status</th>
                        <th scope="col">Intervention</th>
                        <th scope="col" className="text-right">
                          Cost per output
                        </th>
                        <th scope="col" className="text-right">
                          Range
                        </th>
                        <th scope="col" className="text-right">
                          In NOK today
                        </th>
                        <th scope="col">Source</th>
                        <th scope="col">Last changed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...page.estimates].reverse().map((e) => (
                        <tr key={e.id} className={td}>
                          <td className="whitespace-nowrap">
                            <div>{formatMonthRange(e.validFrom, e.validTo)}</div>
                            <div className="text-xs text-muted-foreground">
                              {formatMonths(e.monthsApplied)}
                              {e.validTo === null && " so far"}
                            </div>
                          </td>
                          <td>
                            <CoverageStatus row={e} currentMonth={page.currentMonth} />
                          </td>
                          <td>{e.interventionName}</td>
                          <td className="text-right font-semibold">
                            <UsdCents value={e.centsPerOutput} />
                          </td>
                          <td className="text-right text-muted-foreground">
                            {e.centsPerOutputLowerBound > 0 ||
                            e.centsPerOutputUpperBound !== null ? (
                              <span className="num whitespace-nowrap">
                                {formatUsdCents(e.centsPerOutputLowerBound)} –{" "}
                                {formatUsdCents(e.centsPerOutputUpperBound)}
                              </span>
                            ) : (
                              "–"
                            )}
                          </td>
                          <td className="text-right">
                            <Money value={e.costPerOutputNok} />
                          </td>
                          <td className="max-w-80">
                            <SourceLinks name={e.sourceName} url={e.sourceUrl} truncate />
                            {e.comment && (
                              <div
                                className="truncate text-xs text-muted-foreground"
                                title={e.comment}
                              >
                                {e.comment}
                              </div>
                            )}
                          </td>
                          <td className="text-muted-foreground">
                            <DateTime value={e.updatedAt ?? e.createdAt} />
                            <div className="max-w-40 truncate text-xs">
                              {e.updatedBy ?? e.createdBy}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </PageSection>
        </>
      )}
    </DetailPage>
  );
}
