import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import express from "express";
import { DateTime } from "luxon";
import request from "supertest";
import * as authMiddleware from "../custom_modules/authorization/authMiddleware";
import { DAO } from "../custom_modules/DAO";
import * as giroSftp from "../custom_modules/giroSftp";
import { enqueueInvalidTransactions } from "../custom_modules/reviewQueue";

const avtalegiro = require("../custom_modules/avtalegiro");

describe("review queue: enqueueInvalidTransactions", () => {
  let addStub: MockInstance;
  let countStub: MockInstance;
  const statuses = { open: 2, registered: 1, ignored: 0 };

  beforeEach(() => {
    addStub = vi.spyOn(DAO.reviewqueue, "add").mockResolvedValue({ added: 2, existing: 0 });
    countStub = vi.spyOn(DAO.reviewqueue, "getCountsForImport").mockResolvedValue(statuses);
  });

  afterEach(() => vi.restoreAllMocks());

  it("normalises transactions from each source", async () => {
    const date = new Date("2026-10-01T00:00:00.000Z");
    await enqueueInvalidTransactions("ocr", [
      {
        reason: "Invalid KID",
        transaction: { KID: 123, amount: 250.5, date, transactionID: "ocr.1", paymentMethod: 6 },
      },
      {
        reason: undefined,
        transaction: {
          amount: 100,
          date: DateTime.fromISO("2026-10-02", { zone: "utc" }),
          transactionID: "ocr.2",
          paymentID: 5,
          donorName: "Ola",
          message: "gave",
        },
      },
    ]);

    const [source, items, importLogId] = addStub.mock.calls[0];
    expect(source).toBe("ocr");
    expect(importLogId).toBe(null);
    expect(items[0]).toEqual(
      expect.objectContaining({
        reason: "Invalid KID",
        KID: "123",
        amount: 250.5,
        date,
        externalId: "ocr.1",
        paymentId: 6,
        message: null,
        name: null,
        location: null,
      }),
    );
    expect(items[0].raw).toEqual(expect.objectContaining({ transactionID: "ocr.1", KID: 123 }));
    expect(items[1]).toEqual(
      expect.objectContaining({
        reason: "Unknown error",
        KID: null,
        date: new Date("2026-10-02T00:00:00.000Z"),
        paymentId: 5,
        name: "Ola",
        message: "gave",
      }),
    );
  });

  it("writes nothing when there are no transactions", async () => {
    expect(await enqueueInvalidTransactions("vipps", [])).toStrictEqual({
      added: 0,
      existing: 0,
      skipped: 0,
      statuses: { open: 0, registered: 0, ignored: 0 },
    });
    expect(addStub).not.toHaveBeenCalled();
  });

  it("counts rows as skipped instead of throwing when the queue can't be written", async () => {
    vi.spyOn(console, "error").mockReturnValue(undefined);
    addStub.mockRejectedValue(new Error("db down"));
    const result = await enqueueInvalidTransactions("bankNo", [
      { reason: "x", transaction: { amount: 1, transactionID: "b.1", paymentID: 5 } },
    ]);
    expect(result).toStrictEqual({ added: 0, existing: 0, skipped: 1, statuses });
  });

  it("skips unqueueable rows and queues the rest one by one if the batch fails", async () => {
    vi.spyOn(console, "error").mockReturnValue(undefined);
    addStub.mockReset();
    addStub.mockImplementation(async (_source, items) => {
      if (items.length > 1) throw new Error("Incorrect decimal value");
      if (items[0].externalId === "b.3") throw new Error("Data too long");
      return { added: 1, existing: 0 };
    });
    const result = await enqueueInvalidTransactions("bankNo", [
      { reason: "x", transaction: { amount: 1, transactionID: "b.1", paymentID: 5 } },
      { reason: "x", transaction: { amount: NaN, transactionID: "b.2", paymentID: 5 } },
      { reason: "x", transaction: { amount: 2, transactionID: "b.3", paymentID: 5 } },
      {
        reason: "x",
        transaction: { amount: 3, transactionID: "b.4", paymentID: 5, date: new Date("x") },
      },
    ]);
    expect(result).toStrictEqual({ added: 2, existing: 0, skipped: 2, statuses });
    expect(countStub.mock.calls[0]).toStrictEqual(["bankNo", ["b.1", "b.3", "b.4"], null]);
    // The NaN amount is never sent; the invalid date is queued as null
    expect(addStub.mock.calls[0][1].map((item) => item.externalId)).toStrictEqual([
      "b.1",
      "b.3",
      "b.4",
    ]);
    expect(addStub.mock.lastCall![1][0].date).toBe(null);
  });

  it("reports null statuses when they can't be counted", async () => {
    vi.spyOn(console, "error").mockReturnValue(undefined);
    countStub.mockRejectedValue(new Error("db down"));
    const result = await enqueueInvalidTransactions("bankNo", [
      { reason: "x", transaction: { amount: 1, transactionID: "b.1", paymentID: 5 } },
    ]);
    expect(result).toStrictEqual({ added: 2, existing: 0, skipped: 0, statuses: null });
  });
});

describe("review queue: POST /scheduled/ocr", () => {
  let server: express.Express;
  let addStub: MockInstance;
  let queueStub: MockInstance;
  let loggingStub: MockInstance;

  beforeEach(() => {
    vi.spyOn(authMiddleware, "isAdmin", "get").mockReturnValue([]);
    const ocrFile = require("fs").readFileSync("src/__test__/data/ocr/TBOC2072.DAT");
    vi.spyOn(giroSftp, "getOCRFiles").mockResolvedValue([
      { name: "OCR.D311026", modifyTime: 1, contents: ocrFile },
    ]);
    vi.spyOn(DAO.logging, "getOcrImportState").mockResolvedValue({
      imported: new Set(),
      trackedSince: null,
    });
    vi.spyOn(avtalegiro, "updateAgreements").mockResolvedValue([]);
    addStub = vi.spyOn(DAO.donations, "add").mockRejectedValue(new Error("Invalid KID"));
    queueStub = vi.spyOn(DAO.reviewqueue, "add").mockResolvedValue({ added: 2, existing: 0 });
    loggingStub = vi.spyOn(DAO.logging, "add").mockResolvedValue(42);

    delete require.cache[require.resolve("../routes/scheduled")];
    const scheduledRoute = require("../routes/scheduled");
    server = express();
    server.use("/scheduled", scheduledRoute);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete require.cache[require.resolve("../routes/scheduled")];
  });

  it("queues failed transactions with the import log entry", async () => {
    const response = await request(server).post("/scheduled/ocr").expect(200);

    expect(response.body.files).toHaveLength(1);
    const [imported] = response.body.files;
    expect(Object.keys(imported)).toStrictEqual([
      "filename",
      "fileModifyTime",
      "addedDonations",
      "updatedAgreements",
      "file",
    ]);
    const invalid = imported.addedDonations.invalidTransactions;
    expect(invalid.length).toBe(addStub.mock.calls.length);
    expect(loggingStub).toHaveBeenCalledOnce();
    expect(loggingStub.mock.calls[0][0]).toBe("OCR");
    expect(queueStub).toHaveBeenCalledOnce();
    const [source, items, importLogId] = queueStub.mock.calls[0];
    expect(source).toBe("ocr");
    expect(importLogId).toBe(42);
    expect(items).toHaveLength(invalid.length);
    expect(items[0].externalId).toBe(invalid[0].transaction.transactionID);
  });
});
