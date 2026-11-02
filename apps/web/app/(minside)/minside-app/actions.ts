"use server";

import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { auth0 } from "../../../lib/auth0";
import { getMinsideFrame } from "../../../lib/minside/content";
import { donorTrpc, verifySession } from "../../../lib/minside/dal";
import {
  addStoppedAgreementFeedback,
  cancelDKAgreement,
  deleteStoppedAgreementFeedback,
  updateDKAgreement,
} from "../../../components/profile/shared/lists/agreementList/_queries";
import type { AgreementTypes } from "../../../components/profile/shared/lists/agreementList/AgreementList";
import type { Distribution } from "../../../models";

/**
 * Min Side's Server Actions: every change a donor makes. Each one is a public endpoint, so each
 * checks the session itself (verifySession), never trusts a donor id from the browser beyond
 * comparing it with the session's, and calls the API with the session's token (the API checks it
 * again). Next.js only runs an action when the request's Origin matches the Host.
 *
 * After a change the page is refreshed (`refresh`), so it shows the API's new data.
 */

/** The donor-facing tRPC mutations the browser may run, through minsideMutation */
const MUTATIONS = new Set([
  "minside.updateProfile",
  "minside.createTaxUnit",
  "minside.updateTaxUnit",
  "minside.deleteTaxUnit",
  "minside.cancelVippsAgreement",
  "minside.updateVippsAgreementPrice",
  "minside.updateVippsAgreementChargeDay",
  "minside.updateVippsAgreementDistribution",
  "minside.updateAvtaleGiroAmount",
  "minside.updateAvtaleGiroPaymentDate",
  "minside.updateAvtaleGiroDistribution",
  "minside.cancelAvtaleGiroAgreement",
]);

export type MutationResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; httpStatus: number; message: string } };

/**
 * Runs one of the MUTATIONS for the logged-in donor. The browser's tRPC client sends its mutations
 * here (lib/trpc/serverActionLink.ts), so the components keep their tRPC calls and the token stays
 * on the server.
 */
export async function minsideMutation(path: string, input: unknown): Promise<MutationResult> {
  if (!MUTATIONS.has(path)) {
    return failure("NOT_FOUND", 404, `${path} is not available`);
  }
  const { donorId } = await verifySession();
  const inputDonorId = (input as { donorId?: unknown } | null)?.donorId;
  if (inputDonorId !== donorId) {
    return failure("FORBIDDEN", 403, "Not the logged-in donor");
  }
  const { mainLocale } = await getMinsideFrame();
  const trpc = await donorTrpc(mainLocale);
  const [router, procedure] = path.split(".") as ["minside", string];
  try {
    const call = (trpc[router] as unknown as Record<string, { mutate: (i: unknown) => unknown }>)[
      procedure
    ];
    const data = await call.mutate(input);
    refresh();
    return { ok: true, data };
  } catch (error) {
    unstable_rethrow(error);
    const data = (error as { data?: { code?: string; httpStatus?: number } }).data;
    // Not logged: the message can contain the donor's input
    return failure(
      data?.code ?? "INTERNAL_SERVER_ERROR",
      data?.httpStatus ?? 500,
      (error as Error).message,
    );
  }
}

const failure = (code: string, httpStatus: number, message: string): MutationResult => ({
  ok: false,
  error: { code, httpStatus, message },
});

/** The session's access token, for the REST calls below (the proxy keeps it fresh) */
const sessionToken = async () => (await auth0.getAccessToken()).token;

/** The Danish site: changes an agreement through the Danish backend's REST route */
export async function updateDKAgreementAction(
  agreementId: string,
  distribution: Distribution | null,
  chargeDay: number | null,
  amount: number | null,
) {
  const { donorId } = await verifySession();
  const result = await updateDKAgreement(
    donorId,
    agreementId,
    distribution,
    chargeDay,
    amount,
    await sessionToken(),
  );
  refresh();
  return result;
}

/** The Danish site: stops an agreement */
export async function cancelDKAgreementAction(agreementId: string) {
  const { donorId } = await verifySession();
  const result = await cancelDKAgreement(donorId, agreementId, await sessionToken());
  refresh();
  return result;
}

/** Why the donor stopped an agreement (the API checks the KID is the donor's) */
export async function addStoppedAgreementFeedbackAction(
  agreementId: string,
  KID: string,
  agreementType: AgreementTypes,
  reasonId: number,
  otherComment: string | undefined,
) {
  await verifySession();
  return addStoppedAgreementFeedback(
    agreementId,
    KID,
    agreementType,
    reasonId,
    otherComment,
    await sessionToken(),
  );
}

export async function deleteStoppedAgreementFeedbackAction(feedbackId: string, KID: string) {
  await verifySession();
  return deleteStoppedAgreementFeedback(feedbackId, KID, await sessionToken());
}
