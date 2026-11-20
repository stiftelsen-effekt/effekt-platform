import { describe, it, beforeAll, afterAll, beforeEach, afterEach, expect, vi } from "vitest";
import { DAO } from "../custom_modules/DAO";
import * as authMiddleware from "../custom_modules/authorization/authMiddleware";
import express from "express";
import * as giroSftp from "../custom_modules/giroSftp";
import request from "supertest";
import { initialpaymentmethod } from "../custom_modules/DAO_modules/initialpaymentmethod";
import { donations } from "../custom_modules/DAO_modules/donations";
import paymentMethods from "../enums/paymentMethods";
import Decimal from "decimal.js";
import { donors } from "../custom_modules/DAO_modules/donors";
import * as avtalegiroDeletions from "../custom_modules/avtalegiro/deletions";

const avtalegiro = require("../custom_modules/avtalegiro");
const mail = require("../custom_modules/mail");
const config = require("../config");

describe("POST /scheduled/avtalegiro", function () {
  const mockAgreements = [
    {
      id: 1,
      KID: "002556289731589",
      paymentDate: 10,
      amount: 50000,
      notice: true,
      active: true,
    },
    {
      id: 2,
      KID: "000638723319577",
      paymentDate: 10,
      amount: 340000,
      notice: false,
      active: true,
    },
    {
      id: 3,
      KID: "000675978627833",
      paymentDate: 10,
      amount: 5000000,
      notice: true,
      active: true,
    },
  ];

  let server;

  let avtalegiroFileStub;
  let sendNotificationStub;
  let shipmentStub;
  let agreementsStub;
  let loggingStub;
  let sendFileStub;
  let claimedKIDsStub;
  let addChargesStub;
  let deletionsStub;
  // Stand-ins for sinon's `agreementsStub.withArgs(day).resolves(..)` (which persisted across tests)
  // and its default behaviour
  const agreementsByPaymentDate = new Map<number, unknown>();
  const defaultAgreements = vi.fn();

  beforeAll(function () {
    vi.spyOn(authMiddleware, "isAdmin", "get").mockReturnValue([]);

    deletionsStub = vi
      .spyOn(avtalegiroDeletions, "processAvtaleGiroDeletions")
      .mockResolvedValue({} as any);

    claimedKIDsStub = vi
      .spyOn(DAO.avtalegirocharges, "getClaimedKIDsForMonth")
      .mockReturnValue(undefined as any);
    addChargesStub = vi.spyOn(DAO.avtalegirocharges, "addCharges").mockResolvedValue(undefined);

    avtalegiroFileStub = vi
      .spyOn(avtalegiro, "generateAvtaleGiroFile")
      .mockResolvedValue(Buffer.from("", "utf-8"));

    sendNotificationStub = vi.spyOn(mail, "sendAvtalegiroNotification").mockResolvedValue(true);

    shipmentStub = vi.spyOn(DAO.avtalegiroagreements, "addShipment").mockResolvedValue(42);

    agreementsStub = vi
      .spyOn(DAO.avtalegiroagreements, "getByPaymentDate")
      .mockImplementation((paymentDate) =>
        agreementsByPaymentDate.has(paymentDate)
          ? Promise.resolve(agreementsByPaymentDate.get(paymentDate))
          : defaultAgreements(paymentDate),
      );
    agreementsByPaymentDate.set(29, []);
    agreementsByPaymentDate.set(30, []);
    agreementsByPaymentDate.set(31, []);

    loggingStub = vi.spyOn(DAO.logging, "add").mockResolvedValue(undefined as any);

    sendFileStub = vi.spyOn(giroSftp, "sendFile").mockReturnValue(undefined as any);

    const scheduledRoute = require("../routes/scheduled");
    server = express();
    server.use("/scheduled", scheduledRoute);
  });

  beforeEach(function () {
    vi.clearAllMocks();
    claimedKIDsStub.mockResolvedValue(new Set());
  });

  it("Does nothing with no agreements", async function () {
    defaultAgreements.mockResolvedValue([]);

    await request(server).post("/scheduled/avtalegiro?date=2021-10-04").expect(200);

    expect(agreementsStub).toHaveBeenCalledOnce();
    expect(sendNotificationStub).not.toHaveBeenCalled();
    expect(sendFileStub).not.toHaveBeenCalled();
    expect(loggingStub.mock.calls.filter(([label]) => label === "AvtaleGiro")).toHaveLength(1);
  });

  it("Generates claim file when provided a date", async function () {
    defaultAgreements.mockResolvedValue(mockAgreements);

    await request(server).post("/scheduled/avtalegiro/?date=2021-10-04").expect(200);

    expect(sendNotificationStub).not.toHaveBeenCalled();
    expect(sendFileStub).toHaveBeenCalledOnce();
  });

  /**
   * We are required to deliver files four banking days before the claim date.
   * This means that if the claim date is a saturday or sunday, we need to deliver
   * the file on the tuesday before. Same goes for the following monday.
   */
  it("Generates multiple claims files when provided a tuesday", async function () {
    defaultAgreements.mockResolvedValue(mockAgreements);

    await request(server).post("/scheduled/avtalegiro/?date=2021-10-05").expect(200);

    expect(sendNotificationStub).not.toHaveBeenCalled();
    expect(sendFileStub).toHaveBeenCalledTimes(3);
  });

  it("Notifies claimants when they have asked for it", async function () {
    defaultAgreements.mockResolvedValue(mockAgreements);

    // Used to force mail to be sent (but method is stubbed)
    let tempEnv = config.env;
    config.env = "production";

    await request(server).post("/scheduled/avtalegiro/?date=2021-10-04&notify=true").expect(200);

    config.env = tempEnv;

    expect(sendNotificationStub).toHaveBeenCalledTimes(2);
    expect(sendFileStub).toHaveBeenCalledOnce();
  });

  it("Recognizes when claim date is last day of the month", async function () {
    agreementsByPaymentDate.set(0, mockAgreements);

    await request(server).post("/scheduled/avtalegiro/?date=2022-09-26&notify=true").expect(200);

    expect(agreementsStub).toHaveBeenCalledWith(0);
    expect(shipmentStub).toHaveBeenCalledWith(mockAgreements.length);
  });

  it("Includes the 28th when the 28th is last day of month", async function () {
    // Agreements on day 0 (last day of month) are different agreements from those on the 28th
    const lastDayAgreements = mockAgreements.map((agreement, i) => ({
      ...agreement,
      id: 10 + i,
      KID: `99${agreement.KID.substring(2)}`,
      paymentDate: 0,
    }));
    agreementsByPaymentDate.set(0, lastDayAgreements);
    agreementsByPaymentDate.set(28, mockAgreements);

    await request(server)
      .post("/scheduled/avtalegiro/?date=2022-02-22&notify=true")
      .set("Authorization", "Bearer abc")
      .expect(200);

    expect(agreementsStub).toHaveBeenCalledWith(0);
    expect(agreementsStub).toHaveBeenCalledWith(28);
    // Should have 2x mock agreements, one x for the last of the month, one x for the 28th
    expect(shipmentStub).toHaveBeenCalledWith(mockAgreements.length * 2);
  });

  describe("deletions", function () {
    it("Processes deletions without sending unaccepted files again", async function () {
      defaultAgreements.mockResolvedValue([]);

      await request(server).post("/scheduled/avtalegiro/?date=2021-10-04").expect(200);

      expect(deletionsStub).toHaveBeenCalledOnce();
      expect(deletionsStub.mock.calls[0][1]).toBe(false);
      expect(loggingStub.mock.calls.some(([label]) => label === "AvtaleGiro - Deletions")).toBe(
        true,
      );
    });

    it("Still sends claims when processing deletions fails", async function () {
      defaultAgreements.mockResolvedValue(mockAgreements);
      deletionsStub.mockRejectedValue(new Error("SFTP is down"));
      const consoleStub = vi.spyOn(console, "error").mockReturnValue(undefined);

      await request(server).post("/scheduled/avtalegiro/?date=2021-10-04").expect(200);

      consoleStub.mockRestore();
      deletionsStub.mockResolvedValue({});
      expect(sendFileStub).toHaveBeenCalledOnce();
    });
  });

  describe("charge tracking", function () {
    beforeEach(function () {
      defaultAgreements.mockResolvedValue(mockAgreements);
    });

    it("Records a charge for every claimed agreement", async function () {
      await request(server).post("/scheduled/avtalegiro/?date=2021-10-04").expect(200);

      expect(addChargesStub).toHaveBeenCalledOnce();
      const [shipmentID, agreements, dueDate] = addChargesStub.mock.calls[0];
      expect(shipmentID).toBe(42);
      expect(agreements.map((a) => a.KID)).toStrictEqual(mockAgreements.map((a) => a.KID));
      expect(dueDate.toISODate()).toBe("2021-10-08");
    });

    it("Looks up claims for the due date's month", async function () {
      await request(server).post("/scheduled/avtalegiro/?date=2021-10-04").expect(200);

      expect(claimedKIDsStub).toHaveBeenCalledOnce();
      expect(claimedKIDsStub.mock.calls[0][0].toISODate()).toBe("2021-10-08");
    });

    it("Records the charges before sending the file", async function () {
      await request(server).post("/scheduled/avtalegiro/?date=2021-10-04").expect(200);

      expect(addChargesStub).toHaveBeenCalledBefore(avtalegiroFileStub);
      expect(addChargesStub).toHaveBeenCalledBefore(sendFileStub);
    });

    it("Does not send the file if recording the charges fails", async function () {
      addChargesStub.mockRejectedValue(new Error("Database is down"));

      await request(server).post("/scheduled/avtalegiro/?date=2021-10-04").expect(500);

      expect(sendFileStub).not.toHaveBeenCalled();
      addChargesStub.mockResolvedValue(undefined);
    });

    it("Skips agreements already claimed this month", async function () {
      claimedKIDsStub.mockResolvedValue(new Set([mockAgreements[1].KID]));

      await request(server).post("/scheduled/avtalegiro/?date=2021-10-04").expect(200);

      const expectedKIDs = [mockAgreements[0].KID, mockAgreements[2].KID];
      expect(shipmentStub).toHaveBeenCalledWith(2);
      expect(addChargesStub.mock.calls[0][1].map((a) => a.KID)).toStrictEqual(expectedKIDs);
      expect(avtalegiroFileStub.mock.calls[0][1].map((a) => a.KID)).toStrictEqual(expectedKIDs);
      expect(sendFileStub).toHaveBeenCalledOnce();
    });

    it("Logs which agreements were skipped", async function () {
      claimedKIDsStub.mockResolvedValue(new Set([mockAgreements[1].KID]));

      await request(server).post("/scheduled/avtalegiro/?date=2021-10-04").expect(200);

      const [, result] = loggingStub.mock.calls.filter(([label]) => label === "AvtaleGiro")[0];
      expect(result.alreadyClaimedKIDs).toStrictEqual([mockAgreements[1].KID]);
    });

    it("Sends nothing when every agreement is already claimed", async function () {
      claimedKIDsStub.mockResolvedValue(new Set(mockAgreements.map((a) => a.KID)));

      await request(server).post("/scheduled/avtalegiro/?date=2021-10-04").expect(200);

      expect(shipmentStub).not.toHaveBeenCalled();
      expect(addChargesStub).not.toHaveBeenCalled();
      expect(sendFileStub).not.toHaveBeenCalled();
      expect(loggingStub.mock.calls.filter(([label]) => label === "AvtaleGiro")).toHaveLength(1);
    });

    it("Only notifies agreements that are claimed", async function () {
      // The first agreement asked for notice, but was already claimed this month
      claimedKIDsStub.mockResolvedValue(new Set([mockAgreements[0].KID]));

      let tempEnv = config.env;
      config.env = "production";

      await request(server).post("/scheduled/avtalegiro/?date=2021-10-04&notify=true").expect(200);

      config.env = tempEnv;

      expect(sendNotificationStub).toHaveBeenCalledTimes(1);
      expect(sendNotificationStub.mock.calls[0][0].KID).toBe(mockAgreements[2].KID);
    });

    it("Does not claim agreements without an amount", async function () {
      defaultAgreements.mockResolvedValue([
        ...mockAgreements,
        { ...mockAgreements[0], id: 4, KID: "4", amount: 0 },
      ]);

      await request(server).post("/scheduled/avtalegiro/?date=2021-10-04").expect(200);

      expect(addChargesStub.mock.calls[0][1]).toHaveLength(mockAgreements.length);
    });
  });

  afterAll(function () {
    vi.restoreAllMocks();
  });
});

