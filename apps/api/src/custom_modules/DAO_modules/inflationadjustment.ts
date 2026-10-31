import { DAO, SqlResult } from "../DAO";
import { DateTime } from "luxon";
import crypto from "crypto";
import { Agreement_inflation_adjustments, Prisma } from "@prisma/client";
import { dbClockToUtc } from "../osloDays";

/**
 * Statuses of an inflation adjustment offer (docs/inflation-adjustment.md):
 * - new: prepared, not emailed yet
 * - sending: claimed by a send run; the email is on its way (a crash leaves it here, never resent)
 * - pending: emailed, waiting for the donor until `expires`
 * - accepted: the donor accepted and the agreement's amount was changed
 * - expired: emailed (or, before 2026-10, prepared) and not accepted in time
 * - cancelled: not sent, because the agreement stopped or its amount changed after it was prepared
 * - failed: the email could not be sent; the agreement can get a new offer
 * - rejected: not used
 */
export type InflationAdjustmentStatus =
  "new" | "sending" | "pending" | "accepted" | "rejected" | "expired" | "cancelled" | "failed";

export const INFLATION_ADJUSTMENT_STATUSES: InflationAdjustmentStatus[] = [
  "new",
  "sending",
  "pending",
  "accepted",
  "rejected",
  "expired",
  "cancelled",
  "failed",
];

export type InflationAgreementType = "avtaleGiro" | "vipps";

export interface AgreementInflationAdjustment {
  ID: number;
  agreement_ID: string;
  agreement_type: InflationAgreementType;
  /** In øre */
  current_amount: number;
  /** In øre */
  proposed_amount: number;
  inflation_percentage: number;
  token: string;
  status: InflationAdjustmentStatus;
  created: Date;
  updated: Date | null;
  expires: Date;
}

export interface CreateAdjustmentInput {
  agreementId: string | number;
  agreementType: InflationAgreementType;
  /** In øre */
  currentAmount: number;
  /** In øre */
  proposedAmount: number;
  inflationPercentage: number;
}

/** An active agreement that could get an offer, with what's needed to decide (one query) */
export interface InflationCandidate {
  type: InflationAgreementType;
  agreementId: string;
  KID: string;
  donorId: number;
  donorName: string | null;
  email: string | null;
  /** The agreement's current monthly amount in øre */
  amountOre: number;
  /** When the agreement was created (UTC) */
  created: Date | null;
  /**
   * The latest confirmed donation from this agreement (same KID and payment method) whose sum
   * differs from the current amount: the amount changed after it
   */
  lastDifferentDonation: Date | null;
}

/** A prepared offer waiting to be emailed, with its agreement as it is now */
export interface UnsentInflationAdjustment {
  ID: number;
  agreementType: InflationAgreementType;
  agreementId: string;
  donorId: number | null;
  donorName: string | null;
  email: string | null;
  /** In øre */
  currentAmount: number;
  /** In øre */
  proposedAmount: number;
  inflationPercentage: number;
  created: Date;
  /** False if the agreement is no longer active or its amount is no longer `currentAmount` */
  stillValid: boolean;
}

/** How long a donor has to accept, counted from when the email is sent */
export const OFFER_VALID_DAYS = 30;
/** An agreement gets at most one offer this many months */
export const MONTHS_BETWEEN_OFFERS = 12;

export const ANON_DONOR_ID = 1464;
const PAYMENT_ID_AVTALEGIRO = 7;
const PAYMENT_ID_VIPPS_RECURRING = 8;

/**
 * An offer that blocks a new one for the same agreement: not yet sent (new, sending), sent and
 * still open (pending, not expired), or sent in the last 12 months. `A` is the adjustments
 * table; the type and ID are compared by the caller.
 *
 * `expires` is written by the app (UTC wall clock), so it is compared with UTC_TIMESTAMP(); `created`
 * is filled by MySQL (DB clock), so it is compared with NOW(). See docs/timestamps.md.
 */
