import { DateTime } from "luxon";
import { DAO } from "../DAO";
import type { Giftcard, GiftcardProduct } from "../DAO_modules/giftcards";
import { registerPendingDonation } from "../pendingDonationRegistration";
import type { RegisterDonationBody } from "../../schemas/publicRequests";
import type { GiftcardRegisterInput } from "../../trpc/shared/giftcard";
import { OSLO_ZONE } from "../osloDays";
import { formatCurrency, sendTemplate } from "../mail";
import {
  generateGiftcardCode,
  giftcardLink,
  GIFTCARD_CODE_PATTERN,
  normalizeNorwegianMobile,
  renderGiftcardSms,
} from "./text";
import { getSmsProvider, type SmsProvider } from "./sms";

const config = require("../../config.js");

/** An SMS may be scheduled from a few minutes ago (clock skew, slow form) up to a year ahead */
const SEND_AT_PAST_TOLERANCE_MS = 10 * 60 * 1000;
const SEND_AT_MAX_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;

/** Attempts before a gift card's SMS is given up (status failed, alerting is by admin list) */
export const MAX_SEND_ATTEMPTS = 3;

export type GiftcardRegistration =
  | {
      ok: true;
      content: {
        KID: string;
        amount: number;
        registrationToken: string | null;
        paymentProviderUrl: string;
      };
    }
  | { ok: false; message: string };

const rejected = (message: string): GiftcardRegistration => ({ ok: false, message });

/**
 * Registers a gift card purchase: checks the product, number of units, phone number and send
 * time, computes the amount from the product's unit price (never from the browser), and
 * registers a pending one-off donation of 100 % to the product's organization on a new KID with
 * the gift card stored on it before payment starts.
 */
export async function registerGiftcard(
  input: GiftcardRegisterInput,
  now: Date = new Date(),
): Promise<GiftcardRegistration> {
  const product = await DAO.giftcards.getProductBySlug(input.product);
  if (!product || !product.active) return rejected("Unknown gift card");
  if (input.units < product.minUnits || input.units > product.maxUnits) {
    return rejected("Invalid number of units");
  }

  let recipientPhone: string | null = null;
  let sendAt: Date | null = null;
  if (input.delivery === "sms") {
    recipientPhone = normalizeNorwegianMobile(input.recipientPhone ?? "");
    if (!recipientPhone) return rejected("Invalid phone number");
    sendAt = new Date(input.sendAt!);
    const ahead = sendAt.getTime() - now.getTime();
    if (Number.isNaN(ahead) || ahead < -SEND_AT_PAST_TOLERANCE_MS || ahead > SEND_AT_MAX_AHEAD_MS) {
      return rejected("Invalid send time");
    }
    // Never earlier than now: a time a little in the past means "as soon as it is paid"
    if (ahead < 0) sendAt = now;
  }

  const amount = Math.round(product.unitPrice * input.units * 100) / 100;

  const body: RegisterDonationBody = {
    distributionCauseAreas: [
      {
        id: product.causeAreaId,
        percentageShare: "100",
        standardSplit: false,
        organizations: [{ id: product.organizationId, percentageShare: "100" }],
      },
    ],
    donor: {
      email: input.donor.email,
      name: input.donor.name ?? null,
      ssn: input.donor.ssn ?? null,
      newsletter: input.donor.newsletter ?? false,
    },
    method: input.method,
    recurring: false,
    amount,
    referralCode: input.referralCode ?? undefined,
  };

  const result = await registerPendingDonation(body, {
    onNewKID: async (KID) => {
      await DAO.giftcards.add({
        KID,
        code: generateGiftcardCode(),
        productId: product.id,
        units: input.units,
        amount,
        delivery: input.delivery,
        recipientName: input.recipientName,
        senderName: input.senderName,
        message: input.message?.trim() || null,
        recipientPhone,
        sendAt,
      });
    },
  });
  if (!result.ok) return result;

  return {
    ok: true,
    content: {
      KID: result.content.KID!,
      amount,
      registrationToken: result.content.registrationToken,
      paymentProviderUrl: result.content.paymentProviderUrl,
    },
  };
}

/** "24.12.2026 kl. 16:00" in Oslo time */
export const formatOsloDateTime = (date: Date) =>
  DateTime.fromJSDate(date).setZone(OSLO_ZONE).toFormat("dd.LL.yyyy 'kl.' HH:mm");