describe("POST /initiate-follow-ups", function () {
  let server;
  let getPaymentIntentsFromLastMonthStub;
  let getFollowUpsForPaymentIntentStub;
  let addPaymentFollowUpStub;
  let sendDonationFollowUpStub;
  let getDonorByKidStub;
  let donorDonationsStub;

  beforeAll(function () {
    server = express();
    const scheduledRoute = require("../routes/scheduled");
    server = express();
    server.use("/scheduled", scheduledRoute);

    getPaymentIntentsFromLastMonthStub = vi
      .spyOn(initialpaymentmethod, "getPaymentIntentsFromLastMonth")
      .mockReturnValue(undefined as any);
    getFollowUpsForPaymentIntentStub = vi
      .spyOn(initialpaymentmethod, "getFollowUpsForPaymentIntent")
      .mockReturnValue(undefined as any);
    donorDonationsStub = vi.spyOn(donations, "getByDonorId").mockReturnValue(undefined as any);
    addPaymentFollowUpStub = vi
      .spyOn(initialpaymentmethod, "addPaymentFollowUp")
      .mockReturnValue(undefined as any);
    sendDonationFollowUpStub = vi
      .spyOn(mail, "sendPaymentIntentFollowUp")
      .mockReturnValue(undefined);
    getDonorByKidStub = vi.spyOn(donors, "getByKID").mockReturnValue(undefined as any);

    const donor = {
      id: 1,
      email: "donor@mcdonorson.com",
      name: "Donor mc donorson",
      registered: new Date(),
    };

    getDonorByKidStub.mockResolvedValue(donor);
  });

  afterEach(function () {
    // Reset the history of stubs after each test
    vi.clearAllMocks();
  });

  afterAll(function () {
    // Restore the original functions after all tests
    vi.restoreAllMocks();
  });

  it("should initiate follow-ups for eligible payment intents", async function () {
    // Mock data
    const paymentIntents = [
      {
        Id: 1,
        Payment_method: paymentMethods.bank,
        Payment_amount: new Decimal(15000),
        KID_fordeling: "001",
        timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      },
      {
        Id: 2,
        Payment_method: paymentMethods.bank,
        Payment_amount: new Decimal(20000),
        KID_fordeling: "002",
        timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      },
    ];

    getPaymentIntentsFromLastMonthStub.mockResolvedValue(paymentIntents);
    getFollowUpsForPaymentIntentStub.mockResolvedValue([]);
    donorDonationsStub.mockResolvedValue([]);
    sendDonationFollowUpStub.mockResolvedValue(true);

    const response = await request(server).post("/scheduled/initiate-follow-ups").expect(200);

    expect(response.body.message).toBe("Follow-up process initiated successfully.");
    expect(sendDonationFollowUpStub).toHaveBeenCalledTimes(2);
    expect(addPaymentFollowUpStub).toHaveBeenCalledTimes(2);
  });

  it("should not initiate follow-ups for payment intents with received donations", async function () {
    const paymentIntents = [
      {
        Id: 1,
        Payment_method: paymentMethods.bank,
        Payment_amount: new Decimal(15000),
        KID_fordeling: "001",
        timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      },
    ];

    const recievedDonations = [
      {
        id: 1,
        donor: "Donor mc donorson",
        donorId: 1,
        email: "donor@mcdonorson.com",
        sum: 15000,
        transactionCost: 2,
        timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        paymentMethod: 2,
        KID: "001",
        taxUnitId: 321,
        metaOwnerId: 1,
      },
    ];

    getPaymentIntentsFromLastMonthStub.mockResolvedValue(paymentIntents);
    getFollowUpsForPaymentIntentStub.mockResolvedValue([]);
    donorDonationsStub.mockResolvedValue(recievedDonations);
    sendDonationFollowUpStub.mockResolvedValue(true);

    const response = await request(server).post("/scheduled/initiate-follow-ups").expect(200);

    expect(response.body.message).toBe("Follow-up process initiated successfully.");
    expect(addPaymentFollowUpStub).not.toHaveBeenCalled();
    expect(sendDonationFollowUpStub).not.toHaveBeenCalled();
  });

  it("should not initiate follow-ups for payment intents where the donor has donated any donations after the intent", async function () {
    const paymentIntents = [
      {
        Id: 1,
        Payment_method: paymentMethods.bank,
        Payment_amount: new Decimal(15000),
        KID_fordeling: "001",
        timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      },
    ];

    // A donation that was made after the payment intent, but with a different KID
    const recievedDonations = [
      {
        id: 1,
        donor: "Donor mc donorson",
        donorId: 1,
        email: "donor@mcdonorson.com",
        sum: 120,
        transactionCost: 2,
        timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        paymentMethod: 5,
        KID: "123",
        taxUnitId: null,
        metaOwnerId: 1,
      },
    ];

    getPaymentIntentsFromLastMonthStub.mockResolvedValue(paymentIntents);
    getFollowUpsForPaymentIntentStub.mockResolvedValue([]);
    donorDonationsStub.mockResolvedValue(recievedDonations);
    sendDonationFollowUpStub.mockResolvedValue(true);

    const response = await request(server).post("/scheduled/initiate-follow-ups").expect(200);

    expect(response.body.message).toBe("Follow-up process initiated successfully.");
    expect(addPaymentFollowUpStub).not.toHaveBeenCalled();
    expect(sendDonationFollowUpStub).not.toHaveBeenCalled();
  });

  it("should not initiate follow-ups for payment intents that are not due yet", async function () {
    const paymentIntents = [
      {
        Id: 1,
        Payment_method: paymentMethods.bank,
        Payment_amount: new Decimal(15000),
        KID_fordeling: "001",
        timestamp: new Date(),
      },
    ];

    getPaymentIntentsFromLastMonthStub.mockResolvedValue(paymentIntents);
    getFollowUpsForPaymentIntentStub.mockResolvedValue([]);
    sendDonationFollowUpStub.mockResolvedValue(true);

    const response = await request(server).post("/scheduled/initiate-follow-ups").expect(200);

    expect(response.body.message).toBe("Follow-up process initiated successfully.");
    expect(addPaymentFollowUpStub).not.toHaveBeenCalled();
    expect(sendDonationFollowUpStub).not.toHaveBeenCalled();
  });

  it("should not initiate follow-ups for payment intents that have reached the max follow-ups", async function () {
    const paymentIntents = [
      {
        Id: 1,
        Payment_method: paymentMethods.bank,
        Payment_amount: new Decimal(15000),
        KID_fordeling: "001",
        timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      },
    ];
    const followUps = [{ Follow_up_date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }];

    getPaymentIntentsFromLastMonthStub.mockResolvedValue(paymentIntents);
    getFollowUpsForPaymentIntentStub.mockResolvedValue(followUps);
    sendDonationFollowUpStub.mockResolvedValue(true);

    const response = await request(server).post("/scheduled/initiate-follow-ups").expect(200);

    expect(response.body.message).toBe("Follow-up process initiated successfully.");
    expect(addPaymentFollowUpStub).not.toHaveBeenCalled();
    expect(sendDonationFollowUpStub).not.toHaveBeenCalled();
  });

  it("should initiate only one follow-up for multiple intents with the same KID within 30 days", async function () {
    // Mock data with two payment intents for the same KID
    const paymentIntents = [
      {
        Id: 1,
        Payment_method: paymentMethods.bank,
        Payment_amount: new Decimal(15000),
        KID_fordeling: "001",
        timestamp: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000), // 25 days ago
      },
      {
        Id: 2,
        Payment_method: paymentMethods.bank,
        Payment_amount: new Decimal(20000),
        KID_fordeling: "001", // Same KID as the first intent
        timestamp: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000), // 20 days ago
      },
      {
        Id: 3,
        Payment_method: paymentMethods.bank,
        Payment_amount: new Decimal(10000),
        KID_fordeling: "002", // Different KID
        timestamp: new Date(Date.now() - 22 * 24 * 60 * 60 * 1000), // 22 days ago
      },
    ];

    getPaymentIntentsFromLastMonthStub.mockResolvedValue(paymentIntents);
    getFollowUpsForPaymentIntentStub.mockResolvedValue([]);
    donorDonationsStub.mockResolvedValue([]);
    sendDonationFollowUpStub.mockResolvedValue(true);

    const response = await request(server).post("/scheduled/initiate-follow-ups").expect(200);

    expect(response.body.message).toBe("Follow-up process initiated successfully.");

    // Check that only two follow-ups were initiated (one for KID "001" and one for KID "002")
    expect(sendDonationFollowUpStub).toHaveBeenCalledTimes(2);
    expect(addPaymentFollowUpStub).toHaveBeenCalledTimes(2);

    // Verify that the follow-up was sent for the most recent intent with KID "001"
    const followUpCalls = sendDonationFollowUpStub.mock.calls;
    const followUpForKID001 = followUpCalls.find((args) => args[0] === "001");
    expect(followUpForKID001).not.toBeNullable();
    expect(followUpForKID001[1]).toBe(20000); // Amount of the most recent intent

    // Verify that a follow-up was also sent for KID "002"
    const followUpForKID002 = followUpCalls.find((args) => args[0] === "002");
    expect(followUpForKID002).not.toBeNullable();
    expect(followUpForKID002[1]).toBe(10000);
  });

  it("should not send follow-ups for older intents of a KID after sending one for the most recent", async function () {
    // Mock data with two payment intents for the same KID
    const initialPaymentIntents = [
      {
        Id: 1,
        Payment_method: paymentMethods.bank,
        Payment_amount: new Decimal(15000),
        KID_fordeling: "001",
        timestamp: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000), // 25 days ago
      },
      {
        Id: 2,
        Payment_method: paymentMethods.bank,
        Payment_amount: new Decimal(20000),
        KID_fordeling: "001", // Same KID as the first intent
        timestamp: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000), // 20 days ago
      },
    ];

    // Set up initial conditions
    getPaymentIntentsFromLastMonthStub.mockResolvedValue(initialPaymentIntents);
    getFollowUpsForPaymentIntentStub.mockResolvedValue([]);
    donorDonationsStub.mockResolvedValue([]);
    sendDonationFollowUpStub.mockResolvedValue(true);

    // First run of the follow-up process
    await request(server).post("/scheduled/initiate-follow-ups").expect(200);

    // Verify that only one follow-up was sent (for the most recent intent)
    expect(sendDonationFollowUpStub).toHaveBeenCalledTimes(1);
    expect(addPaymentFollowUpStub).toHaveBeenCalledTimes(1);
    expect(sendDonationFollowUpStub.mock.calls[0][1]).toBe(20000); // Amount of the most recent intent

    // Reset call counts
    sendDonationFollowUpStub.mockClear();
    addPaymentFollowUpStub.mockClear();

    // Set up conditions for the second run

    // The newer intent now has a follow-up recorded
    // (sinon `withArgs(2)`; other calls keep the `resolves([])` set above)
    const newerIntentFollowUps = [{ Follow_up_date: new Date() }];
    getFollowUpsForPaymentIntentStub.mockImplementation(async (id) =>
      id === 2 ? newerIntentFollowUps : [],
    );

    // Second run of the follow-up process
    const response = await request(server).post("/scheduled/initiate-follow-ups").expect(200);

    expect(response.body.message).toBe("Follow-up process initiated successfully.");

    // Check that no new follow-ups were sent
    expect(sendDonationFollowUpStub).toHaveBeenCalledTimes(0);
    expect(addPaymentFollowUpStub).toHaveBeenCalledTimes(0);
  });
});

