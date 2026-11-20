import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import { DAO } from "../custom_modules/DAO";
import * as authMiddleware from "../custom_modules/authorization/authMiddleware";
import express from "express";
import request from "supertest";
import * as mail from "../custom_modules/mail";
import { isDeepStrictEqual } from "node:util";

const vipps = require("../custom_modules/vipps");

/**
 * Stand-in for sinon's `stub.withArgs(...args).resolves(value)`. As with sinon, a behaviour matches
 * a call whose leading arguments deep-equal `args` (the most specific match wins, so `whenCalledWith(stub)`
 * with no args is the default), other calls return `undefined`, and behaviours persist across tests
 * (`vi.clearAllMocks()` only clears call history).
 */
const behavioursByStub = new WeakMap<object, Map<string, { args: unknown[]; value: unknown }>>();
const whenCalledWith = (stub: MockInstance, ...args: unknown[]) => {
  let behaviours = behavioursByStub.get(stub);
  if (!behaviours) {
    const map = new Map<string, { args: unknown[]; value: unknown }>();
    behaviours = map;
    behavioursByStub.set(stub, map);
    stub.mockImplementation((...callArgs: unknown[]) => {
      const match = [...map.values()]
        .filter((b) => isDeepStrictEqual(callArgs.slice(0, b.args.length), b.args))
        .sort((a, b) => b.args.length - a.args.length)[0];
      return match ? Promise.resolve(match.value) : undefined;
    });
  }
  return {
    thenResolve: (value: unknown) => {
      behaviours.set(JSON.stringify(args), { args, value });
    },
  };
};

