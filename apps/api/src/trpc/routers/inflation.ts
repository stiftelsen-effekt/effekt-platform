import { z } from "zod";
import { DAO } from "../../custom_modules/DAO";
import {
  MAX_SEND_BATCH,
  prepareInflationOffers,
  previewInflationRound,
  sendInflationOffers,
} from "../../custom_modules/inflationadjustment";
import { sendAgreementInflationAdjustment } from "../../custom_modules/mail";
import { adminProcedure, router } from "../trpc";

/** Kroner as a decimal string, like every money amount the admin gets */
const nok = (ore: number) => (ore / 100).toFixed(2);

const totals = (rows: { type: string; increaseOre: number }[]) => {
  const monthlyOre = rows.reduce((sum, r) => sum + r.increaseOre, 0);
  return {
    count: rows.length,
    avtaleGiro: rows.filter((r) => r.type === "avtaleGiro").length,
    vipps: rows.filter((r) => r.type === "vipps").length,
    monthlyIncrease: nok(monthlyOre),
    yearlyIncrease: nok(monthlyOre * 12),
  };
};

const LOG_LABEL = "Inflation adjustment";

/** Emails one prepared offer; true when MailerSend accepted it */
const emailOffer = async (adjustmentId: number): Promise<boolean> => {
  const adjustment = await DAO.inflationadjustments.getByIdForEmail(adjustmentId);
  if (!adjustment) return false;
  return (await sendAgreementInflationAdjustment(adjustment)) === true;
};

/**
 * Inflation adjustment offers to recurring donors (docs/inflation-adjustment.md). Nothing here
 * runs on a schedule: an admin prepares a round, then sends it.
 */
export const inflationRouter = router({
  /** What a round would do now, the prepared offers waiting to be sent, and offers by status */
  overview: adminProcedure.query(async () => {
    const [preview, unsentRows, statuses] = await Promise.all([
      previewInflationRound(),
      DAO.inflationadjustments.getUnsent(),
      DAO.inflationadjustments.getStatusCounts(),
    ]);

    const eligible = preview.proposals.map((p) => ({
      type: p.type,
      agreementId: p.agreementId,
      donorId: p.donorId,
      donorName: p.donorName,
      email: p.email,
      currentAmount: nok(p.currentOre),
      proposedAmount: nok(p.proposedOre),
      increase: nok(p.increaseOre),
      inflation: p.inflation,
      lastChange: p.lastChange,
      monthsSinceChange: p.monthsSinceChange,
    }));
    const unsent = unsentRows.map((r) => ({
      id: r.ID,
      type: r.agreementType,
      agreementId: r.agreementId,
      donorId: r.donorId,
      donorName: r.donorName,
      email: r.email,
      currentAmount: nok(r.currentAmount),
      proposedAmount: nok(r.proposedAmount),
      increase: nok(r.proposedAmount - r.currentAmount),
      inflation: r.inflationPercentage,
      prepared: r.created.toISOString(),
      stillValid: r.stillValid,
    }));

    return {
      inflationUntil: preview.inflationUntil,
      eligible,
      eligibleTotals: totals(preview.proposals),
      skipped: preview.skipped,
      unsent,
      unsentTotals: totals(
        unsentRows.map((r) => ({
          type: r.agreementType,
          increaseOre: r.proposedAmount - r.currentAmount,
        })),
      ),
      statuses: statuses.map((s) => ({
        status: s.status,
        count: s.count,
        monthlyIncrease: nok(s.monthlyIncreaseOre),
      })),
      maxSendBatch: MAX_SEND_BATCH,
    };
  }),

  /** Step 1: adds a `new` offer for every eligible agreement. Emails nothing. */
  prepare: adminProcedure.mutation(async () => {
    const result = await prepareInflationOffers();
    await DAO.logging.add(LOG_LABEL, { action: "prepare", ...result });
    return result;
  }),

  /**
   * Step 2: emails up to `batchSize` prepared offers (at most MAX_SEND_BATCH per call, so the
   * request stays under the load balancer's timeout). The admin calls it repeatedly.
   */
  send: adminProcedure
    .input(z.strictObject({ batchSize: z.number().int().min(1).max(MAX_SEND_BATCH) }))
    .mutation(async ({ input }) => {
      const result = await sendInflationOffers({
        batchSize: input.batchSize,
        sendEmail: emailOffer,
      });
      if (result.sent + result.failed + result.cancelled > 0) {
        await DAO.logging.add(LOG_LABEL, { action: "send", ...result });
      }
      return result;
    }),
});
