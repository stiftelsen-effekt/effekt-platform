import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from "vitest";
import { DAO } from "../custom_modules/DAO";
import * as authMiddleware from "../custom_modules/authorization/authMiddleware";
import * as giroSftp from "../custom_modules/giroSftp";
import * as sftp from "../custom_modules/sftp";
import express from "express";
import request from "supertest";
import { DateTime } from "luxon";
import * as avtalegiroDeletions from "../custom_modules/avtalegiro/deletions";

const avtalegiro = require("../custom_modules/avtalegiro");
const mail = require("../custom_modules/mail");

describe("POST /scheduled/avtalegiro/retry", function () {
  const mockAgreements = [
    {
      id: 1,
      KID: "002556289731589",
      paymentDate: 16,
      amount: 50000,
      notice: true,
      active: true,
    },
    {
      id: 2,
      KID: "000638723319577",
      paymentDate: 16,
      amount: 340000,
      notice: false,
      active: true,
    },
    {
      id: 3,
      KID: "000675978627833",
      paymentDate: 16,
      amount: 5000000,
      notice: true,
      active: true,
    },
  ];

  const receipt = (shipmentID: number, kind = "GODKJENT") => ({
    name: `KV.${kind}.F${shipmentID.toString().padStart(7, "0")}.D230509.T133148.K5552827.html`,
  });

  let server;

  let sendNotificationStub;
  let shipmentStub;
  let agreementsStub;
  let loggingStub;
  let sendFileStub;
  let dueDateStub;
  let getConnectionStub;
  let shipmentsForDueDateStub;
  let supersedeStub;
  let claimedKIDsStub;
  let addChargesStub;
  let untrackedStub;
  let deletionsStub;
  let failedUploadsStub;
  let alertStub;

  const logsWithLabel = (label: string) =>
    loggingStub.mock.calls.filter(([logLabel]) => logLabel === label);

  const receiptsOnServer = (shipmentIDs: number[], rejectedShipmentIDs: number[] = []) => {
    getConnectionStub.mockResolvedValue({
      list: vi
        .fn()
        .mockResolvedValue([
          ...shipmentIDs.map((id) => receipt(id)),
          ...rejectedShipmentIDs.map((id) => receipt(id, "AVVIST")),
        ]),
      end: vi.fn().mockResolvedValue(true),
    });
  };

  beforeAll(function () {
    vi.spyOn(authMiddleware, "isAdmin", "get").mockReturnValue([]);

    deletionsStub = vi
      .spyOn(avtalegiroDeletions, "processAvtaleGiroDeletions")
      .mockResolvedValue({} as any);

    vi.spyOn(avtalegiro, "generateAvtaleGiroFile").mockResolvedValue(Buffer.from("", "utf-8"));

    sendNotificationStub = vi.spyOn(mail, "sendAvtalegiroNotification").mockResolvedValue(true);

    shipmentStub = vi.spyOn(DAO.avtalegiroagreements, "addShipment").mockResolvedValue(700);

    agreementsStub = vi
      .spyOn(DAO.avtalegiroagreements, "getByPaymentDate")
      .mockReturnValue(undefined as any);

    shipmentsForDueDateStub = vi
      .spyOn(DAO.avtalegirocharges, "getShipmentIDsForDueDate")
      .mockReturnValue(undefined as any);
    supersedeStub = vi
      .spyOn(DAO.avtalegirocharges, "supersedeShipments")
      .mockResolvedValue(undefined);
    claimedKIDsStub = vi
      .spyOn(DAO.avtalegirocharges, "getClaimedKIDsForMonth")
      .mockReturnValue(undefined as any);
    addChargesStub = vi.spyOn(DAO.avtalegirocharges, "addCharges").mockResolvedValue(undefined);
    untrackedStub = vi
      .spyOn(DAO.avtalegirocharges, "getUntrackedShipmentIDs")
      .mockReturnValue(undefined as any);
    failedUploadsStub = vi
      .spyOn(DAO.avtalegirocharges, "getFailedUploadShipmentIDs")
      .mockReturnValue(undefined as any);
    alertStub = vi.spyOn(mail, "sendAvtaleGiroRetryAlert").mockResolvedValue(true);

    getConnectionStub = vi.spyOn(sftp, "getConnection").mockReturnValue(undefined as any);

    dueDateStub = vi.spyOn(avtalegiro, "getDueDates").mockReturnValue(undefined);

    loggingStub = vi.spyOn(DAO.logging, "add").mockResolvedValue(undefined as any);

    sendFileStub = vi.spyOn(giroSftp, "sendFile").mockReturnValue(undefined as any);

    const scheduledRoute = require("../routes/scheduled");
    server = express();
    server.use("/scheduled", scheduledRoute);
  });

  beforeEach(function () {
    vi.clearAllMocks();
    // Tests set behaviour for specific calls and arguments, which resetHistory keeps
    agreementsStub.mockReset();
    shipmentsForDueDateStub.mockReset();
    agreementsStub.mockResolvedValue(mockAgreements);
    claimedKIDsStub.mockResolvedValue(new Set());
    shipmentsForDueDateStub.mockResolvedValue([]);
    untrackedStub.mockResolvedValue([]);
    failedUploadsStub.mockResolvedValue([]);
    sendFileStub.mockResolvedValue(undefined);
    receiptsOnServer([]);
  });

  it("Should not retry if no claim dates for date", async () => {
    dueDateStub.mockReturnValue([]);

    await request(server).post("/scheduled/avtalegiro/retry?date=2023-05-10").expect(200);

    expect(dueDateStub).toHaveBeenCalledOnce();
    expect(agreementsStub).not.toHaveBeenCalled();
    expect(sendNotificationStub).not.toHaveBeenCalled();
    expect(sendFileStub).not.toHaveBeenCalled();
  });

  it("Looks up today's shipments for the claim date", async () => {
    dueDateStub.mockReturnValue([DateTime.fromISO("2023-05-16")]);
    shipmentsForDueDateStub.mockResolvedValue([651]);
    receiptsOnServer([651]);

    await request(server).post("/scheduled/avtalegiro/retry?date=2023-05-10").expect(200);

    const [dueDate, generatedOn] = shipmentsForDueDateStub.mock.calls[0];
    expect(dueDate.toISODate()).toBe("2023-05-16");
    expect(generatedOn.toISODate()).toBe("2023-05-10");
  });

  it("Should ignore the claim date if the reciept is present", async () => {
    dueDateStub.mockReturnValue([DateTime.fromISO("2023-05-16")]);
    shipmentsForDueDateStub.mockResolvedValue([651]);
    receiptsOnServer([649, 650, 651]);

    await request(server).post("/scheduled/avtalegiro/retry?date=2023-05-10").expect(200);

    expect(agreementsStub).not.toHaveBeenCalled();
    expect(supersedeStub).not.toHaveBeenCalled();
    expect(addChargesStub).not.toHaveBeenCalled();
    expect(sendFileStub).not.toHaveBeenCalled();
  });

  it("Should ignore the claim date if any of its shipments has a reciept", async () => {
    dueDateStub.mockReturnValue([DateTime.fromISO("2023-05-16")]);
    shipmentsForDueDateStub.mockResolvedValue([650, 651]);
    receiptsOnServer([651]);

    await request(server).post("/scheduled/avtalegiro/retry?date=2023-05-10").expect(200);

    expect(supersedeStub).not.toHaveBeenCalled();
    expect(sendFileStub).not.toHaveBeenCalled();
  });

  it("Should supersede the shipment and send the claims again if it was rejected", async () => {
    dueDateStub.mockReturnValue([DateTime.fromISO("2023-05-16")]);
    shipmentsForDueDateStub.mockResolvedValue([651]);
    receiptsOnServer([649, 650], [651]);

    const res = await request(server)
      .post("/scheduled/avtalegiro/retry?date=2023-05-10")
      .expect(200);

    expect(supersedeStub).toHaveBeenCalledExactlyOnceWith([651]);
    // Superseding first lets the claims in the old shipment be claimed again
    expect(supersedeStub).toHaveBeenCalledBefore(claimedKIDsStub);
    expect(shipmentStub).toHaveBeenCalledExactlyOnceWith(mockAgreements.length);
    expect(addChargesStub.mock.calls[0][0]).toBe(700);
    expect(addChargesStub.mock.calls[0][1]).toHaveLength(mockAgreements.length);
    expect(addChargesStub).toHaveBeenCalledBefore(sendFileStub);
    expect(sendFileStub).toHaveBeenCalledOnce();
    expect(sendFileStub.mock.calls[0][1]).toBe("DIRREM100523.160523.700");
    expect(alertStub).not.toHaveBeenCalled();
    expect(res.body.claimDates[0].path).toBe("resend");
    const retryLog = logsWithLabel("AvtaleGiro - Retry")[0][1];
    expect(retryLog.path).toBe("resend");
    expect(retryLog.shipments[0].receiptStatus).toBe("rejected");
    expect(retryLog.file).toBeTypeOf("string");
  });

  it("Does not send again, and alerts, if there is no receipt yet", async () => {
    dueDateStub.mockReturnValue([DateTime.fromISO("2023-05-16")]);
    shipmentsForDueDateStub.mockResolvedValue([651]);
    receiptsOnServer([649, 650]);

    const res = await request(server)
      .post("/scheduled/avtalegiro/retry?date=2023-05-10")
      .expect(409);

    expect(supersedeStub).not.toHaveBeenCalled();
    expect(addChargesStub).not.toHaveBeenCalled();
    expect(sendFileStub).not.toHaveBeenCalled();
    expect(alertStub).toHaveBeenCalledOnce();
    const [date, claimDates, filesSeen] = alertStub.mock.calls[0];
    expect(date).toBe("2023-05-10");
    expect(claimDates).toStrictEqual([
      {
        claimDate: "2023-05-16",
        shipments: [
          { shipmentID: 651, receiptStatus: "none", uploadFailed: false, receiptFiles: [] },
        ],
      },
    ]);
    expect(filesSeen).toBe(2);
    // Shipment numbers and receipt file names only, no donor data
    expect(JSON.stringify(alertStub.mock.calls[0])).not.toContain(mockAgreements[0].KID);
    expect(res.body.alerted).toBe(true);
    const retryLog = logsWithLabel("AvtaleGiro - Retry")[0][1];
    expect(retryLog.path).toBe("alert");
  });

  it("Does not send again, and alerts, if the receipts are ambiguous", async () => {
    dueDateStub.mockReturnValue([DateTime.fromISO("2023-05-16")]);
    shipmentsForDueDateStub.mockResolvedValue([651]);
    getConnectionStub.mockResolvedValue({
      list: vi
        .fn()
        .mockResolvedValue([{ name: "KV.DELVIS.F0000651.D230509.T133148.K5552827.html" }]),
      end: vi.fn().mockResolvedValue(true),
    });

    await request(server).post("/scheduled/avtalegiro/retry?date=2023-05-10").expect(409);

    expect(supersedeStub).not.toHaveBeenCalled();
    expect(sendFileStub).not.toHaveBeenCalled();
    expect(alertStub).toHaveBeenCalledOnce();
    expect(alertStub.mock.calls[0][1][0].shipments[0]).toEqual(
      expect.objectContaining({
        receiptStatus: "ambiguous",
        receiptFiles: ["KV.DELVIS.F0000651.D230509.T133148.K5552827.html"],
      }),
    );
  });

  it("Sends again if the upload of the shipment failed", async () => {
    dueDateStub.mockReturnValue([DateTime.fromISO("2023-05-16")]);
    shipmentsForDueDateStub.mockResolvedValue([651]);
    failedUploadsStub.mockResolvedValue([651]);

    await request(server).post("/scheduled/avtalegiro/retry?date=2023-05-10").expect(200);

    expect(failedUploadsStub).toHaveBeenCalledExactlyOnceWith([651]);
    expect(supersedeStub).toHaveBeenCalledExactlyOnceWith([651]);
    expect(sendFileStub).toHaveBeenCalledOnce();
    expect(alertStub).not.toHaveBeenCalled();
  });

  it("Does not send again if the upload failed but a receipt arrived anyway", async () => {
    dueDateStub.mockReturnValue([DateTime.fromISO("2023-05-16")]);
    shipmentsForDueDateStub.mockResolvedValue([651]);
    failedUploadsStub.mockResolvedValue([651]);
    receiptsOnServer([651]);

    await request(server).post("/scheduled/avtalegiro/retry?date=2023-05-10").expect(200);

    expect(supersedeStub).not.toHaveBeenCalled();
    expect(sendFileStub).not.toHaveBeenCalled();
  });

  it("Sends again when a person asks for the shipment to be sent again", async () => {
    dueDateStub.mockReturnValue([DateTime.fromISO("2023-05-16")]);
    shipmentsForDueDateStub.mockResolvedValue([651]);

    await request(server)
      .post("/scheduled/avtalegiro/retry?date=2023-05-10&resend=651")
      .expect(200);

    expect(supersedeStub).toHaveBeenCalledExactlyOnceWith([651]);
    expect(sendFileStub).toHaveBeenCalledOnce();
    expect(logsWithLabel("AvtaleGiro - Retry")[0][1].path).toBe("manual-resend");
  });

  it("Does not send an accepted shipment again even when a person asks", async () => {
    dueDateStub.mockReturnValue([DateTime.fromISO("2023-05-16")]);
    shipmentsForDueDateStub.mockResolvedValue([651]);
    receiptsOnServer([651]);

    await request(server)
      .post("/scheduled/avtalegiro/retry?date=2023-05-10&resend=651")
      .expect(200);

    expect(sendFileStub).not.toHaveBeenCalled();
  });

  it("Should claim the date if no shipment was recorded for it", async () => {
    dueDateStub.mockReturnValue([DateTime.fromISO("2023-05-16")]);
    shipmentsForDueDateStub.mockResolvedValue([]);

    await request(server).post("/scheduled/avtalegiro/retry?date=2023-05-10").expect(200);

    expect(agreementsStub).toHaveBeenCalled();
    expect(addChargesStub).toHaveBeenCalledOnce();
    expect(sendFileStub).toHaveBeenCalledOnce();
  });

  it("Should not claim agreements already claimed this month in another shipment", async () => {
    dueDateStub.mockReturnValue([DateTime.fromISO("2023-05-16")]);
    shipmentsForDueDateStub.mockResolvedValue([651]);
    receiptsOnServer([], [651]);
    claimedKIDsStub.mockResolvedValue(new Set([mockAgreements[0].KID]));

    await request(server).post("/scheduled/avtalegiro/retry?date=2023-05-10").expect(200);

    expect(addChargesStub.mock.calls[0][1].map((a) => a.KID)).toStrictEqual([
      mockAgreements[1].KID,
      mockAgreements[2].KID,
    ]);
  });

  it("Retries for all claim dates with rejected shipments", async () => {
    dueDateStub.mockReturnValue([
      DateTime.fromISO("2023-05-16"),
      DateTime.fromISO("2023-05-17"),
      DateTime.fromISO("2023-05-18"),
    ]);
    shipmentsForDueDateStub.mockResolvedValueOnce([650]);
    shipmentsForDueDateStub.mockResolvedValueOnce([651]);
    shipmentsForDueDateStub.mockResolvedValueOnce([652]);
    receiptsOnServer([650], [651, 652]);

    await request(server).post("/scheduled/avtalegiro/retry?date=2023-05-10").expect(200);

    expect(supersedeStub).toHaveBeenCalledTimes(2);
    expect(supersedeStub.mock.calls[0][0]).toStrictEqual([651]);
    expect(supersedeStub.mock.calls[1][0]).toStrictEqual([652]);
    expect(sendFileStub).toHaveBeenCalledTimes(2);
  });

  it("Continues to the next claim date when one has no agreements", async () => {
    dueDateStub.mockReturnValue([DateTime.fromISO("2023-05-16"), DateTime.fromISO("2023-05-17")]);
    // Calls for other days keep the default from beforeEach
    agreementsStub.mockImplementation(async (paymentDate) =>
      paymentDate === 16 ? [] : mockAgreements,
    );

    await request(server).post("/scheduled/avtalegiro/retry?date=2023-05-10").expect(200);

    expect(sendFileStub).toHaveBeenCalledOnce();
    expect(sendFileStub.mock.calls[0][1]).toBe("DIRREM100523.170523.700");
    expect(logsWithLabel("AvtaleGiro - Retry")).toHaveLength(2);
  });

  it("Processes deletions and sends unaccepted deletion files again", async () => {
    dueDateStub.mockReturnValue([]);

    await request(server).post("/scheduled/avtalegiro/retry?date=2023-05-10").expect(200);

    expect(deletionsStub).toHaveBeenCalledOnce();
    expect(deletionsStub.mock.calls[0][1]).toBe(true);
  });

  it("Skips the retry on the day of the deploy if shipments were sent before charges were recorded", async () => {
    dueDateStub.mockReturnValue([DateTime.fromISO("2023-05-16"), DateTime.fromISO("2023-05-17")]);
    untrackedStub.mockResolvedValue([640, 641]);

    await request(server).post("/scheduled/avtalegiro/retry?date=2023-05-10").expect(200);

    expect(untrackedStub.mock.calls[0][0].toISODate()).toBe("2023-05-10");
    expect(shipmentsForDueDateStub).not.toHaveBeenCalled();
    expect(supersedeStub).not.toHaveBeenCalled();
    expect(addChargesStub).not.toHaveBeenCalled();
    expect(sendFileStub).not.toHaveBeenCalled();
    const retryLogs = logsWithLabel("AvtaleGiro - Retry");
    expect(retryLogs).toHaveLength(1);
    expect(retryLogs[0][1].untrackedShipmentIDs).toStrictEqual([640, 641]);
    // Deletions are still processed
    expect(deletionsStub).toHaveBeenCalledOnce();
  });

  it("Does not look for untracked shipments on days without claim dates", async () => {
    dueDateStub.mockReturnValue([]);

    await request(server).post("/scheduled/avtalegiro/retry?date=2023-05-13").expect(200);

    expect(untrackedStub).not.toHaveBeenCalled();
  });

  it("Records a failed upload of the claims file, so the retry can send it again", async () => {
    dueDateStub.mockReturnValue([DateTime.fromISO("2023-05-16")]);
    sendFileStub.mockRejectedValue(new Error("Connection reset"));

    await request(server).post("/scheduled/avtalegiro?date=2023-05-10").expect(500);

    const failedLogs = logsWithLabel("AvtaleGiro - Upload failed");
    expect(failedLogs).toHaveLength(1);
    expect(failedLogs[0][1]).toStrictEqual({
      shipmentID: 700,
      claimDate: "2023-05-16",
      filename: "DIRREM100523.160523.700",
      error: "Connection reset",
    });
  });

  it("Does not notify donors again", async () => {
    dueDateStub.mockReturnValue([DateTime.fromISO("2023-05-16")]);

    await request(server).post("/scheduled/avtalegiro/retry?date=2023-05-10").expect(200);

    expect(sendNotificationStub).not.toHaveBeenCalled();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });
});