describe("POST /scheduled/vipps", function () {
  const daysInAdvance = 3;
  const timeNow = new Date().getTime();
  const dueDate = new Date(timeNow + 1000 * 60 * 60 * 24 * daysInAdvance);
  const mockAgreementsVipps = [
    {
      id: "agr_1",
      pricing: {
        amount: 50000,
      },
      status: "ACTIVE",
    },
    {
      id: "agr_2",
      pricing: {
        amount: 340000,
      },
      status: "ACTIVE",
    },
    {
      id: "agr_3",
      pricing: {
        amount: 5000000,
      },
      status: "STOPPED",
    },
  ];

  const mockAgreementsDB = [
    {
      ID: "agr_1",
      KID: "002556289731589",
      monthly_charge_day: dueDate.getDate(),
      amount: 50000,
      status: "ACTIVE",
    },
    {
      ID: "agr_2",
      donorID: 973,
      KID: "000638723319577",
      monthly_charge_day: dueDate.getDate(),
      amount: 3400,
      status: "ACTIVE",
    },
    {
      ID: "agr_3",
      donorID: 973,
      KID: "000675978627833",
      monthly_charge_day: dueDate.getDate(),
      amount: 50000,
      status: "STOPPED",
    },
  ];

  const mockChargesVipps = [
    {
      id: "chr-1",
      amount: "5000",
      due: "2022-07-13",
      status: "CHARGED",
      type: "RECURRING",
    },
    {
      id: "chr-2",
      amount: "5000",
      due: "2022-07-13",
      status: "PENDING",
      type: "RECURRING",
    },
    {
      id: "chr-3",
      amount: "5000",
      due: "2022-07-13",
      status: "CHARGED",
      type: "RECURRING",
    },
  ];

  const mockChargesDB = [
    {
      chargeID: "chr-1",
      agreementID: "agr_1",
      KID: "46677414",
      amountNOK: "50",
      due: "2022-07-13",
      status: "CHARGED",
      type: "INITIAL",
    },
    {
      chargeID: "chr-2",
      agreementID: "agr_2",
      amount: "5000",
      due: "2022-07-13",
      status: "PENDING",
      type: "RECURRING",
    },
    {
      chargeID: "chr-3",
      agreementID: "agr_3",
      amount: "5000",
      due: "2022-07-13",
      status: "CHARGED",
      type: "RECURRING",
    },
  ];

  let server;

  let getAgreementsStub;
  let getChargesStub;
  let getAgreementStub;
  let addAgreementStub;
  let updateAgreementPriceStub;
  let updateAgreementStatusStub;
  let addChargeStub;
  let getChargeStub;
  let updateChargeStatusStub;
  let externalPaymentIDExistsStub;
  let hasChargedDueMonthStub;
  let createChargeStub;
  let loggingStub;
  let getVippsAgreementStub;
  let getActiveAgreementStub;
  let addDonationStub;
  let donationRecieptStub;

  beforeAll(function () {
    vi.spyOn(authMiddleware, "isAdmin", "get").mockReturnValue([]);

    getAgreementsStub = vi.spyOn(vipps, "getAgreements").mockReturnValue(undefined);

    getChargesStub = vi.spyOn(vipps, "getCharges").mockReturnValue(undefined);

    getVippsAgreementStub = vi.spyOn(vipps, "getAgreement").mockReturnValue(undefined);

    getAgreementStub = vi.spyOn(DAO.vipps, "getAgreement").mockReturnValue(undefined as any);

    getActiveAgreementStub = vi
      .spyOn(DAO.vipps, "getActiveAgreements")
      .mockReturnValue(undefined as any);

    addAgreementStub = vi.spyOn(DAO.vipps, "addAgreement").mockReturnValue(undefined as any);

    updateAgreementPriceStub = vi
      .spyOn(DAO.vipps, "updateAgreementPrice")
      .mockReturnValue(undefined as any);

    updateAgreementStatusStub = vi
      .spyOn(DAO.vipps, "updateAgreementStatus")
      .mockReturnValue(undefined as any);

    addChargeStub = vi.spyOn(DAO.vipps, "addCharge").mockReturnValue(undefined as any);

    getChargeStub = vi.spyOn(DAO.vipps, "getCharge").mockReturnValue(undefined as any);

    updateChargeStatusStub = vi
      .spyOn(DAO.vipps, "updateChargeStatus")
      .mockReturnValue(undefined as any);

    externalPaymentIDExistsStub = vi
      .spyOn(DAO.donations, "externalPaymentIDExists")
      .mockReturnValue(undefined as any);

    hasChargedDueMonthStub = vi.spyOn(vipps, "hasChargedDueMonth").mockReturnValue(undefined);

    createChargeStub = vi.spyOn(vipps, "createCharge").mockReturnValue(undefined);

    addDonationStub = vi.spyOn(DAO.donations, "add").mockReturnValue(undefined as any);

    loggingStub = vi.spyOn(DAO.logging, "add").mockReturnValue(undefined as any);

    donationRecieptStub = vi.spyOn(mail, "sendDonationReceipt").mockReturnValue(undefined as any);

    const scheduledRoute = require("../routes/scheduled");
    server = express();
    server.use("/scheduled", scheduledRoute);
  });

  beforeEach(function () {
    vi.clearAllMocks();
  });

  it("No agreements test", async function () {
    whenCalledWith(getAgreementsStub, "ACTIVE").thenResolve([]);
    whenCalledWith(getAgreementsStub, "PENDING").thenResolve([]);
    whenCalledWith(getAgreementsStub, "STOPPED").thenResolve([]);
    whenCalledWith(getAgreementsStub, "EXPIRED").thenResolve([]);

    whenCalledWith(getChargesStub).thenResolve([]);

    await request(server).post("/scheduled/vipps").expect(200);

    expect(addAgreementStub).not.toHaveBeenCalled();
    expect(addChargeStub).not.toHaveBeenCalled();
    expect(updateAgreementPriceStub).not.toHaveBeenCalled();
    expect(updateAgreementStatusStub).not.toHaveBeenCalled();
    expect(getAgreementStub).not.toHaveBeenCalled();
    expect(getChargesStub).not.toHaveBeenCalled();
    expect(getChargeStub).not.toHaveBeenCalled();
    expect(createChargeStub).not.toHaveBeenCalled();
    expect(loggingStub).toHaveBeenCalledOnce();
    expect(externalPaymentIDExistsStub).not.toHaveBeenCalled();
    expect(addDonationStub).not.toHaveBeenCalled();
  });

  it("Synchronize agreements and charges", async function () {
    whenCalledWith(getAgreementsStub, "ACTIVE").thenResolve(mockAgreementsVipps);
    whenCalledWith(getAgreementsStub, "PENDING").thenResolve([]);
    whenCalledWith(getAgreementsStub, "STOPPED").thenResolve([]);
    whenCalledWith(getAgreementsStub, "EXPIRED").thenResolve([]);

    whenCalledWith(getChargesStub, "agr_1").thenResolve([mockChargesVipps[0]]);
    whenCalledWith(getChargesStub, "agr_2").thenResolve([mockChargesVipps[1]]);
    whenCalledWith(getChargesStub, "agr_3").thenResolve([mockChargesVipps[2]]);

    whenCalledWith(getAgreementStub, "agr_1").thenResolve([mockAgreementsDB[0]]);
    whenCalledWith(getAgreementStub, "agr_2").thenResolve([mockAgreementsDB[1]]);
    whenCalledWith(getAgreementStub, "agr_3").thenResolve([mockAgreementsDB[2]]);

    whenCalledWith(getChargeStub, "agr_1", "chr-1").thenResolve([mockChargesDB[0]]);
    whenCalledWith(getChargeStub, "agr_2", "chr-2").thenResolve([mockChargesDB[1]]);
    whenCalledWith(getChargeStub, "agr_3", "chr-3").thenResolve([mockChargesDB[2]]);

    whenCalledWith(externalPaymentIDExistsStub, "agr_1.chr-1").thenResolve(true);
    whenCalledWith(externalPaymentIDExistsStub, "agr_3.chr-3").thenResolve(false);

    // Resolve for charge 3 agreement 3
    addDonationStub.mockResolvedValue(123);

    await request(server).post("/scheduled/vipps").expect(200);

    expect(addAgreementStub).toHaveBeenCalledTimes(3);
    expect(addChargeStub).toHaveBeenCalledTimes(3);
    expect(updateAgreementPriceStub).toHaveBeenCalledTimes(3);
    expect(updateAgreementStatusStub).toHaveBeenCalledTimes(3);
    expect(updateChargeStatusStub).toHaveBeenCalledTimes(3);
    expect(getAgreementStub).toHaveBeenCalledTimes(3);
    expect(getChargesStub).toHaveBeenCalledTimes(3);
    expect(getChargeStub).toHaveBeenCalledTimes(2); // Only 2 of the charges has status "CHARGED"
    expect(loggingStub).toHaveBeenCalledOnce();
    expect(externalPaymentIDExistsStub).toHaveBeenCalledTimes(2);
    expect(addDonationStub).toHaveBeenCalledOnce();
    expect(donationRecieptStub).toHaveBeenCalledOnce();
  });

  it("Create future due charges", async function () {
    whenCalledWith(getAgreementsStub, "ACTIVE").thenResolve([]);
    whenCalledWith(getAgreementsStub, "PENDING").thenResolve([]);
    whenCalledWith(getAgreementsStub, "STOPPED").thenResolve([]);
    whenCalledWith(getAgreementsStub, "EXPIRED").thenResolve([]);

    whenCalledWith(getActiveAgreementStub).thenResolve([mockAgreementsDB[0], mockAgreementsDB[1]]);

    whenCalledWith(getVippsAgreementStub, "agr_1").thenResolve(mockAgreementsVipps[0]);
    whenCalledWith(getVippsAgreementStub, "agr_2").thenResolve(mockAgreementsVipps[1]);

    whenCalledWith(hasChargedDueMonthStub, "agr_1").thenResolve(false);
    whenCalledWith(hasChargedDueMonthStub, "agr_2").thenResolve(true);
    createChargeStub.mockResolvedValue("chr-new");

    await request(server).post("/scheduled/vipps").expect(200);

    expect(getActiveAgreementStub).toHaveBeenCalledOnce();
    expect(getVippsAgreementStub).toHaveBeenCalledTimes(2);
    expect(hasChargedDueMonthStub).toHaveBeenCalledTimes(2);
    expect(createChargeStub).toHaveBeenCalledTimes(1); // One of the agreements have already been charged this month
    expect(loggingStub).toHaveBeenCalledOnce();
  });

  it("Responds 500 and still logs when part of the run failed", async function () {
    whenCalledWith(getAgreementsStub, "ACTIVE").thenResolve([]);
    whenCalledWith(getAgreementsStub, "EXPIRED").thenResolve(false);
    whenCalledWith(getActiveAgreementStub).thenResolve(false);

    const response = await request(server).post("/scheduled/vipps").expect(500);

    expect(response.body.sync.failed).toHaveLength(1);
    expect(loggingStub).toHaveBeenCalledOnce();
  });

  afterAll(function () {
    vi.restoreAllMocks();
  });
});
