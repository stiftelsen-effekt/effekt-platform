import { DAO } from "./DAO";
import { donationHelpers } from "./donationHelpers";

/**
 * Moving a single donation into or out of a fundraiser, from the admin panel.
 *
 * A donation counts towards a fundraiser through its KID: the distribution points at a fundraiser
 * transaction (message, sender name), which points at the fundraiser. Other donations may share
 * the donation's KID (an agreement's charges, repeat bank transfers), so the donation is moved to
 * another KID with the same donor, tax unit and split instead of changing the KID it is on.
 */

export type FundraiserMessage = {
  /** Empty for none (the column is NOT NULL) */
  message: string;
  messageSenderName: string | null;
  showName: boolean;
};

/**
 * Moves the donation to a new KID that belongs to a new transaction in the fundraiser. Callers
 * check that the donation is not in a fundraiser already. Returns the new KID.
 */
export async function attachDonationToFundraiser(
  donation: { id: number; KID: string },
  fundraiserId: number,
  message: FundraiserMessage,
): Promise<string> {
  const newKID = await donationHelpers.createKID();
  const transaction = await DAO.startTransaction();
  try {
    const fundraiserTransactionId = await DAO.fundraisers.addFundraiserTransaction(
      { fundraiserId, ...message },
      transaction,
    );
    await DAO.distributions.copyToNewKID(
      donation.KID,
      newKID,
      fundraiserTransactionId,
      transaction,
    );
    await DAO.donations.updateKIDById(donation.id, newKID, transaction);
    await DAO.commitTransaction(transaction);
  } catch (ex) {
    await DAO.rollbackTransaction(transaction);
    throw ex;
  }
  return newKID;
}

/**
 * Moves the donation to a KID with the same donor, tax unit and split that is not in a
 * fundraiser: an existing one if there is one, else a new copy. The fundraiser KID and its
 * transaction stay, so other donations on that KID still count; one left without donations no
 * longer shows on the fundraiser. Returns the KID the donation is on now.
 */
export async function detachDonationFromFundraiser(donation: {
  id: number;
  KID: string;
}): Promise<string> {
  const split = await DAO.distributions.getSplitByKID(donation.KID);
  const existingKID = await DAO.distributions.getKIDbySplit({
    donorId: split.donorId,
    taxUnitId: split.taxUnitId ?? null,
    causeAreas: split.causeAreas,
  });
  const newKID = existingKID ?? (await donationHelpers.createKID());

  const transaction = await DAO.startTransaction();
  try {
    if (!existingKID) await DAO.distributions.copyToNewKID(donation.KID, newKID, null, transaction);
    await DAO.donations.updateKIDById(donation.id, newKID, transaction);
    await DAO.commitTransaction(transaction);
  } catch (ex) {
    await DAO.rollbackTransaction(transaction);
    throw ex;
  }
  return newKID;
}
