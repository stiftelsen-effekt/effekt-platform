/**
 * Gift cards (gavekort): the list's URL state and its translation into the `giftcards.list`
 * filter, the status shown for a row, and the reschedule form's Oslo date and time.
 */
import { defineList, param, type FilterValues } from "@/components/filters";
import { osloDay, osloInstant, osloTime } from "@/lib/dates";
import type { GiftcardStatus } from "@/lib/status";
import type { RouterInputs, RouterOutputs } from "@/lib/trpc";

export type GiftcardListRow = RouterOutputs["giftcards"]["list"]["rows"][number];
export type Giftcard = RouterOutputs["giftcards"]["get"];
export type GiftcardApiFilter = NonNullable<RouterInputs["giftcards"]["list"]["filter"]>;
type ApiStatus = GiftcardListRow["status"];

/** The status filter's options, in lifecycle order. `paid` covers SMS waiting and PDF paid */
export const giftcardFilterStatuses = [
  "pending",
  "paid",
  "sending",
  "sent",
  "failed",
  "cancelled",
] as const satisfies readonly ApiStatus[];

export const giftcardFilterStatusLabels: Record<ApiStatus, string> = {
  pending: "Not paid",
  paid: "Paid / waiting to send",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const giftcardDeliveries = ["sms", "pdf"] as const;
export const deliveryLabel: Record<(typeof giftcardDeliveries)[number], string> = {
  sms: "SMS",
  pdf: "PDF",
};

export const giftcardsList = defineList({
  id: "giftcards",
  filters: {
    /** Recipient, sender or buyer name, buyer email; all digits also a KID */
    q: param.text,
    status: param.list(giftcardFilterStatuses),
    delivery: param.list(giftcardDeliveries),
    /** Product slugs */
    product: {
      decode: (raw: unknown) => {
        const values = (typeof raw === "string" ? raw : "")
          .split(",")
          .filter((v) => /^[a-z0-9-]{1,64}$/.test(v));
        return values.length ? values : undefined;
      },
      encode: (value: string[] | undefined) => (value?.length ? value.join(",") : undefined),
    },
  },
  sortable: ["sendAt", "created", "amount"],
  defaultSort: { id: "created", desc: true },
});

export type GiftcardListFilters = FilterValues<typeof giftcardsList.filters>;

/** URL filters → giftcards.list filter, leaving out what isn't set */
export function toGiftcardFilter(filters: GiftcardListFilters): GiftcardApiFilter {
  const filter: GiftcardApiFilter = {
    statuses: filters.status?.length ? filters.status : undefined,
    deliveries: filters.delivery?.length ? filters.delivery : undefined,
    products: filters.product?.length ? filters.product : undefined,
    search: filters.q?.trim() || undefined,
  };
  return Object.fromEntries(
    Object.entries(filter).filter(([, value]) => value !== undefined),
  ) as GiftcardApiFilter;
}

/** The status to show: a paid SMS gift card is waiting for its send time */
export function displayStatus(giftcard: {
  status: ApiStatus;
  delivery: GiftcardListRow["delivery"];
}): GiftcardStatus {
  return giftcard.status === "paid" && giftcard.delivery === "sms" ? "waiting" : giftcard.status;
}

/** What an admin may do with a gift card, from its status (the API checks again) */
export function giftcardActions(giftcard: {
  status: ApiStatus;
  delivery: GiftcardListRow["delivery"];
}) {
  const unsent = giftcard.status === "pending" || giftcard.status === "paid";
  return {
    retry: giftcard.status === "failed" && giftcard.delivery === "sms",
    reschedule: unsent && giftcard.delivery === "sms",
    cancel: unsent,
  };
}

/** A send time as the form's Oslo date (YYYY-MM-DD) and time (HH:mm) */
export function toSendAtInputs(value: string | null) {
  if (!value) return { date: "", time: "16:00" };
  const date = new Date(value);
  return { date: osloDay(date), time: osloTime(date) };
}

/** Days ahead a send time may be (as the API: registration's limit) */
const MAX_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;

/**
 * The form's Oslo date and time as an ISO instant, or an error: it must be in the future and
 * within a year, as the API checks.
 */
export function parseSendAt(
  date: string,
  time: string,
  now: Date = new Date(),
): { sendAt: string } | { error: string } {
  if (!date || !/^\d{2}:\d{2}$/.test(time)) return { error: "Enter a date and a time" };
  const instant = osloInstant(date, time);
  if (!instant) return { error: "Enter a date and a time" };
  const ahead = instant.getTime() - now.getTime();
  if (ahead <= 0) return { error: "Pick a time in the future" };
  if (ahead > MAX_AHEAD_MS) return { error: "Pick a time within a year" };
  return { sendAt: instant.toISOString() };
}
