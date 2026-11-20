import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import { DateTime } from "luxon";
import { DAO } from "../custom_modules/DAO";
import * as giroSftp from "../custom_modules/giroSftp";
import {
  processAvtaleGiroDeletions,
  requestDeletionOfUpcomingCharges,
} from "../custom_modules/avtalegiro/deletions";

const avtalegiro = require("../custom_modules/avtalegiro");

const oslo = (iso: string) => DateTime.fromISO(iso, { zone: "Europe/Oslo" });

const charge = (id: number, dueDate: string, KID = "111", amount = 50000) => ({
  id,
  KID,
  amount,
  dueDate,
});

describe("AvtaleGiro deletions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("requestDeletionOfUpcomingCharges", () => {
    let upcomingStub: MockInstance;
    let requestStub: MockInstance;

    beforeEach(() => {
      upcomingStub = vi
        .spyOn(DAO.avtalegirocharges, "getUpcomingChargesByKID")
        .mockReturnValue(undefined as any);
      requestStub = vi
        .spyOn(DAO.avtalegirocharges, "requestDeletions")
        .mockResolvedValue(undefined);
    });

    it("requests deletion of claims that can still be stopped", async () => {
      upcomingStub.mockResolvedValue([charge(9, "2026-10-27")]);

      const result = await requestDeletionOfUpcomingCharges("111", oslo("2026-10-22T15:00"));

      expect(requestStub).toHaveBeenCalledExactlyOnceWith([9]);
      expect(result.deletable.map((c) => c.id)).toStrictEqual([9]);
      expect(result.tooLate).toHaveLength(0);
    });

    it("leaves claims too close to their due date to be charged", async () => {
      upcomingStub.mockResolvedValue([charge(8, "2026-10-23"), charge(9, "2026-10-27")]);

      // Thursday afternoon: too late for Friday's claim, in time for Tuesday's
      const result = await requestDeletionOfUpcomingCharges("111", oslo("2026-10-22T15:00"));

      expect(requestStub).toHaveBeenCalledExactlyOnceWith([9]);
      expect(result.tooLate.map((c) => c.id)).toStrictEqual([8]);
    });

    it("looks up claims due from today in Oslo", async () => {
      upcomingStub.mockResolvedValue([]);

      // 23:30 UTC on the 22nd is the 23rd in Oslo
      await requestDeletionOfUpcomingCharges(
        "111",
        DateTime.fromISO("2026-10-22T23:30:00Z", { zone: "utc" }),
      );

      const [KID, from] = upcomingStub.mock.calls[0];
      expect(KID).toBe("111");
      expect(from.toISODate()).toBe("2026-10-23");
    });

    it("requests nothing when the agreement has no upcoming claims", async () => {
      upcomingStub.mockResolvedValue([]);

      const result = await requestDeletionOfUpcomingCharges("111", oslo("2026-10-22T15:00"));

      expect(requestStub).toHaveBeenCalledExactlyOnceWith([]);
      expect(result).toStrictEqual({ deletable: [], tooLate: [] });
    });
  });

  describe("processAvtaleGiroDeletions", () => {
    let sentShipmentsStub: MockInstance;
    let receiptStub: MockInstance;
    let confirmStub: MockInstance;
    let requeueStub: MockInstance;
    let requestsStub: MockInstance;
    let restoreStub: MockInstance;
    let shipmentStub: MockInstance;
    let markSentStub: MockInstance;
    let fileStub: MockInstance;
    let sendFileStub: MockInstance;

    // Thursday 22 October 2026, during the 10:00 run
    const tenOClock = oslo("2026-10-22T10:00:05");

    beforeEach(() => {
      sentShipmentsStub = vi
        .spyOn(DAO.avtalegirocharges, "getSentDeletionShipmentIDs")
        .mockResolvedValue([]);
      receiptStub = vi.spyOn(giroSftp, "checkIfAcceptedReciept").mockResolvedValue(false);
      confirmStub = vi
        .spyOn(DAO.avtalegirocharges, "confirmDeletionShipment")
        .mockResolvedValue(undefined);
      requeueStub = vi
        .spyOn(DAO.avtalegirocharges, "requeueDeletionShipment")
        .mockResolvedValue(undefined);
      requestsStub = vi.spyOn(DAO.avtalegirocharges, "getDeletionRequests").mockResolvedValue([]);
      restoreStub = vi
        .spyOn(DAO.avtalegirocharges, "restoreDeletionRequests")
        .mockResolvedValue(undefined);
      shipmentStub = vi.spyOn(DAO.avtalegiroagreements, "addShipment").mockResolvedValue(800);
      markSentStub = vi
        .spyOn(DAO.avtalegirocharges, "markDeletionsSent")
        .mockResolvedValue(undefined);
      fileStub = vi
        .spyOn(avtalegiro, "generateAvtaleGiroDeletionFile")
        .mockResolvedValue(Buffer.from("deletions", "utf-8"));
      sendFileStub = vi.spyOn(giroSftp, "sendFile").mockResolvedValue(undefined);
    });

    it("sends the requested deletions in one file", async () => {
      requestsStub.mockResolvedValue([
        charge(9, "2026-10-27"),
        charge(12, "2026-10-28", "222", 20000),
      ]);

      const result = await processAvtaleGiroDeletions(tenOClock, false);

      expect(shipmentStub).toHaveBeenCalledExactlyOnceWith(2);
      expect(markSentStub).toHaveBeenCalledExactlyOnceWith([9, 12], 800);
      const [shipmentID, deletions] = fileStub.mock.calls[0];
      expect(shipmentID).toBe(800);
      expect(
        deletions.map((d) => ({ KID: d.KID, amount: d.amount, dueDate: d.dueDate.toISODate() })),
      ).toStrictEqual([
        { KID: "111", amount: 50000, dueDate: "2026-10-27" },
        { KID: "222", amount: 20000, dueDate: "2026-10-28" },
      ]);
      expect(result.sentChargeIDs).toStrictEqual([9, 12]);
      expect(result.shipmentID).toBe(800);
      expect(result.file).toBe("deletions");
    });

    it("names the file like claims files, with the earliest due date", async () => {
      requestsStub.mockResolvedValue([charge(12, "2026-10-28"), charge(9, "2026-10-27")]);

      await processAvtaleGiroDeletions(tenOClock, false);

      expect(sendFileStub.mock.calls[0][1]).toBe("DIRREM221026.271026.800");
    });

    it("records the deletions as sent before sending the file", async () => {
      requestsStub.mockResolvedValue([charge(9, "2026-10-27")]);

      await processAvtaleGiroDeletions(tenOClock, false);

      expect(markSentStub).toHaveBeenCalledBefore(sendFileStub);
    });

    it("sends nothing when no deletions are requested", async () => {
      const result = await processAvtaleGiroDeletions(tenOClock, false);

      expect(shipmentStub).not.toHaveBeenCalled();
      expect(sendFileStub).not.toHaveBeenCalled();
      expect(result.shipmentID).toBeNull();
    });

    it("puts requests past the deadline back to claimed", async () => {
      // Friday's claim had to be deleted by Thursday 14:00
      requestsStub.mockResolvedValue([charge(8, "2026-10-23"), charge(9, "2026-10-27")]);

      const result = await processAvtaleGiroDeletions(oslo("2026-10-22T13:50"), true);

      expect(restoreStub).toHaveBeenCalledExactlyOnceWith([8]);
      expect(markSentStub).toHaveBeenCalledExactlyOnceWith([9], 800);
      expect(result.expiredChargeIDs).toStrictEqual([8]);
    });

    it("sends a request made just before the last run", async () => {
      requestsStub.mockResolvedValue([charge(8, "2026-10-23")]);

      await processAvtaleGiroDeletions(oslo("2026-10-22T13:00:05"), true);

      expect(markSentStub).toHaveBeenCalledExactlyOnceWith([8], 800);
      expect(restoreStub.mock.calls[0][0]).toStrictEqual([]);
    });

    it("confirms deletion files that MPS accepted", async () => {
      sentShipmentsStub.mockResolvedValue([798, 799]);
      receiptStub.withArgs(798).resolves(true);
      receiptStub.withArgs(799).resolves(false);

      const result = await processAvtaleGiroDeletions(tenOClock, false);

      expect(confirmStub).toHaveBeenCalledExactlyOnceWith(798);
      expect(result.confirmedShipmentIDs).toStrictEqual([798]);
    });

    it("waits for receipts in the 10:00 run", async () => {
      sentShipmentsStub.mockResolvedValue([799]);

      const result = await processAvtaleGiroDeletions(tenOClock, false);

      expect(requeueStub).not.toHaveBeenCalled();
      expect(result.requeuedShipmentIDs).toHaveLength(0);
    });

    it("sends unaccepted deletion files again in the retry runs", async () => {
      sentShipmentsStub.mockResolvedValue([799]);
      // Requeued requests come back from the queue
      requestsStub.mockResolvedValue([charge(9, "2026-10-27")]);

      const result = await processAvtaleGiroDeletions(oslo("2026-10-22T11:00:05"), true);

      expect(requeueStub).toHaveBeenCalledExactlyOnceWith(799);
      expect(requeueStub).toHaveBeenCalledBefore(requestsStub);
      expect(result.requeuedShipmentIDs).toStrictEqual([799]);
      expect(sendFileStub).toHaveBeenCalledOnce();
    });

    it("does nothing on weekends and holidays", async () => {
      requestsStub.mockResolvedValue([charge(9, "2026-10-27")]);

      const saturday = await processAvtaleGiroDeletions(oslo("2026-10-24T10:00"), true);
      const goodFriday = await processAvtaleGiroDeletions(oslo("2026-04-03T10:00"), true);

      expect(saturday.skipped).toBe(true);
      expect(goodFriday.skipped).toBe(true);
      expect(sentShipmentsStub).not.toHaveBeenCalled();
      expect(requestsStub).not.toHaveBeenCalled();
      expect(sendFileStub).not.toHaveBeenCalled();
    });

    it("sends weekend cancellations on the next banking day", async () => {
      // Cancelled on Saturday for Tuesday's claim, sent in Monday's 10:00 run
      requestsStub.mockResolvedValue([charge(9, "2026-10-27")]);

      await processAvtaleGiroDeletions(oslo("2026-10-26T10:00:05"), false);

      expect(markSentStub).toHaveBeenCalledExactlyOnceWith([9], 800);
    });
  });
});
