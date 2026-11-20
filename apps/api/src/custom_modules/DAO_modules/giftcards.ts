import type { Giftcard_products, Giftcards } from "@prisma/client";
import { DAO, type SqlResult } from "../DAO";
import { dbClockColumn } from "../osloDays";

/** Statuses of Giftcards.Status (schema.prisma) */
export const giftcardStatuses = [
  "pending",
  "paid",
  "sending",
  "sent",
  "failed",
  "cancelled",
] as const;
export type GiftcardStatus = (typeof giftcardStatuses)[number];
export const giftcardDeliveries = ["sms", "pdf"] as const;
export type GiftcardDelivery = (typeof giftcardDeliveries)[number];

/** Statuses an admin may still change the send time of, or cancel: never sent, not being sent */
export const GIFTCARD_CHANGEABLE_STATUSES = ["pending", "paid"] as const;

export const giftcardSortColumns = ["sendAt", "created", "amount"] as const;
export type GiftcardSortColumn = (typeof giftcardSortColumns)[number];

export type GiftcardAdminFilter = {
  statuses?: GiftcardStatus[];
  deliveries?: GiftcardDelivery[];
  /** Product slugs */
  products?: string[];
  /** Partial match on recipient, sender or buyer name and buyer email; all digits also a KID */
  search?: string;
};

/** A gift card with its product and buyer (the KID's donor), for the admin */
export type GiftcardAdminRow = {
  id: number;
  KID: string;
  code: string | null;
  productSlug: string;
  productName: string;
  units: number;
  /** Decimal string */
  amount: string;
  delivery: GiftcardDelivery;
  donorId: number | null;
  donorName: string | null;
  donorEmail: string | null;
  recipientName: string;
  recipientPhone: string | null;
  senderName: string;
  message: string | null;
  sendAt: Date | null;
  status: GiftcardStatus;
  paidAt: Date | null;
  sentAt: Date | null;
  sendAttempts: number;
  lastError: string | null;
  smsProviderId: string | null;
  senderNotifiedAt: Date | null;
  created: Date;
  lastUpdated: Date;
};

const adminSortExpressions: Record<GiftcardSortColumn, string> = {
  sendAt: "G.Send_at",
  created: "G.Created",
  amount: "G.Amount",
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

// Created and Last_updated are filled by MySQL (DB clock, see osloDays.ts); the rest by the app
const ADMIN_COLUMNS = `
    G.ID AS id, G.KID, G.Code AS code, P.Slug AS productSlug, P.Name AS productName,
    G.Units AS units, G.Amount AS amount, G.Delivery AS delivery,
    D.Donor_ID AS donorId, Dn.full_name AS donorName, Dn.email AS donorEmail,
    G.Recipient_name AS recipientName, G.Recipient_phone AS recipientPhone,
    G.Sender_name AS senderName, G.Message AS message, G.Send_at AS sendAt, G.Status AS status,
    G.Paid_at AS paidAt, G.Sent_at AS sentAt, G.Send_attempts AS sendAttempts,
    G.Last_error AS lastError, G.Sms_provider_ID AS smsProviderId,
    G.Sender_notified_at AS senderNotifiedAt,
    ${dbClockColumn("G.Created", "created")}, ${dbClockColumn("G.Last_updated", "lastUpdated")}`;
const ADMIN_FROM = `
  FROM Giftcards AS G
  INNER JOIN Giftcard_products AS P ON P.ID = G.Product_ID
  LEFT JOIN Distributions AS D ON D.KID = G.KID
  LEFT JOIN Donors AS Dn ON Dn.ID = D.Donor_ID
`;
const ADMIN_SELECT = `SELECT ${ADMIN_COLUMNS} ${ADMIN_FROM}`;

function adminWhere(filter: GiftcardAdminFilter) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.statuses?.length) {
    clauses.push("G.Status IN (?)");
    params.push(filter.statuses);
  }
  if (filter.deliveries?.length) {
    clauses.push("G.Delivery IN (?)");
    params.push(filter.deliveries);
  }
  if (filter.products?.length) {
    clauses.push("P.Slug IN (?)");
    params.push(filter.products);
  }
  const search = filter.search?.trim();
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    const fields = ["G.Recipient_name", "G.Sender_name", "Dn.full_name", "Dn.email"];
    const kid = /^\d{1,32}$/.test(search);
    clauses.push(`(${fields.map((f) => `${f} LIKE ?`).join(" OR ")}${kid ? " OR G.KID = ?" : ""})`);
    params.push(...fields.map(() => pattern), ...(kid ? [search] : []));
  }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

