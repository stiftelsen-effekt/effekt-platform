import "server-only";
import { cache } from "react";
import type { MainLocale } from "../../context/MainLocaleContext";
import type { Distribution, Donation, TaxUnit, TaxYearlyReport } from "../../models";
import { apiFlavorFor } from "../trpc/client";
import { donorTrpc, verifySession } from "./dal";

export type TaxData = {
  donorId: number;
  taxUnits: TaxUnit[];
  /** For the yearly reports tab only (our API; the Danish site has no yearly reports) */
  reports?: { reports: TaxYearlyReport[]; donations: Donation[]; distributions: Distribution[] };
};

/**
 * What the tax page's tab shows, for the logged-in donor: the tax units always (the tabs' tax unit
 * dialogs need them), the yearly reports with the donations and distributions they list when that
 * tab is open. One batched request on our API. Memoised per request.
 */
export const getTaxData = cache(
  async (mainLocale: MainLocale, withReports: boolean, returnTo: string): Promise<TaxData> => {
    const { donorId } = await verifySession(returnTo);
    const trpc = await donorTrpc(mainLocale);
    const reportsAvailable = withReports && apiFlavorFor(mainLocale) === "trpc";

    const [taxUnits, reports] = await Promise.all([
      trpc.minside.taxUnits.query({ donorId }),
      reportsAvailable
        ? Promise.all([
            trpc.minside.taxReports.query({ donorId }),
            trpc.minside.donations.query({ donorId }),
            trpc.minside.distributions.query({ donorId }),
          ])
        : null,
    ]);
    return {
      donorId,
      taxUnits,
      reports: reports
        ? { reports: reports[0], donations: reports[1], distributions: reports[2] }
        : undefined,
    } as unknown as TaxData;
  },
);
