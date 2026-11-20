import { TRPCError } from "@trpc/server";
import { DAO } from "../../custom_modules/DAO";
import type { GiftcardAdminRow, GiftcardStatus } from "../../custom_modules/DAO_modules/giftcards";
import { certificateUrl, SEND_AT_MAX_AHEAD_MS } from "../../custom_modules/giftcards/service";
import { giftcardLink, maskPhone, renderGiftcardSms } from "../../custom_modules/giftcards/text";
import { adminIdentity } from "../identity";
import { giftcardIdInput, giftcardRescheduleInput, giftcardsListInput } from "../schemas/giftcards";
import { adminProcedure, router } from "../trpc";

const config = require("../../config.js");

const DEFAULT_SORT = { id: "created", desc: true } as const;

const iso = (date: Date | null) => date?.toISOString() ?? null;

/** Dates as ISO strings, like every admin procedure */
const toApiRow = (row: GiftcardAdminRow) => ({
  ...row,
  sendAt: iso(row.sendAt),
  paidAt: iso(row.paidAt),
  sentAt: iso(row.sentAt),
  senderNotifiedAt: iso(row.senderNotifiedAt),
  created: row.created.toISOString(),
  lastUpdated: row.lastUpdated.toISOString(),
});

/** The list leaves out the greeting and masks the phone; the record has them */
const toListRow = (row: GiftcardAdminRow) => {
  const { message, code: _code, ...rest } = toApiRow(row);
  return { ...rest, recipientPhone: maskPhone(row.recipientPhone), hasMessage: Boolean(message) };
};

const statusWords: Record<GiftcardStatus, string> = {
  pending: "not paid",
  paid: "paid",
  sending: "being sent",
  sent: "sent",
  failed: "failed",
  cancelled: "cancelled",
};

/** NOT_FOUND when the gift card doesn't exist, else CONFLICT naming its status */
async function refused(id: number, rule: string): Promise<never> {
  const giftcard = await DAO.giftcards.getByID(id);
  if (!giftcard) throw new TRPCError({ code: "NOT_FOUND", message: "No such gift card" });
  const status = statusWords[giftcard.status] ?? giftcard.status;
  const pdf = giftcard.delivery === "pdf" ? ", PDF" : "";
  throw new TRPCError({ code: "CONFLICT", message: `${rule}; this one is ${status}${pdf}.` });
}

/**
 * Gift cards (gavekort) for the admin: the list, one gift card with its SMS, and the few
 * changes ops may make before it is sent. Status changes are conditional updates
 * (DAO_modules/giftcards.ts), so they never race the SMS sender's claim. The website's own
 * procedures are in routers/giftcard.ts.
 */
export const giftcardsRouter = router({
  list: adminProcedure.input(giftcardsListInput).query(async ({ input }) => {
    const result = await DAO.giftcards.getAdminList({
      filter: input.filter ?? {},
      sort: input.sort ?? DEFAULT_SORT,
      page: input.page,
      limit: input.limit,
    });
    return { ...result, rows: result.rows.map(toListRow) };
  }),

  /** Counts for the page's summary: per status, and SMS gift cards paid and waiting to be sent */
  summary: adminProcedure.query(async () => {
    const counts = await DAO.giftcards.countByStatus();
    return { ...counts.byStatus, waiting: counts.waiting };
  }),

  /** Every active and inactive product, for the filter */
  products: adminProcedure.query(async () => {
    const [rows] = await DAO.query<{ slug: string; name: string; active: number }[]>(
      `SELECT Slug AS slug, Name AS name, Active AS active FROM Giftcard_products ORDER BY ID`,
    );
    return rows.map((r) => ({ slug: r.slug, name: r.name, active: Boolean(r.active) }));
  }),

  get: adminProcedure.input(giftcardIdInput).query(async ({ input }) => {
    const row = await DAO.giftcards.getAdminByID(input.id);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "No such gift card" });
    const product = await DAO.giftcards.getProductBySlug(row.productSlug);
    const link = row.code
      ? giftcardLink(config.frontend_url, row.code)
      : product
        ? certificateUrl(product)
        : null;
    const smsText =
      row.delivery === "sms" && product && link
        ? renderGiftcardSms(product.smsTemplate, {
            recipientName: row.recipientName,
            senderName: row.senderName,
            message: row.message,
            units: row.units,
            unitSingular: product.unitSingular,
            unitPlural: product.unitPlural,
            link,
          })
        : null;
    const donations = await DAO.donations.getAllByKID(row.KID);
    return {
      ...toApiRow(row),
      unit: product ? (row.units === 1 ? product.unitSingular : product.unitPlural) : null,
      smsText,
      /** The recipient's page (shown once paid, never when cancelled) */
      recipientUrl:
        row.code && link ? (/^https?:\/\//.test(link) ? link : `https://${link}`) : null,
      donations: donations.map((d) => ({
        id: d.id,
        sum: String(d.sum),
        date: d.timestamp ? new Date(d.timestamp).toISOString() : null,
        method: d.paymentMethod ?? null,
      })),
    };
  }),

  /** failed → paid with the attempts reset: the next scheduled run sends the SMS again */
  retry: adminProcedure.input(giftcardIdInput).mutation(async ({ ctx, input }) => {
    if (!(await DAO.giftcards.retrySending(input.id))) {
      await refused(input.id, "Only failed SMS gift cards can be retried");
    }
    console.info(`Gift card ${input.id}: SMS retry requested by ${adminIdentity(ctx.auth)}`);
    return { id: input.id };
  }),

  /** A new send time for an SMS gift card not sent yet; in the future and within a year */
  reschedule: adminProcedure.input(giftcardRescheduleInput).mutation(async ({ ctx, input }) => {
    const sendAt = new Date(input.sendAt);
    const ahead = sendAt.getTime() - Date.now();
    if (ahead <= 0 || ahead > SEND_AT_MAX_AHEAD_MS) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "The send time must be in the future and within a year",
      });
    }
    if (!(await DAO.giftcards.reschedule(input.id, sendAt))) {
      await refused(input.id, "Only SMS gift cards not sent yet can be rescheduled");
    }
    console.info(
      `Gift card ${input.id}: send time set to ${sendAt.toISOString()} by ${adminIdentity(ctx.auth)}`,
    );
    return { id: input.id, sendAt: sendAt.toISOString() };
  }),

  /** pending or paid → cancelled. The donation is left as it is (refund separately if needed) */
  cancel: adminProcedure.input(giftcardIdInput).mutation(async ({ ctx, input }) => {
    if (!(await DAO.giftcards.cancel(input.id))) {
      await refused(input.id, "Only gift cards not sent yet can be cancelled");
    }
    console.info(`Gift card ${input.id}: cancelled by ${adminIdentity(ctx.auth)}`);
    return { id: input.id };
  }),
});
