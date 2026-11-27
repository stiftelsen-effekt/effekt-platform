import { DAO } from "../DAO";
import { normalizeReferralCode } from "../referralCode";

export type DonationReferralCode = {
  ID: number;
  KID: string | null;
  Referral_code: string;
  Timestamp: Date;
};

export type AgreementProvider = "vipps" | "avtalegiro";

async function add(kid: string, referralCode: string): Promise<void> {
  const normalized = normalizeReferralCode(referralCode);
  if (!normalized) return;

  await DAO.execute(
    `
    INSERT INTO Donation_referral_codes (KID, Referral_code)
    VALUES (?, ?)
    `,
    [kid, normalized],
  );
}

/**
 * Claims the most recent not-yet-claimed referral code for a KID on behalf of the agreement that
 * was just created from it, so the campaign code shown for that agreement (see
 * agreements.ts campaignCodesJoin) doesn't leak to a later agreement reusing the same KID. A no-op
 * if the KID has no unclaimed code (most donations don't carry one).
 */
async function claimForAgreement(
  kid: string,
  provider: AgreementProvider,
  agreementId: string,
): Promise<void> {
  await DAO.execute(
    `
    UPDATE Donation_referral_codes
    SET Agreement_provider = ?, Agreement_id = ?
    WHERE KID = ? AND Agreement_id IS NULL
    ORDER BY Timestamp DESC
    LIMIT 1
    `,
    [provider, agreementId, kid],
  );
}

export const donationReferralCodes = {
  add,
  claimForAgreement,
};