describe("POST /scheduled/mailchimp/newsletter/sync", function () {
  let server;

  beforeEach(function () {
    vi.spyOn(authMiddleware, "isAdmin", "get").mockReturnValue([]);
    const scheduledRoute = require("../routes/scheduled");
    server = express();
    server.use("/scheduled", scheduledRoute);
  });

  afterEach(function () {
    vi.restoreAllMocks();
  });

  it("syncs both ways in bulk and logs counts without email addresses", async function () {
    const mailchimp = require("@mailchimp/mailchimp_marketing");
    vi.spyOn(mailchimp, "setConfig").mockReturnValue(undefined);
    vi.spyOn(mailchimp.lists, "getListMembersInfo").mockResolvedValue({
      members: [
        { email_address: "subscribed@example.org", status: "subscribed" },
        { email_address: "Unsubscribed@example.org", status: "unsubscribed" },
      ],
    });
    const addOne = vi.spyOn(mailchimp.lists, "addListMember").mockResolvedValue(undefined);
    const batch = vi.spyOn(mailchimp.lists, "batchListMembers").mockResolvedValue({
      total_created: 1,
      errors: [{ email_address: "fake@example", error: "fake@example looks fake or invalid" }],
    });
    vi.spyOn(donors, "getNewsletterSyncRows").mockResolvedValue([
      { id: 1, email: "subscribed@example.org", newsletter: false },
      { id: 2, email: "unsubscribed@example.org", newsletter: true },
      { id: 3, email: "new@example.org", newsletter: true },
      { id: 4, email: "fake@example", newsletter: true },
    ]);
    const setNewsletter = vi.spyOn(donors, "setNewsletterForDonors").mockResolvedValue(undefined);
    const log = vi.spyOn(DAO.logging, "add").mockResolvedValue(undefined as any);
    const consoleLog = vi.spyOn(console, "log").mockReturnValue(undefined);

    const response = await request(server).post("/scheduled/mailchimp/newsletter/sync");

    expect(response.status).toBe(200);
    expect(setNewsletter).toHaveBeenCalledWith([2], false);
    expect(setNewsletter).toHaveBeenCalledWith([1], true);
    expect(addOne).not.toHaveBeenCalled();
    expect(batch).toHaveBeenCalledOnce();
    expect((batch.mock.calls[0][1] as any).members.map((m) => m.email_address)).toStrictEqual([
      "new@example.org",
      "fake@example",
    ]);
    expect(log.mock.calls[0][0]).toBe("MailChimp sync");
    expect(log.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        addedToMailchimp: 1,
        rejectedByMailchimp: 1,
        failedAddedToMailchimp: 0,
        addedToDonor: 1,
        removedFromDonor: 1,
      }),
    );
    const logged = JSON.stringify([log.mock.calls, consoleLog.mock.calls]);
    expect(logged).not.toContain("@example");
  });

  it("records the error and answers when the sync fails", async function () {
    const mailchimp = require("@mailchimp/mailchimp_marketing");
    vi.spyOn(mailchimp, "setConfig").mockReturnValue(undefined);
    vi.spyOn(mailchimp.lists, "getListMembersInfo").mockRejectedValue(
      new Error("Mailchimp is down"),
    );
    const log = vi.spyOn(DAO.logging, "add").mockResolvedValue(undefined as any);

    const response = await request(server).post("/scheduled/mailchimp/newsletter/sync");

    expect(response.status).toBe(500);
    expect(log.mock.calls[0][0]).toBe("(Failed - Partial) Mailchimp sync");
    expect(log.mock.calls[0][1].error).toBe("Mailchimp is down");
  });
});
