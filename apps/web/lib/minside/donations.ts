import "server-only";
import { cache } from "react";
import type { MainLocale } from "../../context/MainLocaleContext";
import type { DonationsData } from "../../components/profile/app/DonationsView";
import { apiFlavorFor, publicTrpcFor } from "../trpc/client";
import { toCauseArea, toOrganization } from "../trpc/causeAreas";
import { donorTrpc, verifySession } from "./dal";
import { builtMinsidePaths } from "./sanityPaths";

/**
 * Everything the donations page shows about the logged-in donor. Memoised per request, so the
 * page and its header slot (the mobile year menu) share one set of API calls.
 *
 * On our API the donor's queries go out as one batched request, next to the two public ones. The
 * Danish backend only gives distributions for given KIDs, so there they wait for the donations.
 *
 */
export const getDonationsData = cache(
  async (
    mainLocale: MainLocale,
    returnTo: string,
    _filterYear: string | null,
  ): Promise<DonationsData> => {
    const { donorId } = await verifySession(returnTo);
    const trpc = await donorTrpc(mainLocale);
    const site = publicTrpcFor(mainLocale);
    const onOurApi = apiFlavorFor(mainLocale) === "trpc";

    const donationsQuery = trpc.minside.donations.query({ donorId });
    const [donor, donations, aggregated, taxUnits, organizations, causeAreas, distributions] =
      await Promise.all([
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
    } as unknown as DonationsData;
  },
);

/** The error's code only: messages from the API or the REST backend can contain donor data */
export const errorCode = (error: unknown) =>
  (error as { data?: { code?: string } })?.data?.code ?? "UNKNOWN";

/** The visible path of the donations page, to come back to after a login */
export function visibleDonationsPath(filterYear: string | null) {
  const paths = builtMinsidePaths();
  const base = paths.donations ?? paths.dashboard;
  return "/" + [...base, ...(filterYear ? [filterYear] : [])].join("/");
}
