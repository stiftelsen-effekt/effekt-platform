import type { Giftcard_products, Giftcards } from "@prisma/client";
import { DAO, type SqlResult } from "../DAO";

/** Statuses of Giftcards.Status (schema.prisma) */
export type GiftcardStatus = "pending" | "paid" | "sending" | "sent" | "failed" | "cancelled";
export type GiftcardDelivery = "sms" | "pdf";

export type GiftcardProduct = {
  id: number;
  slug: string;
  name: string;
  organizationId: number;
  /** The organization's cause area, for the distribution */
  causeAreaId: number;
  unitPrice: number;
  unitSingular: string;
  unitPlural: string;
  minUnits: number;
  maxUnits: number;
  smsTemplate: string;
  active: boolean;
};

export type Giftcard = {
  id: number;
  KID: string;
  /** In the recipient's link; null for gift cards bought before codes existed */
  code: string | null;
  productId: number;
  units: number;
  amount: number;
  delivery: GiftcardDelivery;
  recipientName: string;
  senderName: string;
  message: string | null;
  recipientPhone: string | null;
  sendAt: Date | null;
  status: GiftcardStatus;
  paidAt: Date | null;
  sentAt: Date | null;
  sendAttempts: number;
  smsProviderId: string | null;
  lastError: string | null;
  senderNotifiedAt: Date | null;
};

export type NewGiftcard = Pick<
  Giftcard,
  | "KID"
  | "code"
  | "productId"
  | "units"
  | "amount"
  | "delivery"
  | "recipientName"
  | "senderName"
  | "message"
  | "recipientPhone"
  | "sendAt"
>;

type ProductRow = SqlResult<Giftcard_products> & { Cause_area_ID: number };

const mapProduct = (row: ProductRow): GiftcardProduct => ({
  id: row.ID,
  slug: row.Slug,
  name: row.Name,
  organizationId: row.Organization_ID,
  causeAreaId: row.Cause_area_ID,
  unitPrice: parseFloat(row.Unit_price),
  unitSingular: row.Unit_singular,
  unitPlural: row.Unit_plural,
  minUnits: row.Min_units,
  maxUnits: row.Max_units,
  smsTemplate: row.Sms_template,
  active: row.Active === 1,
});

const mapGiftcard = (row: SqlResult<Giftcards>): Giftcard => ({
  id: row.ID,
  KID: row.KID,
  code: row.Code,
  productId: row.Product_ID,
  units: row.Units,
  amount: parseFloat(row.Amount),
  delivery: row.Delivery as GiftcardDelivery,
  recipientName: row.Recipient_name,
  senderName: row.Sender_name,
  message: row.Message,
  recipientPhone: row.Recipient_phone,
  sendAt: row.Send_at,
  status: row.Status as GiftcardStatus,
  paidAt: row.Paid_at,
  sentAt: row.Sent_at,
  sendAttempts: row.Send_attempts,
  smsProviderId: row.Sms_provider_ID,
  lastError: row.Last_error,
  senderNotifiedAt: row.Sender_notified_at,
});

const PRODUCT_SELECT = `
  SELECT P.*, O.cause_area_ID AS Cause_area_ID
  FROM Giftcard_products AS P
  INNER JOIN Organizations AS O ON O.ID = P.Organization_ID
`;