const BLOCKING_OFFER = `(
  A.status IN ('new', 'sending')
  OR (A.status = 'pending' AND A.expires > UTC_TIMESTAMP())
  OR (A.status IN ('pending', 'accepted', 'rejected', 'expired')
      AND A.created > NOW() - INTERVAL ${MONTHS_BETWEEN_OFFERS} MONTH)
)`;

export const inflationadjustments = {
  /**
   * Active agreements (AvtaleGiro and Vipps) that have no blocking offer, excluding the
   * anonymous donor. The amount-change rules are applied by the caller.
   */
  getCandidates: async function (): Promise<InflationCandidate[]> {
    const [rows] = await DAO.query<SqlResult<InflationCandidate>[]>(
      `
      SELECT
        'avtaleGiro' AS type,
        CAST(AG.ID AS CHAR) COLLATE utf8mb4_0900_ai_ci AS agreementId,
        AG.KID,
        D.Donor_ID AS donorId,
        Donors.full_name AS donorName,
        Donors.email,
        AG.amount AS amountOre,
        ${dbClockToUtc("AG.created")} AS created,
        (
          SELECT MAX(Don.timestamp_confirmed) FROM Donations AS Don
          WHERE Don.KID_fordeling = AG.KID
            AND Don.Payment_ID = ${PAYMENT_ID_AVTALEGIRO}
            AND Don.sum_confirmed * 100 <> AG.amount
        ) AS lastDifferentDonation
      FROM Avtalegiro_agreements AS AG
        INNER JOIN Distributions AS D ON D.KID = AG.KID
        INNER JOIN Donors ON Donors.ID = D.Donor_ID
      WHERE AG.active = 1
        AND D.Donor_ID <> ${ANON_DONOR_ID}
        AND NOT EXISTS (
          SELECT 1 FROM Agreement_inflation_adjustments AS A
          WHERE A.agreement_type = 'avtaleGiro'
            AND A.agreement_ID = CAST(AG.ID AS CHAR) COLLATE utf8mb4_0900_ai_ci
            AND ${BLOCKING_OFFER}
        )

      UNION ALL

      SELECT
        'vipps' AS type,
        VA.ID AS agreementId,
        VA.KID,
        VA.donorID AS donorId,
        Donors.full_name AS donorName,
        Donors.email,
        VA.amount * 100 AS amountOre,
        ${dbClockToUtc("VA.timestamp_created")} AS created,
        (
          SELECT MAX(Don.timestamp_confirmed) FROM Donations AS Don
          WHERE Don.KID_fordeling = VA.KID
            AND Don.Payment_ID = ${PAYMENT_ID_VIPPS_RECURRING}
            AND Don.sum_confirmed <> VA.amount
        ) AS lastDifferentDonation
      FROM Vipps_agreements AS VA
        INNER JOIN Donors ON Donors.ID = VA.donorID
      WHERE VA.status = 'ACTIVE'
        AND VA.donorID <> ${ANON_DONOR_ID}
        AND NOT EXISTS (
          SELECT 1 FROM Agreement_inflation_adjustments AS A
          WHERE A.agreement_type = 'vipps'
            AND A.agreement_ID = VA.ID
            AND ${BLOCKING_OFFER}
        )
      `,
    );
    return rows.map((row) => ({
      type: row.type,
      agreementId: String(row.agreementId),
      KID: row.KID,
      donorId: Number(row.donorId),
      donorName: row.donorName,
      email: row.email,
      amountOre: Number(row.amountOre),
      created: row.created ? new Date(row.created) : null,
      lastDifferentDonation: row.lastDifferentDonation ? new Date(row.lastDifferentDonation) : null,
    }));
  },

  /**
   * Adds a `new` offer unless the agreement already has a blocking one (checked in the same
   * statement, so preparing twice never gives an agreement two open offers). Returns whether a
   * row was added.
   */
  createIfNoOpenOffer: async function (input: CreateAdjustmentInput): Promise<boolean> {
    const token = crypto.randomBytes(32).toString("hex");
    // Replaced when the email is sent: the donor gets OFFER_VALID_DAYS from then
    const expires = DateTime.utc().plus({ days: OFFER_VALID_DAYS }).toJSDate();
    const [res] = await DAO.query(
      `INSERT INTO Agreement_inflation_adjustments
        (agreement_ID, agreement_type, current_amount, proposed_amount,
         inflation_percentage, token, status, expires)
       SELECT ?, ?, ?, ?, ?, ?, 'new', ?
       FROM DUAL
       WHERE NOT EXISTS (
         SELECT 1 FROM Agreement_inflation_adjustments AS A
         WHERE A.agreement_type = ? AND A.agreement_ID = ? AND ${BLOCKING_OFFER}
       )`,
      [
        input.agreementId.toString(),
        input.agreementType,
        input.currentAmount,
        input.proposedAmount,
        input.inflationPercentage,
        token,
        expires,
        input.agreementType,
        input.agreementId.toString(),
      ],
    );
    return res.affectedRows === 1;
  },

  /** Marks sent offers whose time ran out as expired. Returns the number changed. */
  expirePending: async function (): Promise<number> {
    const [res] = await DAO.query(
      `UPDATE Agreement_inflation_adjustments
       SET status = 'expired', updated = NOW()
       WHERE status = 'pending' AND expires < UTC_TIMESTAMP()`,
    );
    return res.affectedRows;
  },

  /**
   * Prepared offers not emailed yet, oldest first, with the agreement and donor as they are
   * now. `limit` caps the rows (all when omitted).
   */
  getUnsent: async function (limit?: number): Promise<UnsentInflationAdjustment[]> {
    const [rows] = await DAO.query<SqlResult<UnsentInflationAdjustment>[]>(
      `
      SELECT
        A.ID,
        A.agreement_type AS agreementType,
        A.agreement_ID AS agreementId,
        COALESCE(D.Donor_ID, VA.donorID) AS donorId,
        Donors.full_name AS donorName,
        Donors.email,
        A.current_amount AS currentAmount,
        A.proposed_amount AS proposedAmount,
        A.inflation_percentage AS inflationPercentage,
        ${dbClockToUtc("A.created")} AS created,
        CASE
          WHEN A.agreement_type = 'avtaleGiro'
            THEN COALESCE(AG.active = 1 AND AG.amount = A.current_amount, 0)
          WHEN A.agreement_type = 'vipps'
            THEN COALESCE(VA.status = 'ACTIVE' AND VA.amount * 100 = A.current_amount, 0)
          ELSE 0
        END AS stillValid
      FROM Agreement_inflation_adjustments AS A
        LEFT JOIN Avtalegiro_agreements AS AG
          ON A.agreement_type = 'avtaleGiro' AND AG.ID = A.agreement_ID
        LEFT JOIN Distributions AS D ON D.KID = AG.KID
        LEFT JOIN Vipps_agreements AS VA
          ON A.agreement_type = 'vipps' AND VA.ID = A.agreement_ID
        LEFT JOIN Donors ON Donors.ID = COALESCE(D.Donor_ID, VA.donorID)
      WHERE A.status = 'new'
      ORDER BY A.ID
      ${limit != null ? "LIMIT ?" : ""}
      `,
      limit != null ? [limit] : [],
    );
    return rows.map((row) => ({
      ID: row.ID,
      agreementType: row.agreementType,
      agreementId: String(row.agreementId),
      donorId: row.donorId == null ? null : Number(row.donorId),
      donorName: row.donorName,
      email: row.email,
      currentAmount: Number(row.currentAmount),
      proposedAmount: Number(row.proposedAmount),
      inflationPercentage: Number(row.inflationPercentage),
      created: new Date(row.created),
      stillValid: Number(row.stillValid) === 1,
    }));
  },

  /**
   * Claims a `new` offer for sending and starts its validity. Only one run can claim a row, so
   * no row is emailed twice. Returns false if it was already claimed (or isn't new).
   */
  claimForSending: async function (id: number, expires: Date): Promise<boolean> {
    const [res] = await DAO.query(
      `UPDATE Agreement_inflation_adjustments
       SET status = 'sending', expires = ?, updated = NOW()
       WHERE ID = ? AND status = 'new'`,
      [expires, id],
    );
    return res.affectedRows === 1;
  },

  /** Moves a claimed offer on after the send: pending when emailed, failed when not */
  finishSending: async function (id: number, sent: boolean): Promise<boolean> {
    const [res] = await DAO.query(
      `UPDATE Agreement_inflation_adjustments
       SET status = ?, updated = NOW()
       WHERE ID = ? AND status = 'sending'`,
      [sent ? "pending" : "failed", id],
    );
    return res.affectedRows === 1;
  },

  /** Cancels a `new` offer that no longer fits its agreement */
  cancelUnsent: async function (id: number): Promise<boolean> {
    const [res] = await DAO.query(
      `UPDATE Agreement_inflation_adjustments
       SET status = 'cancelled', updated = NOW()
       WHERE ID = ? AND status = 'new'`,
      [id],
    );
    return res.affectedRows === 1;
  },

  /** Offers per status, with the monthly increase they add up to (øre) */
  getStatusCounts: async function (): Promise<
    { status: InflationAdjustmentStatus; count: number; monthlyIncreaseOre: number }[]
  > {
    const [rows] = await DAO.query<
      { status: InflationAdjustmentStatus; count: number; monthlyIncreaseOre: string | number }[]
    >(
      `SELECT status, COUNT(*) AS count, SUM(proposed_amount - current_amount) AS monthlyIncreaseOre
       FROM Agreement_inflation_adjustments
       GROUP BY status`,
    );
    return rows.map((row) => ({
      status: row.status,
      count: Number(row.count),
      monthlyIncreaseOre: Number(row.monthlyIncreaseOre ?? 0),
    }));
  },

  /**
   * Get an adjustment by its token
   */
  getByToken: async function (token: string): Promise<AgreementInflationAdjustment | null> {
    const [adjustments] = await DAO.query<AgreementInflationAdjustment[]>(
      `SELECT * FROM Agreement_inflation_adjustments WHERE token = ?`,
      [token],
    );

    return adjustments?.[0] || null;
  },

  /** Get an adjustment by its ID, with amounts in kroner (for the email) */
  getByIdForEmail: async function (id: number): Promise<Agreement_inflation_adjustments | null> {
    const [adjustments] = await DAO.query<Agreement_inflation_adjustments[]>(
      `SELECT * FROM Agreement_inflation_adjustments WHERE ID = ?`,
      [id],
    );
    return adjustments?.[0] ? mapDbAgreementToJs(adjustments[0]) : null;
  },

  /**
   * Marks a pending, unexpired adjustment as accepted. Returns false if the token is unknown,
   * the adjustment isn't pending (e.g. already accepted) or it has expired. This is the claim
   * that makes accepting idempotent: only one request can move it out of pending.
   */
  acceptAdjustment: async function (token: string): Promise<boolean> {
    const [res] = await DAO.query(
      `UPDATE Agreement_inflation_adjustments
       SET status = 'accepted', updated = NOW()
       WHERE token = ? AND status = 'pending' AND expires > UTC_TIMESTAMP()`,
      [token],
    );
    return res.affectedRows === 1;
  },

  /**
   * Puts an accepted adjustment back to pending, when the agreement could not be updated
   */
  releaseAcceptedAdjustment: async function (token: string): Promise<boolean> {
    const [res] = await DAO.query(
      `UPDATE Agreement_inflation_adjustments
       SET status = 'pending', updated = NOW()
       WHERE token = ? AND status = 'accepted'`,
      [token],
    );
    return res.affectedRows === 1;
  },
};

/** The email template takes kroner */
const mapDbAgreementToJs = (
  agreement: SqlResult<Agreement_inflation_adjustments>,
): Agreement_inflation_adjustments => {
  return {
    ID: agreement.ID,
    agreement_ID: agreement.agreement_ID,
    agreement_type: agreement.agreement_type as InflationAgreementType,
    current_amount: agreement.current_amount / 100,
    proposed_amount: agreement.proposed_amount / 100,
    inflation_percentage: agreement.inflation_percentage as unknown as Prisma.Decimal,
    token: agreement.token,
    status: agreement.status,
    created: agreement.created,
    updated: agreement.updated,
    expires: agreement.expires,
  };
};
