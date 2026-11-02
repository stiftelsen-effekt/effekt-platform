import "server-only";
import { cache } from "react";
import type { MainLocale } from "../../context/MainLocaleContext";
import type {
  AvtaleGiroAgreement,
  DKAgreement,
  Distribution,
  TaxUnit,
  VippsAgreement,
} from "../../models";
import { auth0 } from "../auth0";
import { apiFlavorFor, publicTrpcFor } from "../trpc/client";
import { toCauseArea } from "../trpc/causeAreas";
import type { CauseArea } from "../../components/shared/components/Widget/types/CauseArea";
import type { AgreementFeedbackType } from "../../context/MinsideSessionContext";
import { donorTrpc, verifySession } from "./dal";
import { builtMinsidePaths } from "./sanityPaths";

export type AgreementsData = {
  donorId: number;
  taxUnits: TaxUnit[];
  distributions: Distribution[];
  /** For editing an agreement's distribution */
  causeAreas: CauseArea[];
  /** The reasons for stopping an agreement (our API only) */
  agreementFeedbackTypes?: AgreementFeedbackType[];
} & (
  | { site: "nordic"; vipps: VippsAgreement[]; avtaleGiro: AvtaleGiroAgreement[] }
  | { site: "dk"; dkAgreements: DKAgreement[] }
);

/**
 * The logged-in donor's agreements, with their distributions and tax units. Memoised per request
 * (the page and its header slot share it).
 *
 * Our API: the agreement lists, all of the donor's distributions and the tax units go out together
 * in one batched request. The Danish backend: its own agreements route (REST, not in the tRPC
 * contract), then the distributions for those KIDs.
 */
export const getAgreementsData = cache(async (mainLocale: MainLocale): Promise<AgreementsData> => {
  const { donorId } = await verifySession(visibleAgreementsPath());
  const trpc = await donorTrpc(mainLocale);

  const causeAreasQuery = publicTrpcFor(mainLocale)
    .widget.causeAreas.query()
    .then((areas) => areas.map(toCauseArea));

  if (apiFlavorFor(mainLocale) === "trpc") {
    const [vipps, avtaleGiro, distributions, taxUnits, causeAreas, agreementFeedbackTypes] =
      await Promise.all([
        trpc.minside.vippsAgreements.query({ donorId }),
        trpc.minside.avtaleGiroAgreements.query({ donorId }),
        trpc.minside.distributions.query({ donorId }).catch(() => []),
        trpc.minside.taxUnits.query({ donorId }),
        causeAreasQuery,
        fetchAgreementFeedbackTypes().catch(() => undefined),
      ]);
    return {
      site: "nordic",
      donorId,
      vipps,
      avtaleGiro,
      distributions,
      taxUnits,
      causeAreas,
      agreementFeedbackTypes,
    } as unknown as AgreementsData;
  }

  const [dkAgreements, taxUnits, causeAreas] = await Promise.all([
    fetchDKAgreements(donorId),
    trpc.minside.taxUnits.query({ donorId }),
    causeAreasQuery,
  ]);
  const kids = Array.from(new Set(dkAgreements.map((agreement) => agreement.kid)));
  const distributions = kids.length
    ? await trpc.minside.distributions.query({ donorId, kids }).catch(() => [])
    : [];
  return {
    site: "dk",
    donorId,
    dkAgreements,
    distributions,
    taxUnits,
    causeAreas,
  } as unknown as AgreementsData;
});

/** The Danish backend's agreements (GET /donors/:id/recurring/, as useDKAgreements called it) */
async function fetchDKAgreements(donorId: number): Promise<DKAgreement[]> {
  const api = process.env.NEXT_PUBLIC_EFFEKT_API;
  const { token } = await auth0.getAccessToken();
  const response = await fetch(`${api}/donors/${donorId}/recurring/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw Object.assign(new Error("Danish agreements failed"), {
      data: { code: `HTTP_${response.status}`, httpStatus: response.status },
    });
  }
  return (await response.json()).content as DKAgreement[];
}

/** The reasons a donor can give for stopping an agreement (public REST, our API) */
async function fetchAgreementFeedbackTypes(): Promise<AgreementFeedbackType[]> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_EFFEKT_API}/agreementfeedback/types`);
  if (!response.ok) {
    throw Object.assign(new Error("Agreement feedback types failed"), {
      data: { code: `HTTP_${response.status}`, httpStatus: response.status },
    });
  }
  return (await response.json()).content as AgreementFeedbackType[];
}

/** The visible path of the agreements page, to come back to after a login */
export function visibleAgreementsPath() {
  const paths = builtMinsidePaths();
  return "/" + (paths.agreements ?? paths.dashboard).join("/");
}
