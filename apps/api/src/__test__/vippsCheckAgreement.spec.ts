import { describe, it, afterEach } from "vitest";
import { expect } from "chai";
import sinon from "sinon";
import { DAO } from "../custom_modules/DAO";
import * as mail from "../custom_modules/mail";

const vipps = require("../custom_modules/vipps");

describe("checkAgreement", () => {
  afterEach(() => sinon.restore());

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
    sinon.stub(vipps, "getAgreement").resolves({ status: "ACTIVE" });
    sinon.stub(DAO.vipps, "updateAgreementStatus").resolves();
    sinon.stub(DAO.vipps, "getInitialCharge").resolves(initialCharge);
    sinon.stub(DAO.vipps, "updateChargeStatus").resolves();
  }

  it("records the donation and sends the receipt as soon as the initial charge is captured", async () => {
    stubCommon();
    sinon.stub(vipps, "captureInitalCharge").resolves(true);
    const externalPaymentIDExistsStub = sinon
      .stub(DAO.donations, "externalPaymentIDExists")
      .resolves(false);
    const addDonationStub = sinon.stub(DAO.donations, "add").resolves(123);
    const donationReceiptStub = sinon.stub(mail, "sendDonationReceipt").resolves(true);

    const done = await vipps.checkAgreement("agr_1", 0);

    expect(done).to.be.true;
    expect(externalPaymentIDExistsStub.calledOnceWith("agr_1.chr-initial", 8)).to.be.true;
    expect(
      addDonationStub.calledOnceWith(
        initialCharge.KID,
        8,
        initialCharge.amountNOK,
        initialCharge.dueDate,
        "agr_1.chr-initial",
        3,
      ),
    ).to.be.true;
    expect(donationReceiptStub.calledOnceWith(123)).to.be.true;
  });

  it("does not add a duplicate donation when the charge was already recorded", async () => {
    stubCommon();
    sinon.stub(vipps, "captureInitalCharge").resolves(true);
    sinon.stub(DAO.donations, "externalPaymentIDExists").resolves(true);
    const addDonationStub = sinon.stub(DAO.donations, "add");
    const donationReceiptStub = sinon.stub(mail, "sendDonationReceipt");

    const done = await vipps.checkAgreement("agr_1", 0);

    expect(done).to.be.true;
    expect(addDonationStub.called).to.be.false;
    expect(donationReceiptStub.called).to.be.false;
  });

  it("keeps polling, and records nothing, while the capture has not gone through yet", async () => {
    stubCommon();
    sinon.stub(vipps, "captureInitalCharge").resolves(false);
    const externalPaymentIDExistsStub = sinon.stub(DAO.donations, "externalPaymentIDExists");
    const addDonationStub = sinon.stub(DAO.donations, "add");

    const done = await vipps.checkAgreement("agr_1", 0);

    expect(done).to.be.false;
    expect(externalPaymentIDExistsStub.called).to.be.false;
    expect(addDonationStub.called).to.be.false;
  });
});