/** The website page that serves a product's self-fill PDF (apps/web) */
export const certificateUrl = (product: GiftcardProduct) =>
  `${config.frontend_url || "https://gieffektivt.no"}/gavekort/${product.slug}/gavebevis`;

type ReceiptDonation = {
  id: number;
  KID: string;
  email: string;
  donor: string | null;
  sum: number | string;
  timestamp: Date;
};

/**
 * Called by sendDonationReceipt for every received donation. When the donation is on a gift
 * card's KID it sends the gift card receipt instead of the standard one. Returns null when the donation is not a gift card or there is no gift card
 * receipt template (the standard receipt is sent), otherwise what sending returned.
 */
export async function handleGiftcardDonation(
  donation: ReceiptDonation,
  receiver: string | null,
  now: Date = new Date(),
): Promise<boolean | number | null> {
  const giftcard = await DAO.giftcards.getByKID(donation.KID);
  if (!giftcard) return null;

  // Normally already paid when the donation was added (DAO.donations.add); this is a no-op then
  await DAO.giftcards.markPaid(giftcard.KID, now);
  const product = await DAO.giftcards.getProductByID(giftcard.productId);
  if (parseFloat(String(donation.sum)) < giftcard.amount) {
    console.warn(
      `Gift card ${giftcard.id} (KID ${giftcard.KID}) paid ${donation.sum}, expected ${giftcard.amount}`,
    );
  }

  if (!config.mailersend_giftcard_receipt_template_id || !product) return null;

  const result = await sendTemplate({
    to: receiver || donation.email,
    bcc: "gieffektivt@gmail.com",
    templateId: config.mailersend_giftcard_receipt_template_id,
    personalization: giftcardReceiptPersonalization(giftcard, product, donation),
  });
  if (result === false) return false;
  return result.statusCode === 202 ? true : result.statusCode;
}

export function giftcardReceiptPersonalization(
  giftcard: Giftcard,
  product: GiftcardProduct,
  donation: ReceiptDonation,
) {
  return {
    donorName: donation.donor,
    donationKID: donation.KID,
    donationDate: DateTime.fromJSDate(new Date(donation.timestamp))
      .setZone(OSLO_ZONE)
      .toFormat("dd.LL.yyyy"),
    donationTotalSum: formatCurrency(donation.sum) + " kr",
    productName: product.name,
    units: giftcard.units,
    unit: giftcard.units === 1 ? product.unitSingular : product.unitPlural,
    recipientName: giftcard.recipientName,
    senderName: giftcard.senderName,
    isSms: giftcard.delivery === "sms",
    isPdf: giftcard.delivery === "pdf",
    sendAt: giftcard.sendAt ? formatOsloDateTime(giftcard.sendAt) : null,
    certificateUrl: certificateUrl(product),
  };
}

export type SmsDispatchSummary = {
  due: number;
  sent: number;
  retrying: number;
  failed: number;
  skipped: number;
};

/**
 * Sends the SMS of every paid gift card whose send time has come (run every few minutes by Cloud
 * Scheduler through POST /scheduled/giftcard-sms). Each gift card is claimed first, so runs that
 * overlap never send the same one twice. After sending, the buyer gets an email that it went out.
 */
export async function sendDueGiftcardSms(
  now: Date = new Date(),
  provider?: SmsProvider,
  limit = 200,
): Promise<SmsDispatchSummary> {
  const ids = await DAO.giftcards.getDueSmsIDs(now, limit);
  const summary: SmsDispatchSummary = {
    due: ids.length,
    sent: 0,
    retrying: 0,
    failed: 0,
    skipped: 0,
  };
  if (ids.length === 0) return summary;
  // Only now: without a provider (production before one is chosen) nothing is claimed
  provider ??= getSmsProvider();

  for (const id of ids) {
    if (!(await DAO.giftcards.claimForSending(id))) {
      summary.skipped++;
      continue;
    }
    const giftcard = (await DAO.giftcards.getByID(id))!;
    const product = await DAO.giftcards.getProductByID(giftcard.productId);
    try {
      if (!product || !giftcard.recipientPhone) throw new Error("Missing product or phone");
      const text = renderGiftcardSms(product.smsTemplate, {
        recipientName: giftcard.recipientName,
        senderName: giftcard.senderName,
        message: giftcard.message,
        units: giftcard.units,
        unitSingular: product.unitSingular,
        unitPlural: product.unitPlural,
        link: giftcard.code
          ? giftcardLink(config.frontend_url, giftcard.code)
          : certificateUrl(product),
      });
      const { id: providerId } = await provider!.send(
        giftcard.recipientPhone,
        text,
        `giftcard-${id}`,
      );
      await DAO.giftcards.markSent(id, providerId, new Date());
      summary.sent++;
    } catch (ex) {
      const giveUp = giftcard.sendAttempts >= MAX_SEND_ATTEMPTS;
      console.error(`Gift card ${id}: SMS failed (attempt ${giftcard.sendAttempts})`, ex);
      await DAO.giftcards.markSendFailed(id, String((ex as Error)?.message ?? ex), giveUp);
      if (giveUp) summary.failed++;
      else summary.retrying++;
      continue;
    }

    try {
      await sendSmsSentEmail(giftcard, product);
    } catch (ex) {
      console.error(`Gift card ${id}: failed to email the buyer that the SMS was sent`, ex);
    }
  }
  return summary;
}