export const giftcards = {
  getActiveProducts: async function (): Promise<GiftcardProduct[]> {
    const [rows] = await DAO.query<ProductRow[]>(
      `${PRODUCT_SELECT} WHERE P.Active = 1 ORDER BY P.ID`,
    );
    return rows.map(mapProduct);
  },

  /** The product with this slug, active or not (null if none) */
  getProductBySlug: async function (slug: string): Promise<GiftcardProduct | null> {
    const [rows] = await DAO.query<ProductRow[]>(`${PRODUCT_SELECT} WHERE P.Slug = ?`, [slug]);
    return rows.length > 0 ? mapProduct(rows[0]) : null;
  },

  getProductByID: async function (id: number): Promise<GiftcardProduct | null> {
    const [rows] = await DAO.query<ProductRow[]>(`${PRODUCT_SELECT} WHERE P.ID = ?`, [id]);
    return rows.length > 0 ? mapProduct(rows[0]) : null;
  },

  add: async function (giftcard: NewGiftcard): Promise<number> {
    const [res] = await DAO.query(
      `INSERT INTO Giftcards
        (KID, Code, Product_ID, Units, Amount, Delivery, Recipient_name, Sender_name, Message,
         Recipient_phone, Send_at, Status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        giftcard.KID,
        giftcard.code,
        giftcard.productId,
        giftcard.units,
        giftcard.amount,
        giftcard.delivery,
        giftcard.recipientName,
        giftcard.senderName,
        giftcard.message,
        giftcard.recipientPhone,
        giftcard.sendAt,
      ],
    );
    return res.insertId;
  },

  getByKID: async function (KID: string): Promise<Giftcard | null> {
    const [rows] = await DAO.query<SqlResult<Giftcards>[]>(
      `SELECT * FROM Giftcards WHERE KID = ?`,
      [KID],
    );
    return rows.length > 0 ? mapGiftcard(rows[0]) : null;
  },

  getByCode: async function (code: string): Promise<Giftcard | null> {
    const [rows] = await DAO.query<SqlResult<Giftcards>[]>(
      `SELECT * FROM Giftcards WHERE Code = ?`,
      [code],
    );
    return rows.length > 0 ? mapGiftcard(rows[0]) : null;
  },

  getByID: async function (id: number): Promise<Giftcard | null> {
    const [rows] = await DAO.query<SqlResult<Giftcards>[]>(`SELECT * FROM Giftcards WHERE ID = ?`, [
      id,
    ]);
    return rows.length > 0 ? mapGiftcard(rows[0]) : null;
  },

  /** pending → paid. False when it was already paid (or cancelled): payment hooks run again */
  markPaid: async function (KID: string, at: Date): Promise<boolean> {
    const [res] = await DAO.query(
      `UPDATE Giftcards SET Status = 'paid', Paid_at = ? WHERE KID = ? AND Status = 'pending'`,
      [at, KID],
    );
    return res.affectedRows > 0;
  },

  /** IDs of paid SMS gift cards whose send time has come, oldest first */
  getDueSmsIDs: async function (now: Date, limit: number): Promise<number[]> {
    const [rows] = await DAO.query<{ ID: number }[]>(
      `SELECT ID FROM Giftcards
       WHERE Status = 'paid' AND Delivery = 'sms' AND Send_at <= ?
       ORDER BY Send_at, ID
       LIMIT ?`,
      [now, limit],
    );
    return rows.map((r) => r.ID);
  },

  /**
   * paid → sending, counting the attempt. False when another run took it first: only the run
   * that claims a gift card sends its SMS.
   */
  claimForSending: async function (id: number): Promise<boolean> {
    const [res] = await DAO.query(
      `UPDATE Giftcards SET Status = 'sending', Send_attempts = Send_attempts + 1
       WHERE ID = ? AND Status = 'paid'`,
      [id],
    );
    return res.affectedRows > 0;
  },

  markSent: async function (id: number, providerId: string | null, at: Date): Promise<void> {
    await DAO.query(
      `UPDATE Giftcards SET Status = 'sent', Sent_at = ?, Sms_provider_ID = ?, Last_error = NULL
       WHERE ID = ? AND Status = 'sending'`,
      [at, providerId, id],
    );
  },

  /** sending → paid (tried again next run) or failed (given up) */
  markSendFailed: async function (id: number, error: string, giveUp: boolean): Promise<void> {
    await DAO.query(
      `UPDATE Giftcards SET Status = ?, Last_error = ? WHERE ID = ? AND Status = 'sending'`,
      [giveUp ? "failed" : "paid", error.slice(0, 2000), id],
    );
  },

  markSenderNotified: async function (id: number, at: Date): Promise<void> {
    await DAO.query(`UPDATE Giftcards SET Sender_notified_at = ? WHERE ID = ?`, [at, id]);
  },
};
