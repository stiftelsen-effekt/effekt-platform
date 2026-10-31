import type { BadgeTone } from "@/components/ui/badge";
import { formatNumber } from "@/lib/format";
import type { RouterOutputs } from "@/lib/trpc";
import type { AgreementType } from "./model";

export type InflationOverview = RouterOutputs["inflation"]["overview"];
export type EligibleRow = InflationOverview["eligible"][number];
export type UnsentRow = InflationOverview["unsent"][number];
export type OfferStatus = InflationOverview["statuses"][number]["status"];

/** The API's agreement type ("avtaleGiro") as the admin's provider ("avtalegiro") */
export const providerOf = (type: "avtaleGiro" | "vipps"): AgreementType =>
  type === "avtaleGiro" ? "avtalegiro" : "vipps";

export const offerStatuses: Record<OfferStatus, { label: string; tone: BadgeTone; hint: string }> =
  {
    new: { label: "Prepared", tone: "accent", hint: "Not emailed yet" },
    sending: {
      label: "Sending",
      tone: "warning",
      hint: "Being emailed. If this stays, the send stopped midway: check MailerSend before doing anything.",
    },
    pending: { label: "Awaiting answer", tone: "neutral", hint: "Emailed, open for 30 days" },
    accepted: { label: "Accepted", tone: "success", hint: "The agreement's amount was raised" },
    expired: { label: "Expired", tone: "outline", hint: "Not accepted in time" },
    cancelled: {
      label: "Cancelled",
      tone: "outline",
      hint: "Not sent: the agreement stopped or its amount changed after it was prepared",
    },
    failed: {
      label: "Failed",
      tone: "danger",
      hint: "The email couldn't be sent. The agreement gets a new offer next time offers are prepared.",
    },
    rejected: { label: "Rejected", tone: "outline", hint: "Not used" },
  };

export type SendProgress = {
  requested: number;
  sent: number;
  failed: number;
  cancelled: number;
  remaining: number;
  done: boolean;
  error?: unknown;
};

export type SendBatch = (batchSize: number) => Promise<{
  sent: number;
  failed: number;
  cancelled: number;
  remaining: number;
}>;

/**
 * Sends `requested` prepared offers in batches of at most `maxBatch` (one API call each, so
 * every call stays under the API's request timeout), pausing between batches. Stops when the
 * requested number is handled, nothing is left, a batch makes no progress, `shouldStop()` turns
 * true, or a call fails. Reports progress after every batch.
 */
export async function sendInBatches({
  requested,
  maxBatch,
  sendBatch,
  onProgress,
  shouldStop = () => false,
  pauseMs = 2000,
  sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
}: {
  requested: number;
  maxBatch: number;
  sendBatch: SendBatch;
  onProgress: (progress: SendProgress) => void;
  shouldStop?: () => boolean;
  pauseMs?: number;
  sleep?: (ms: number) => Promise<unknown>;
}): Promise<SendProgress> {
  const progress: SendProgress = {
    requested,
    sent: 0,
    failed: 0,
    cancelled: 0,
    remaining: requested,
    done: false,
  };
  const handled = () => progress.sent + progress.failed + progress.cancelled;
  try {
    while (handled() < requested && !shouldStop()) {
      if (handled() > 0) await sleep(pauseMs);
      const result = await sendBatch(Math.min(maxBatch, requested - handled()));
      progress.sent += result.sent;
      progress.failed += result.failed;
      progress.cancelled += result.cancelled;
      progress.remaining = result.remaining;
      onProgress({ ...progress });
      if (result.sent + result.failed + result.cancelled === 0 || result.remaining === 0) break;
    }
  } catch (error) {
    progress.error = error;
  }
  progress.done = true;
  onProgress({ ...progress });
  return progress;
}

/** "1 email", "12 emails" */
export const emails = (count: number) =>
  `${formatNumber(count)} ${count === 1 ? "email" : "emails"}`;

/** "1 offer", "12 offers" */
export const offers = (count: number) =>
  `${formatNumber(count)} ${count === 1 ? "offer" : "offers"}`;