async function sendSmsSentEmail(giftcard: Giftcard, product: GiftcardProduct) {
  if (!config.mailersend_giftcard_sms_sent_template_id) return;
  const [rows] = await DAO.query<{ email: string; full_name: string | null }[]>(
    `SELECT Dn.email, Dn.full_name FROM Distributions D
     INNER JOIN Donors Dn ON Dn.ID = D.Donor_ID WHERE D.KID = ?`,
    [giftcard.KID],
  );
  if (rows.length === 0 || !rows[0].email) return;
  const result = await sendTemplate({
    to: rows[0].email,
    templateId: config.mailersend_giftcard_sms_sent_template_id,
    personalization: {
      donorName: rows[0].full_name,
      recipientName: giftcard.recipientName,
      units: giftcard.units,
      unit: giftcard.units === 1 ? product.unitSingular : product.unitPlural,
      productName: product.name,
      certificateUrl: certificateUrl(product),
    },
  });
  if (result !== false && result.statusCode === 202) {
    await DAO.giftcards.markSenderNotified(giftcard.id, new Date());
  }
}

/** For the thank-you page: the gift card on a KID (null if none) */
export async function getGiftcardStatus(KID: string) {
  const giftcard = await DAO.giftcards.getByKID(KID);
  if (!giftcard) return null;
  const product = await DAO.giftcards.getProductByID(giftcard.productId);
  return {
    product: product?.slug ?? "",
    units: giftcard.units,
    amount: giftcard.amount,
    delivery: giftcard.delivery,
    recipientName: giftcard.recipientName,
    sendAt: giftcard.sendAt ? giftcard.sendAt.toISOString() : null,
    status: giftcard.status,
  };
}

/** How long the recipient's page shows the gift card, from when the SMS went out (or purchase) */
export const GIFT_PAGE_DAYS = 400;

/** What the recipient's page (gieffektivt.no/gave/<code>) shows. Never the phone, price or buyer */
export type GiftForRecipient = {
  product: string;
  units: number;
  unitSingular: string;
  unitPlural: string;
  recipientName: string;
  senderName: string;
  message: string | null;
  /** When the gift was given: the SMS send time, else the purchase */
  givenAt: string;
};

/**
 * The gift card with this code for the recipient's page, or null: unknown code, not paid (or
 * cancelled), or older than GIFT_PAGE_DAYS. Each null looks the same to the caller.
 */
export async function getGiftForRecipient(
  code: string,
  now: Date = new Date(),
): Promise<GiftForRecipient | null> {
  if (!GIFTCARD_CODE_PATTERN.test(code)) return null;
  const giftcard = await DAO.giftcards.getByCode(code);
  if (!giftcard || giftcard.status === "pending" || giftcard.status === "cancelled") return null;
  const givenAt = giftcard.sentAt ?? giftcard.sendAt ?? giftcard.paidAt ?? now;
  if (now.getTime() - givenAt.getTime() > GIFT_PAGE_DAYS * 24 * 60 * 60 * 1000) return null;
  const product = await DAO.giftcards.getProductByID(giftcard.productId);
  if (!product) return null;
  return {
    product: product.slug,
    units: giftcard.units,
    unitSingular: product.unitSingular,
    unitPlural: product.unitPlural,
    recipientName: giftcard.recipientName,
    senderName: giftcard.senderName,
    message: giftcard.message,
    givenAt: givenAt.toISOString(),
  };
}
