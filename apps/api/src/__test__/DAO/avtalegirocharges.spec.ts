import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import { DateTime } from "luxon";
import { DAO } from "../../custom_modules/DAO";
import { avtalegirocharges } from "../../custom_modules/DAO_modules/avtalegirocharges";

describe("DAO avtalegirocharges", () => {
  let queryStub: MockInstance;

  beforeEach(() => {
    queryStub = vi.spyOn(DAO, "query").mockReturnValue(undefined as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("addCharges", () => {
    it("inserts one claimed row per agreement", async () => {
      queryStub.mockResolvedValue([{ affectedRows: 2 }, []]);

      await avtalegirocharges.addCharges(
        42,
        [
          { id: 1, KID: "111", amount: 50000, paymentDate: 27, notice: true },
          { id: 2, KID: "222", amount: 340000, paymentDate: 27, notice: false },
        ],
        DateTime.fromISO("2026-10-27"),
      );

      expect(queryStub).toHaveBeenCalledOnce();
      const [sql, params] = queryStub.mock.calls[0];
      expect(sql).toContain("INSERT INTO Avtalegiro_agreement_charges");
      const [rows] = params;
      expect(rows.map((row) => row.slice(0, 6))).toStrictEqual([
        [1, 42, "111", "2026-10-27", 50000, "CLAIMED"],
        [2, 42, "222", "2026-10-27", 340000, "CLAIMED"],
      ]);
      // created and last_updated are written from the app (UTC), not by the column default
      expect(sql).toContain("created, last_updated");
      for (const row of rows) {
        expect(row[6]).toBeInstanceOf(Date);
        expect(row[7]).toBe(row[6]);
      }
    });

    it("does nothing without agreements", async () => {
      await avtalegirocharges.addCharges(42, [], DateTime.fromISO("2026-10-27"));

      expect(queryStub).not.toHaveBeenCalled();
    });
  });

  describe("getClaimedKIDsForMonth", () => {
    it("queries the whole month, counting only claims that are or will be charged", async () => {
      queryStub.mockResolvedValue([[{ KID: "111" }, { KID: "222" }], []]);

      const claimed = await avtalegirocharges.getClaimedKIDsForMonth(
        DateTime.fromISO("2026-10-27"),
      );

      expect(claimed).toStrictEqual(new Set(["111", "222"]));
      const [sql, params] = queryStub.mock.calls[0];
      expect(sql).toContain("due_date BETWEEN ? AND ?");
      expect(params).toStrictEqual(["2026-10-01", "2026-10-31", ["CLAIMED", "COMPLETED"]]);
    });

    it("returns an empty set when nothing is claimed", async () => {
      queryStub.mockResolvedValue([[], []]);

      const claimed = await avtalegirocharges.getClaimedKIDsForMonth(
        DateTime.fromISO("2026-02-10"),
      );

      expect(claimed.size).toBe(0);
      expect(queryStub.mock.calls[0][1]).toStrictEqual([
        "2026-02-01",
        "2026-02-28",
        ["CLAIMED", "COMPLETED"],
      ]);
    });
  });

  describe("getShipmentIDsForDueDate", () => {
    it("finds today's shipments for the due date", async () => {
      queryStub.mockResolvedValue([[{ shipmentID: 650 }, { shipmentID: 651 }], []]);

      const shipmentIDs = await avtalegirocharges.getShipmentIDsForDueDate(
        DateTime.fromISO("2026-10-24"),
        DateTime.fromISO("2026-10-20T11:00:00"),
      );

      expect(shipmentIDs).toStrictEqual([650, 651]);
      const [sql, params] = queryStub.mock.calls[0];
      expect(sql).toContain("DATE(S.generated) = ?");
      expect(params).toStrictEqual(["2026-10-24", "2026-10-20", "SUPERSEDED"]);
    });
  });

  describe("getUntrackedShipmentIDs", () => {
    it("finds the day's shipments sent before the first recorded charge", async () => {
      queryStub.mockResolvedValue([[{ ID: 640 }, { ID: 641 }], []]);

      const shipmentIDs = await avtalegirocharges.getUntrackedShipmentIDs(
        DateTime.fromISO("2026-10-20T11:00:00"),
      );

      expect(shipmentIDs).toStrictEqual([640, 641]);
      const [sql, params] = queryStub.mock.calls[0];
      expect(sql).toContain("NOT EXISTS");
      expect(sql).toContain("MIN(shipmentID)");
      expect(params).toStrictEqual(["2026-10-20"]);
    });
  });

  describe("supersedeShipments", () => {
    it("marks the claimed charges in the shipments as superseded", async () => {
      queryStub.mockResolvedValue([{ affectedRows: 3 }, []]);

      await avtalegirocharges.supersedeShipments([650, 651]);

      const [sql, params] = queryStub.mock.calls[0];
      expect(sql).toContain("UPDATE Avtalegiro_agreement_charges SET status = ?");
      expect(params).toStrictEqual(["SUPERSEDED", [650, 651], "CLAIMED"]);
    });

    it("does nothing without shipments", async () => {
      await avtalegirocharges.supersedeShipments([]);

      expect(queryStub).not.toHaveBeenCalled();
    });
  });

  describe("getOpenChargesByKID", () => {
    it("maps payable charges without a payment, including deleted ones", async () => {
      queryStub.mockResolvedValue([
        [
          { ID: 7, due_date: "2026-09-27" },
          { ID: 9, due_date: "2026-10-27" },
        ],
        [],
      ]);

      const charges = await avtalegirocharges.getOpenChargesByKID("111");

      expect(charges).toStrictEqual([
        { id: 7, dueDate: "2026-09-27" },
        { id: 9, dueDate: "2026-10-27" },
      ]);
      const [sql, params] = queryStub.mock.calls[0];
      expect(sql).toContain("donationID IS NULL");
      expect(params).toStrictEqual([
        "111",
        ["CLAIMED", "DELETION_REQUESTED", "DELETION_SENT", "DELETED"],
      ]);
    });
  });

  describe("markCompleted", () => {
    it("links the donation and completes the charge", async () => {
      queryStub.mockResolvedValue([{ affectedRows: 1 }, []]);

      const updated = await avtalegirocharges.markCompleted(9, 1234);

      expect(updated).toBe(true);
      expect(queryStub.mock.calls[0][1]).toStrictEqual([
        "COMPLETED",
        1234,
        9,
        ["CLAIMED", "DELETION_REQUESTED", "DELETION_SENT", "DELETED"],
      ]);
    });

    it("reports when the charge was already completed", async () => {
      queryStub.mockResolvedValue([{ affectedRows: 0 }, []]);

      expect(await avtalegirocharges.markCompleted(9, 1234)).toBe(false);
    });
  });

  describe("getUpcomingChargesByKID", () => {
    it("gets claimed charges due from the given day", async () => {
      queryStub.mockResolvedValue([
        [{ ID: 9, KID: "111", amount: 50000, due_date: "2026-10-27" }],
        [],
      ]);

      const charges = await avtalegirocharges.getUpcomingChargesByKID(
        "111",
        DateTime.fromISO("2026-10-22T15:30:00", { zone: "Europe/Oslo" }),
      );

      expect(charges).toStrictEqual([{ id: 9, KID: "111", amount: 50000, dueDate: "2026-10-27" }]);
      const [sql, params] = queryStub.mock.calls[0];
      expect(sql).toContain("due_date >= ?");
      expect(params).toStrictEqual(["111", "CLAIMED", "2026-10-22"]);
    });
  });

  describe("requestDeletions", () => {
    it("moves claimed charges to deletion requested", async () => {
      queryStub.mockResolvedValue([{ affectedRows: 2 }, []]);

      await avtalegirocharges.requestDeletions([9, 10]);

      expect(queryStub.mock.calls[0][1]).toStrictEqual(["DELETION_REQUESTED", [9, 10], "CLAIMED"]);
    });

    it("does nothing without charges", async () => {
      await avtalegirocharges.requestDeletions([]);

      expect(queryStub).not.toHaveBeenCalled();
    });
  });

  describe("getDeletionRequests", () => {
    it("gets the requested deletions in due date order", async () => {
      queryStub.mockResolvedValue([
        [
          { ID: 9, KID: "111", amount: 50000, due_date: "2026-10-27" },
          { ID: 12, KID: "222", amount: 20000, due_date: "2026-10-28" },
        ],
        [],
      ]);

      const requests = await avtalegirocharges.getDeletionRequests();

      expect(requests.map((request) => request.id)).toStrictEqual([9, 12]);
      expect(requests[1]).toStrictEqual({
        id: 12,
        KID: "222",
        amount: 20000,
        dueDate: "2026-10-28",
      });
      const [sql, params] = queryStub.mock.calls[0];
      expect(sql).toContain("ORDER BY due_date");
      expect(params).toStrictEqual(["DELETION_REQUESTED"]);
    });
  });

  describe("restoreDeletionRequests", () => {
    it("moves unsent deletion requests back to claimed", async () => {
      queryStub.mockResolvedValue([{ affectedRows: 1 }, []]);

      await avtalegirocharges.restoreDeletionRequests([9]);

      expect(queryStub.mock.calls[0][1]).toStrictEqual(["CLAIMED", [9], "DELETION_REQUESTED"]);
    });

    it("does nothing without charges", async () => {
      await avtalegirocharges.restoreDeletionRequests([]);

      expect(queryStub).not.toHaveBeenCalled();
    });
  });

  describe("restoreDeletionRequestsByKID", () => {
    it("moves a KID's unsent deletion requests back to claimed", async () => {
      queryStub.mockResolvedValue([{ affectedRows: 1 }, []]);

      await avtalegirocharges.restoreDeletionRequestsByKID("111");

      expect(queryStub.mock.calls[0][1]).toStrictEqual(["CLAIMED", "111", "DELETION_REQUESTED"]);
    });
  });

  describe("markDeletionsSent", () => {
    it("records the deletion shipment", async () => {
      queryStub.mockResolvedValue([{ affectedRows: 2 }, []]);

      await avtalegirocharges.markDeletionsSent([9, 12], 800);

      expect(queryStub.mock.calls[0][1]).toStrictEqual([
        "DELETION_SENT",
        800,
        [9, 12],
        "DELETION_REQUESTED",
      ]);
    });

    it("does nothing without charges", async () => {
      await avtalegirocharges.markDeletionsSent([], 800);

      expect(queryStub).not.toHaveBeenCalled();
    });
  });

  describe("getSentDeletionShipmentIDs", () => {
    it("gets the deletion shipments waiting for a receipt", async () => {
      queryStub.mockResolvedValue([
        [{ deletion_shipmentID: 800 }, { deletion_shipmentID: 801 }],
        [],
      ]);

      expect(await avtalegirocharges.getSentDeletionShipmentIDs()).toStrictEqual([800, 801]);
      expect(queryStub.mock.calls[0][1]).toStrictEqual(["DELETION_SENT"]);
    });
  });

  describe("confirmDeletionShipment", () => {
    it("marks the shipment's deletions as deleted", async () => {
      queryStub.mockResolvedValue([{ affectedRows: 2 }, []]);

      await avtalegirocharges.confirmDeletionShipment(800);

      expect(queryStub.mock.calls[0][1]).toStrictEqual(["DELETED", 800, "DELETION_SENT"]);
    });
  });

  describe("requeueDeletionShipment", () => {
    it("puts the shipment's deletions back in the queue", async () => {
      queryStub.mockResolvedValue([{ affectedRows: 2 }, []]);

      await avtalegirocharges.requeueDeletionShipment(800);

      const [sql, params] = queryStub.mock.calls[0];
      expect(sql).toContain("deletion_shipmentID = NULL");
      expect(params).toStrictEqual(["DELETION_REQUESTED", 800, "DELETION_SENT"]);
    });
  });
});
