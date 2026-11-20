import { DateTime } from "luxon";
import { GIFTCARD_MESSAGE_MAX, giftcardMessageLength } from "@effekt/api/giftcard";

/**
 * Pure helpers for the gift card widget: the total, the greeting counter, phone numbers and the
 * SMS send time, which people pick in Oslo time and the API takes as an ISO instant.
 */

export const OSLO_ZONE = "Europe/Oslo";

export type GiftcardDelivery = "sms" | "pdf";

/** units × price per unit, in whole øre */
export const giftcardTotal = (units: number | null, unitPrice: number): number =>
  units && units > 0 ? Math.round(units * unitPrice * 100) / 100 : 0;

export type MessageCount = { count: number; max: number; over: boolean; nearLimit: boolean };

/** Characters as people count them (emoji are one), against GIFTCARD_MESSAGE_MAX */
export const countMessage = (message: string, max = GIFTCARD_MESSAGE_MAX): MessageCount => {
  const count = giftcardMessageLength(message);
  return { count, max, over: count > max, nearLimit: count >= max * 0.9 };
};

/** Cuts a greeting to `max` characters without splitting an emoji */
export const clampMessage = (message: string, max = GIFTCARD_MESSAGE_MAX): string =>
  giftcardMessageLength(message) <= max ? message : Array.from(message).slice(0, max).join("");

/** The same rule as the API: 8 digits starting with 4 or 9, optionally +47 or 0047 first */
export const isNorwegianMobile = (phone: string): boolean =>
  /^(?:\+47|0047)?[49]\d{7}$/.test(phone.replace(/[\s\-().]/g, ""));

/** "2026-12-24" and "16:00" in Oslo time as an ISO instant with offset, or null if invalid */
export const osloDateTimeToIso = (date: string, time: string): string | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const dt = DateTime.fromISO(`${date}T${time}`, { zone: OSLO_ZONE });
  return dt.isValid ? dt.toISO({ suppressMilliseconds: true }) : null;
};

/** Christmas Eve when it is ahead and less than two months away (Oslo), otherwise tomorrow */
export const defaultSendDate = (now: Date = new Date()): string => {
  const today = DateTime.fromJSDate(now).setZone(OSLO_ZONE).startOf("day");
  const christmasEve = today.set({ month: 12, day: 24 });
  const soon = christmasEve > today && christmasEve.diff(today, "days").days <= 60;
  return (soon ? christmasEve : today.plus({ days: 1 })).toISODate()!;
};

export const DEFAULT_SEND_TIME = "16:00";

/** Today's date in Oslo (YYYY-MM-DD), the earliest the date picker allows */
export const osloToday = (now: Date = new Date()): string =>
  DateTime.fromJSDate(now).setZone(OSLO_ZONE).toISODate()!;

/** Whether the picked time is still ahead (with a minute of slack) */
export const isSendTimeAhead = (iso: string | null, now: Date = new Date()): boolean =>
  iso !== null && DateTime.fromISO(iso).toMillis() > now.getTime() - 60_000;

/** "24.12.2026 kl. 16:00" in Oslo time */
export const formatOsloDateTime = (iso: string): string =>
  DateTime.fromISO(iso).setZone(OSLO_ZONE).toFormat("dd.LL.yyyy 'kl.' HH:mm");

/** Replaces {units} */
export const presetLabel = (template: string | null | undefined, units: number): string =>
  (template || "{units}").replace(/\{units\}/g, String(units));

/** Replaces [dato] and [mottaker] in Sanity texts */
export const fillGiftcardText = (
  text: string | null | undefined,
  values: { dato?: string | null; mottaker?: string | null },
): string =>
  (text ?? "")
    .replace(/\[dato\]/g, values.dato ?? "")
    .replace(/\[mottaker\]/g, values.mottaker ?? "")
    .trim();

/** "1 234 kr" (no decimals unless there are øre) */
export const formatKroner = (amount: number): string =>
  `${new Intl.NumberFormat("nb-NO", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount)} kr`;

export type GiftcardFormState = {
  delivery: GiftcardDelivery;
  units: number | null;
  recipientName: string;
  message: string;
  senderName: string;
  recipientPhone: string;
  sendDate: string;
  sendTime: string;
  email: string;
  name: string;
  taxDeduction: boolean;
  ssn: string;
  newsletter: boolean;
  method: "vipps" | "bank";
};

/** Problems with a step's fields (key → message), empty when the step can continue */
export const validateStep = (
  step: "amount" | "message" | "delivery",
  form: GiftcardFormState,
  limits: { minUnits: number; maxUnits: number },
  now: Date = new Date(),
): Record<string, string> => {
  const errors: Record<string, string> = {};
  if (step === "amount") {
    if (!form.units || form.units < limits.minUnits || form.units > limits.maxUnits) {
      errors.units = `Velg mellom ${limits.minUnits} og ${limits.maxUnits}`;
    }
  }
  if (step === "message") {
    if (!form.recipientName.trim()) errors.recipientName = "Skriv inn navnet på mottakeren";
    if (!form.senderName.trim()) errors.senderName = "Skriv inn navnet ditt";
    if (countMessage(form.message).over) errors.message = "Hilsenen er for lang";
  }
  if (step === "delivery") {
    if (!isNorwegianMobile(form.recipientPhone)) {
      errors.recipientPhone = "Skriv inn et norsk mobilnummer (8 siffer)";
    }
    const iso = osloDateTimeToIso(form.sendDate, form.sendTime);
    if (!isSendTimeAhead(iso, now)) errors.sendAt = "Velg et tidspunkt fram i tid";
  }
  return errors;
};