type AdminQueryRow = Omit<GiftcardAdminRow, "status" | "delivery"> & {
  status: string;
  delivery: string;
  total?: number;
};

const mapAdminRow = ({ total: _total, ...row }: AdminQueryRow): GiftcardAdminRow => ({
  ...row,
  amount: String(row.amount),
  status: row.status as GiftcardStatus,
  delivery: row.delivery as GiftcardDelivery,
});

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

  /** One page of gift cards with product and buyer, for the admin */
  getAdminList: async function (options: {
    filter: GiftcardAdminFilter;
    sort: { id: GiftcardSortColumn; desc: boolean };
    page: number;
    limit: number;
  }): Promise<{ rows: GiftcardAdminRow[]; count: number; pages: number }> {
    const { where, params } = adminWhere(options.filter);
    const direction = options.sort.desc ? "DESC" : "ASC";
    const order = `${adminSortExpressions[options.sort.id]} ${direction}, G.ID ${direction}`;
    const [rows] = await DAO.query<AdminQueryRow[]>(
      `SELECT ${ADMIN_COLUMNS}, COUNT(*) OVER () AS total ${ADMIN_FROM} ${where}
       ORDER BY ${order}
       LIMIT ? OFFSET ?`,
      [...params, options.limit, options.page * options.limit],
    );
    let count = rows.length > 0 ? Number(rows[0].total) : 0;
    if (rows.length === 0 && options.page > 0) {
      const [[counted]] = await DAO.query<{ count: number }[]>(
        `SELECT COUNT(*) AS count ${ADMIN_FROM} ${where}`,
        params,
      );
      count = Number(counted.count);
    }
    return { rows: rows.map(mapAdminRow), count, pages: Math.ceil(count / options.limit) };
  },

  getAdminByID: async function (id: number): Promise<GiftcardAdminRow | null> {
    const [rows] = await DAO.query<AdminQueryRow[]>(`${ADMIN_SELECT} WHERE G.ID = ?`, [id]);
    return rows.length > 0 ? mapAdminRow(rows[0]) : null;
  },

  /** Gift cards per status, and SMS gift cards paid and waiting for their send time */
  countByStatus: async function (): Promise<{
    byStatus: Record<GiftcardStatus, number>;
    waiting: number;
  }> {
    const [rows] = await DAO.query<{ status: string; delivery: string; n: number }[]>(
      `SELECT Status AS status, Delivery AS delivery, COUNT(*) AS n
       FROM Giftcards GROUP BY Status, Delivery`,
    );
    const byStatus = Object.fromEntries(giftcardStatuses.map((s) => [s, 0])) as Record<
      GiftcardStatus,
      number
    >;
    let waiting = 0;
    for (const row of rows) {
      if (row.status in byStatus) byStatus[row.status as GiftcardStatus] += Number(row.n);
      if (row.status === "paid" && row.delivery === "sms") waiting += Number(row.n);
    }
    return { byStatus, waiting };
  },

  /**
   * failed → paid with the attempts reset, so the next scheduled run sends it again. Last_error is
   * kept until it is sent. False when it isn't failed (any more).
   */
  retrySending: async function (id: number): Promise<boolean> {
    const [res] = await DAO.query(
      `UPDATE Giftcards SET Status = 'paid', Send_attempts = 0
       WHERE ID = ? AND Status = 'failed' AND Delivery = 'sms'`,
      [id],
    );
    return res.affectedRows > 0;
  },

  /** A new send time for an SMS gift card not sent yet (pending or paid). False otherwise */
  reschedule: async function (id: number, sendAt: Date): Promise<boolean> {
    const [res] = await DAO.query(
      `UPDATE Giftcards SET Send_at = ?
       WHERE ID = ? AND Delivery = 'sms' AND Status IN (?)`,
      [sendAt, id, GIFTCARD_CHANGEABLE_STATUSES],
    );
    return res.affectedRows > 0;
  },

  /** pending or paid → cancelled; never one being or already sent. The donation is untouched */
  cancel: async function (id: number): Promise<boolean> {
    const [res] = await DAO.query(
      `UPDATE Giftcards SET Status = 'cancelled' WHERE ID = ? AND Status IN (?)`,
      [id, GIFTCARD_CHANGEABLE_STATUSES],
    );
    return res.affectedRows > 0;
  },

  markSenderNotified: async function (id: number, at: Date): Promise<void> {
    await DAO.query(`UPDATE Giftcards SET Sender_notified_at = ? WHERE ID = ?`, [at, id]);
  },
};
