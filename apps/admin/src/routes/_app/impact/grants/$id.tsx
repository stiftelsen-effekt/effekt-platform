import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { LandmarkIcon } from "lucide-react";
import { EmptyState } from "@/components/domain/empty-state";
import { ErrorState } from "@/components/domain/error-state";
import { DateTime, Money, Num } from "@/components/domain/format";
import { Property, PropertyList } from "@/components/domain/property-list";
import { Stat, StatGroup } from "@/components/domain/stat";
import { useRecordParams } from "@/components/panels";
import { DetailPage, DetailPanel, PageSection } from "@/components/templates";
import { Badge } from "@/components/ui/badge";
import { Pending } from "@/components/ui/pending";
import { SkeletonText } from "@/components/ui/skeleton";
import {
  formatMonthRange,
  formatMonths,
  formatUsdCents,
  fundLabels,
} from "@/features/impact/model";
import { GrantSplit } from "@/features/impact/split";
import {
  CharityLink,
  CoverageStatus,
  GrantLink,
  SourceLinks,
  UsdCents,
} from "@/features/impact/ui";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";
import { loadPage } from "@/lib/route-data";
import { errorCode, useTRPC } from "@/lib/trpc";
import { osloCurrentMonth } from "@/features/impact/model";

export const Route = createFileRoute("/_app/impact/grants/$id")({
  loader: ({ context: { queryClient, trpc }, params, cause }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) return;
    return loadPage(queryClient, cause, trpc.impact.grants.get.queryOptions({ id }));
  },
  component: GrantRoute,
});

function GrantRoute() {
  const { id } = useRecordParams(Route);
  const grantId = Number(id);
  if (!Number.isInteger(grantId) || grantId <= 0)
    return (
      <EmptyState
        icon={LandmarkIcon}
        title="No such grant"
        description={`“${id}” isn't a grant ID.`}
        className="flex-1"
      />
    );
  return <GrantPage grantId={grantId} />;
}

const th = "text-left text-xs text-muted-foreground [&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold";
const td = "[&>td]:border-t [&>td]:border-border [&>td]:px-3 [&>td]:py-1.5 [&>td]:align-top";

