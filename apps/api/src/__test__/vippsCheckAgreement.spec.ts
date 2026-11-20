import { describe, it, afterEach, expect, vi } from "vitest";
import { DAO } from "../custom_modules/DAO";
import * as mail from "../custom_modules/mail";

const vipps = require("../custom_modules/vipps");

describe("checkAgreement", () => {
  afterEach(() => vi.restoreAllMocks());

  const initialCharge = {
    chargeID: "chr-initial",
    agreementID: "agr_1",
    KID: "002556289731589",
    amountNOK: "500",
    dueDate: "2026-11-17",
    status: "PENDING",
    type: "INITIAL",
  };

  function stubCommon() {
    vi.spyOn(vipps, "getAgreement").mockResolvedValue({ status: "ACTIVE" });
    vi.spyOn(DAO.vipps, "updateAgreementStatus").mockResolvedValue(undefined as any);
    vi.spyOn(DAO.vipps, "getInitialCharge").mockResolvedValue(initialCharge);
    vi.spyOn(DAO.vipps, "updateChargeStatus").mockResolvedValue(undefined as any);
  }

  it("records the donation and sends the receipt as soon as the initial charge is captured", async () => {
    stubCommon();
    vi.spyOn(vipps, "captureInitalCharge").mockResolvedValue(true);
    const externalPaymentIDExistsStub = vi
      .spyOn(DAO.donations, "externalPaymentIDExists")
      .mockResolvedValue(false);
    const addDonationStub = vi.spyOn(DAO.donations, "add").mockResolvedValue(123);
    const donationReceiptStub = vi.spyOn(mail, "sendDonationReceipt").mockResolvedValue(true);

    const done = await vipps.checkAgreement("agr_1", 0);

    expect(done).toBe(true);
    expect(externalPaymentIDExistsStub).toHaveBeenCalledExactlyOnceWith("agr_1.chr-initial", 8);
    expect(addDonationStub).toHaveBeenCalledExactlyOnceWith(
      initialCharge.KID,
      8,
      initialCharge.amountNOK,
      initialCharge.dueDate,
      "agr_1.chr-initial",
      3,
    );
    expect(donationReceiptStub).toHaveBeenCalledExactlyOnceWith(123);
  });

  it("does not add a duplicate donation when the charge was already recorded", async () => {
    stubCommon();
    vi.spyOn(vipps, "captureInitalCharge").mockResolvedValue(true);
    vi.spyOn(DAO.donations, "externalPaymentIDExists").mockResolvedValue(true);
    const addDonationStub = vi.spyOn(DAO.donations, "add").mockReturnValue(undefined as any);
    const donationReceiptStub = vi
      .spyOn(mail, "sendDonationReceipt")
      .mockReturnValue(undefined as any);

    const done = await vipps.checkAgreement("agr_1", 0);

    expect(done).toBe(true);
    expect(addDonationStub).not.toHaveBeenCalled();
    expect(donationReceiptStub).not.toHaveBeenCalled();
  });

  it("keeps polling, and records nothing, while the capture has not gone through yet", async () => {
    stubCommon();
    vi.spyOn(vipps, "captureInitalCharge").mockResolvedValue(false);
    const externalPaymentIDExistsStub = vi
      .spyOn(DAO.donations, "externalPaymentIDExists")
      .mockReturnValue(undefined as any);
    const addDonationStub = vi.spyOn(DAO.donations, "add").mockReturnValue(undefined as any);

    const done = await vipps.checkAgreement("agr_1", 0);

    expect(done).toBe(false);
    expect(externalPaymentIDExistsStub).not.toHaveBeenCalled();
    expect(addDonationStub).not.toHaveBeenCalled();
  });
});
