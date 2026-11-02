import "server-only";
import { cache } from "react";
import type { MainLocale } from "../../context/MainLocaleContext";
import type { DonationsData } from "../../components/profile/app/DonationsView";
import { apiFlavorFor, isProcedureAvailable, publicTrpcFor } from "../trpc/client";
import { toCauseArea, toOrganization } from "../trpc/causeAreas";
import { donorTrpc, verifySession } from "./dal";
import { builtMinsidePaths } from "./sanityPaths";
import { agfPeriods } from "../../components/profile/donations/LivesSaved/livesSaved";

/**
 * Everything the donations page shows about the logged-in donor. Memoised per request, so the
 * page and its header slot (the mobile year menu) share one set of API calls.
 *
 * On our API the donor's queries go out as one batched request, next to the two public ones. The
 * Danish backend only gives distributions for given KIDs, so there they wait for the donations.
 *
 * The donation status (where each donation is) is part of the same batch, for the year shown
 * (all years: the newest donations). The API keeps its regranting map in memory, so it adds a few
 * milliseconds. The Danish backend has no such route: there, and if the call fails, it is null and
 * the donations show as received only.
 *
 * The All Grants Fund's portfolio (minside.agfPortfolio, the same for every donor) also goes in
 * the batch, so its panel opens without a request. Not on the Danish backend, or after a failure:
 * null, and the All Grants Fund row stays a plain amount.
 */
export const getDonationsData = cache(
  async (
    mainLocale: MainLocale,
    returnTo: string,
    filterYear: string | null,
  ): Promise<DonationsData> => {
    const { donorId } = await verifySession(returnTo);
    const trpc = await donorTrpc(mainLocale);
    const site = publicTrpcFor(mainLocale);
    const onOurApi = apiFlavorFor(mainLocale) === "trpc";

    const donationsQuery = trpc.minside.donations.query({ donorId });
    const year = filterYear && /^\d{4}$/.test(filterYear) ? Number(filterYear) : undefined;
    const statusQuery = isProcedureAvailable(mainLocale, "minside.donationStatus")
      ? trpc.minside.donationStatus.query({ donorId, year }).catch((error: unknown) => {
          console.error(`Min Side donations: status failed (${errorCode(error)})`);
          return null;
        })
      : Promise.resolve(null);
    const agfPortfolioQuery = isProcedureAvailable(mainLocale, "minside.agfPortfolio")
      ? trpc.minside.agfPortfolio.query({ donorId }).catch((error: unknown) => {
          console.error(`Min Side donations: AGF portfolio failed (${errorCode(error)})`);
          return null;
        })
      : Promise.resolve(null);
    const [
      donor,
      donations,
      aggregated,
      taxUnits,
      organizations,
      causeAreas,
      distributions,
      donationStatus,
      agfPortfolio,
    ] = await Promise.all([
      trpc.minside.profile.query({ donorId }),
      donationsQuery,
      trpc.minside.donationsAggregated.query({ donorId }),
      trpc.minside.taxUnits.query({ donorId }),
      site.site.organizations.query(),
      site.widget.causeAreas.query(),
      onOurApi
        ? trpc.minside.distributions.query({ donorId })
        : donationsQuery.then((list) => {
            const kids = Array.from(new Set(list.map((d) => d.KID)));
            return kids.length ? trpc.minside.distributions.query({ donorId, kids }) : [];
          }),
      statusQuery,
      agfPortfolioQuery,
    ]);

    return {
      donorId,
      donor,
      donations,
      aggregated,
      taxUnits,
      organizations: organizations.map(toOrganization),
      causeAreas: causeAreas.map(toCauseArea),
      distributions,
      // Disabled (no regranting in this database, e.g. Sweden) is shown like Denmark
      donationStatus: donationStatus?.enabled ? donationStatus : null,
      // Only the years the donor's All Grants Fund gifts are shown with (none: no panel)
      agfPortfolio: agfPortfolioFor(agfPortfolio, donations),
    } as unknown as DonationsData;
  },
);

/** The portfolio years the donor's All Grants Fund gifts map to; null when there are none */
function agfPortfolioFor(
  portfolio: DonationsData["agfPortfolio"],
  donations: DonationsData["donations"],
): DonationsData["agfPortfolio"] {
  if (!portfolio) return null;
  const used = new Set(agfPeriods(donations, portfolio.years).map((p) => p.year.metricsYear));
  return used.size ? { years: portfolio.years.filter((y) => used.has(y.metricsYear)) } : null;
}

/** The error's code only: messages from the API or the REST backend can contain donor data */
export const errorCode = (error: unknown) =>
  (error as { data?: { code?: string } })?.data?.code ?? "UNKNOWN";

/** The visible path of the donations page, to come back to after a login */
export function visibleDonationsPath(filterYear: string | null) {
  const paths = builtMinsidePaths();
  const base = paths.donations ?? paths.dashboard;
  return "/" + [...base, ...(filterYear ? [filterYear] : [])].join("/");
}