function GrantPage({ grantId }: { grantId: number }) {
  const trpc = useTRPC();
  const query = useQuery(trpc.impact.grants.get.queryOptions({ id: grantId }));

  if (query.isError)
    return (
      <div className="p-6">
        <ErrorState
          back={{ to: "/impact/grants", label: "All fund grants" }}
          error={query.error}
          title={
            errorCode(query.error) === "NOT_FOUND"
              ? `No grant #${grantId}`
              : "Couldn't load the grant"
          }
          onRetry={() => void query.refetch()}
        />
      </div>
    );

  const g = query.data;
  const currentMonth = osloCurrentMonth();

  return (
    <DetailPage
      breadcrumbs={[{ label: "Fund grants", to: "/impact/grants" }]}
      title={
        g ? (
          `${fundLabels[g.fund]}, ${formatDate(g.validFrom, "month")}`
        ) : (
          <SkeletonText>Top Charities Fund, Feb 2025</SkeletonText>
        )
      }
      adornment={g && <CoverageStatus row={g} currentMonth={currentMonth} />}
      meta={
        g
          ? [
              <span key="range">{formatMonthRange(g.validFrom, g.validTo)}</span>,
              g.previousId && (
                <GrantLink key="prev" id={g.previousId}>
                  Previous grant
                </GrantLink>
              ),
              g.nextId && (
                <GrantLink key="next" id={g.nextId}>
                  Next grant
                </GrantLink>
              ),
            ]
          : [<SkeletonText key="range">From Feb 2025</SkeletonText>]
      }
      stats={
        <StatGroup>
          <Stat
            label="Granted"
            pending={!g}
            placeholder="0 000 000,00 USD"
            value={g && formatUsdCents(g.totalCents, { decimals: 0 })}
          />
          <Stat
            label="Allotments"
            pending={!g}
            placeholder="00"
            value={g && <Num value={g.allotments.length} />}
          />
          <Stat
            label="Applies to"
            pending={!g}
            placeholder="00 months"
            value={g && formatMonths(g.monthsApplied)}
            hint={g && (g.validTo === null ? "so far" : `until ${formatDate(g.validTo, "month")}`)}
          />
        </StatGroup>
      }
      aside={
        <DetailPanel title="Grant">
          {!g ? (
            <PropertyList labelWidth="8rem">
              <Property label="Fund" pending placeholder="Top Charities Fund" />
              <Property label="Grant ID" pending placeholder="00" />
              <Property label="ID in the old API" pending placeholder="00" />
              <Property label="Created" pending placeholder="00.00.0000" />
            </PropertyList>
          ) : (
            <PropertyList labelWidth="8rem">
              <Property label="Fund">
                <Badge>{g.fund}</Badge> {fundLabels[g.fund]}
              </Property>
              <Property label="Grant ID">
                <span className="num">{g.id}</span>
              </Property>
              <Property label="ID in the old API">
                <span className="num">{g.legacyId ?? "–"}</span>
              </Property>
              <Property label="Created">
                <DateTime value={g.createdAt} /> · {g.createdBy}
              </Property>
              {g.updatedAt && (
                <Property label="Last changed">
                  <DateTime value={g.updatedAt} /> · {g.updatedBy}
                </Property>
              )}
            </PropertyList>
          )}
        </DetailPanel>
      }
    >
      {!g ? (
        <Pending className="min-h-96" label="Loading the grant" />
      ) : (
        <>
          <PageSection
            title="Split"
            description={
              g.fund === "TCF"
                ? "Each charity's share of the grant: a donation to the fund in these months is split the same way."
                : "Each charity's share of the grant. All Grants Fund donations show no estimate yet."
            }
          >
            <GrantSplit parts={g.allotments} />
          </PageSection>
          <PageSection
            title="Allotments"
            description="Cost per output is the allotment's sum divided by the outputs it buys."
          >
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm" aria-label="Allotments">
                <thead>
                  <tr className={th}>
                    <th scope="col">Charity</th>
                    <th scope="col">Intervention</th>
                    <th scope="col" className="text-right">
                      Sum
                    </th>
                    <th scope="col" className="text-right">
                      Share
                    </th>
                    <th scope="col" className="text-right">
                      Outputs bought
                    </th>
                    <th scope="col" className="text-right">
                      Cost per output
                    </th>
                    <th scope="col" className="text-right">
                      In NOK today
                    </th>
                    <th scope="col">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {g.allotments.map((a) => (
                    <tr key={a.id} className={td}>
                      <td className="font-semibold">
                        <CharityLink charityId={a.charityId}>{a.charityName}</CharityLink>
                      </td>
                      <td>{a.interventionName}</td>
                      <td className="text-right">
                        <UsdCents value={a.sumInCents} />
                      </td>
                      <td className="num text-right">{formatPercent(a.share)}</td>
                      <td className="num text-right">
                        {formatNumber(a.numberOutputsPurchased)}
                        {(a.numberOutputsPurchasedLowerBound > 0 ||
                          a.numberOutputsPurchasedUpperBound !== null) && (
                          <div className="text-xs text-muted-foreground">
                            {formatNumber(a.numberOutputsPurchasedLowerBound)} –{" "}
                            {formatNumber(a.numberOutputsPurchasedUpperBound)}
                          </div>
                        )}
                      </td>
                      <td className="text-right">
                        <UsdCents value={a.centsPerOutput} />
                      </td>
                      <td className="text-right">
                        <Money value={a.costPerOutputNok} />
                      </td>
                      <td className="max-w-64">
                        <SourceLinks name={a.sourceName} url={a.sourceUrl} truncate />
                        {a.comment && (
                          <div className="truncate text-xs text-muted-foreground" title={a.comment}>
                            {a.comment}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </PageSection>
        </>
      )}
    </DetailPage>
  );
}
