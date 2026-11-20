import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import express from "express";
import fileUpload from "express-fileupload";
import * as fs from "fs";
import type { Request, Response } from "express";
import request from "supertest";
import { DAO } from "../custom_modules/DAO";
import * as mail from "../custom_modules/mail";
import * as reportsService from "../custom_modules/reportsService";
import { donationHelpers } from "../custom_modules/donationHelpers";
import { passMultipartBodyToTrpc, skipForTrpc } from "../trpc/reportsMultipart";
import { appRouter } from "../trpc/router";
import { createCallerFactory } from "../trpc/trpc";

const createCaller = createCallerFactory(appRouter);

const callerWith = (permissions?: string[]) =>
  createCaller({
    req: {} as Request,
    res: {} as Response,
    auth: permissions ? { permissions } : undefined,
  });

const admin = () => callerWith(["admin"]).reports;

// nosemgrep: javascript.lang.security.audit.detect-non-literal-fs-filename.detect-non-literal-fs-filename -- test fixture file names are literals in this spec
const readData = (path: string) => fs.readFileSync(`src/__test__/data/${path}`);

const uploadForm = (
  path: string,
  fields: Record<string, string> = { metaOwnerID: "3" },
  type = "text/plain",
) => {
  const formData = new FormData();
  formData.append("report", new File([readData(path)], path.split("/").pop()!, { type }));
  for (const [key, value] of Object.entries(fields)) formData.append(key, value);
  return formData;
};

const expectTrpcError = async (promise: Promise<unknown>, code: string, message?: RegExp) => {
  try {
    await promise;
    expect.unreachable(`expected ${code}`);
  } catch (err: any) {
    expect(err.code).toBe(code);
    if (message) expect(err.message).toMatch(message);
  }
};

describe("tRPC reports router", () => {
  let addStub: MockInstance;
  let queueStub: MockInstance;
  let logStub: MockInstance;

  beforeEach(() => {
    logStub = vi.spyOn(DAO.logging, "add").mockResolvedValue(77);
    addStub = vi.spyOn(DAO.donations, "add").mockResolvedValue(10);
    queueStub = vi
      .spyOn(DAO.reviewqueue, "add")
      .mockImplementation(async (_source, items) => ({ added: items.length, existing: 0 }));
    vi.spyOn(DAO.reviewqueue, "getCountsForImport").mockResolvedValue({
      open: 1,
      registered: 2,
      ignored: 3,
    });
    vi.spyOn(mail, "sendDonationReceipt").mockResolvedValue(undefined as any);
    vi.spyOn(DAO.meta, "getDataOwners").mockResolvedValue([
      { id: 1, name: "Default", default: true },
      { id: 3, name: "Other", default: false },
    ] as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("auth and validation", () => {
    it("rejects anonymous callers", async () => {
      const getEntries = vi.spyOn(DAO.logging, "getEntries").mockReturnValue(undefined as any);
      await expectTrpcError(callerWith().reports.logs.list({ page: 0, limit: 10 }), "UNAUTHORIZED");
      expect(getEntries).not.toHaveBeenCalled();
    });

    it("rejects callers without the admin permission", async () => {
      await expectTrpcError(
        callerWith(["read:profile"]).reports.uploads.ocr(uploadForm("ocr/TBOC2072.DAT")),
        "FORBIDDEN",
      );
      expect(addStub).not.toHaveBeenCalled();
    });

    it("rejects invalid list input", async () => {
      await expectTrpcError(admin().logs.list({ page: 0, limit: 0 }), "BAD_REQUEST");
      await expectTrpcError(
        admin().fundraisers.list({ page: 0, limit: 10, sort: { id: "secret" as any, desc: true } }),
        "BAD_REQUEST",
      );
    });

    it("rejects uploads without a valid file or meta owner", async () => {
      const unknownOwner = uploadForm("ocr/TBOC2072.DAT", { metaOwnerID: "99" });
      await expectTrpcError(admin().uploads.ocr(unknownOwner), "BAD_REQUEST", /Data owner 99/);

      const badOwner = uploadForm("ocr/TBOC2072.DAT", { metaOwnerID: "3abc" });
      await expectTrpcError(admin().uploads.ocr(badOwner), "BAD_REQUEST");

      const noFile = new FormData();
      noFile.append("metaOwnerID", "3");
      await expectTrpcError(admin().uploads.ocr(noFile), "BAD_REQUEST");

      const twoFiles = uploadForm("ocr/TBOC2072.DAT");
      twoFiles.append("report", new File(["x"], "second.DAT"));
      await expectTrpcError(admin().uploads.ocr(twoFiles), "BAD_REQUEST", /one report file/);

      expect(addStub).not.toHaveBeenCalled();
    });
  });

  describe("uploads", () => {
    it("registers with the default owner when metaOwnerID is omitted", async () => {
      await admin().uploads.ocr(uploadForm("ocr/TBOC2072.DAT", {}));
      expect(addStub).toHaveBeenCalled();
      expect(addStub.mock.calls[0][5]).toBe(null);
    });

    it("accepts and validates metaOwnerID on every upload", async () => {
      const bankSe = vi
        .spyOn(reportsService, "processBankSeReport")
        .mockResolvedValue({ valid: 0, invalid: 0, invalidTransactions: [] });

      await admin().uploads.bankSe(uploadForm("camt/camt053_mixed.xml"));
      expect(bankSe.mock.calls[0][2]).toBe(3);

      await expectTrpcError(
        admin().uploads.bankSe(uploadForm("bank/sampleReport.CSV", { metaOwnerID: "99" })),
        "BAD_REQUEST",
        /Data owner 99/,
      );
    });

    it("rejects files that are not the expected report type, writing nothing", async () => {
      vi.spyOn(DAO.parsing, "getVippsParsingRules").mockResolvedValue([]);
      vi.spyOn(DAO.donations, "getByExternalPaymentID").mockResolvedValue(null as any);
      const kidExists = vi.spyOn(DAO.distributions, "KIDexists").mockResolvedValue(true);

      const cases: [Promise<unknown>, RegExp][] = [
        [admin().uploads.vipps(uploadForm("bank/sampleReport.CSV")), /Not a Vipps settlement/],
        [admin().uploads.vipps(uploadForm("ocr_test.ocr")), /Could not read the Vipps report/],
        [admin().uploads.bankSe(uploadForm("bank/sampleReport.CSV")), /Not a CAMT.053/],
        [admin().uploads.bankSe(uploadForm("camt/camt053_malformed.xml")), /CAMT.053/],
        [admin().uploads.bankSe(uploadForm("camt/camt053_wrong_namespace.xml")), /No statement/],
        [admin().uploads.bankSe(uploadForm("camt/camt053_xxe.xml")), /entity/],
      ];
      for (const [promise, message] of cases) {
        await expectTrpcError(promise, "BAD_REQUEST", message);
      }
      expect(addStub).not.toHaveBeenCalled();
      expect(kidExists).not.toHaveBeenCalled();
    });

    it("rejects an unreadable xlsx sent as a Vipps report", async () => {
      const formData = new FormData();
      // A zip container (xlsx) with binary content
      const xlsx = Buffer.concat([Buffer.from("PK\u0003\u0004"), Buffer.alloc(64, 0xff)]);
      formData.append("report", new File([xlsx], "report.xlsx"));
      await expectTrpcError(admin().uploads.vipps(formData), "BAD_REQUEST");
      expect(addStub).not.toHaveBeenCalled();
    });

    it("rejects files that don't match the chosen source before writing anything", async () => {
      await expectTrpcError(
        admin().uploads.ocr(uploadForm("bank/sampleReport.CSV")),
        "BAD_REQUEST",
        /Not an OCR Giro file/,
      );
      await expectTrpcError(
        admin().uploads.ocr(uploadForm("ocr_no_valid_records.ocr")),
        "BAD_REQUEST",
        /no KID or AvtaleGiro payments/,
      );
      await expectTrpcError(
        admin().uploads.bankNo(uploadForm("vipps/Vipps Details June 2026.CSV")),
        "BAD_REQUEST",
        /Not a bank account export: row 2 has no date/,
      );
      await expectTrpcError(
        admin().uploads.bankNo(uploadForm("ocr/TBOC2072.DAT")),
        "BAD_REQUEST",
        /Not a bank account export/,
      );
      expect(addStub).not.toHaveBeenCalled();
      expect(logStub).not.toHaveBeenCalled();
      expect(queueStub).not.toHaveBeenCalled();
    });

    it("ocr registers donations and lists failed ones for review", async () => {
      addStub.mockRejectedValueOnce(new Error("EXISTING_DONATION"));
      addStub.mockRejectedValueOnce(new Error("Invalid KID"));

      const result = await admin().uploads.ocr(uploadForm("ocr/TBOC2072.DAT"));

      expect(addStub).toHaveBeenCalledTimes(2);
      expect(addStub.mock.calls[0][5]).toBe(3);
      expect(result.ignored).toBe(1);
      expect(result.invalid).toBe(1);
      expect(result.valid).toBe(addStub.mock.calls.length - 2);
      expect(result.invalidTransactions).toHaveLength(1);
      const [item] = result.invalidTransactions;
      expect(item.reason).toBe("Invalid KID");
      expect(item.transaction.paymentID).toBeTypeOf("number");
      expect(item.transaction.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(item.transaction.KID).toBeTypeOf("string");

      expect(result.queue).toStrictEqual({
        added: 1,
        existing: 0,
        skipped: 0,
        statuses: { open: 1, registered: 2, ignored: 3 },
      });
      expect(queueStub).toHaveBeenCalledOnce();
      const [source, queued, importLogId, metaOwnerId] = queueStub.mock.calls[0];
      expect(source).toBe("ocr");
      expect(importLogId).toBe(77);
      expect(metaOwnerId).toBe(3);
      expect(result.importLogId).toBe(77);
      expect(queued).toHaveLength(1);
      expect(queued[0]).to.include({
        reason: "Invalid KID",
        KID: item.transaction.KID,
        amount: item.transaction.amount,
        externalId: item.transaction.transactionID,
        paymentId: item.transaction.paymentID,
      });
      expect(queued[0].date).toBeInstanceOf(Date);
      expect(queued[0].raw).toHaveProperty("transactionID", item.transaction.transactionID);
    });

    it("logs the upload with file, owner and uploader, like the scheduled import", async () => {
      addStub.mockRejectedValue(new Error("Invalid KID"));
      const caller = createCaller({
        req: {} as Request,
        res: {} as Response,
        auth: { permissions: ["admin"], sub: "auth0|1", email: "admin@example.org" } as any,
      });

      const result = await caller.reports.uploads.ocr(uploadForm("ocr/TBOC2072.DAT"));

      expect(logStub).toHaveBeenCalledOnce();
      const [label, entry] = logStub.mock.calls[0];
      expect(label).toBe("OCR - Upload");
      expect(entry.upload).toStrictEqual({
        source: "ocr",
        metaOwnerID: 3,
        uploadedBy: "admin@example.org",
      });
      expect(entry.filename).toBe("TBOC2072.DAT");
      expect(entry.file).toBe(readData("ocr/TBOC2072.DAT").toString("utf8"));
      expect(entry.donations).toStrictEqual({
        valid: result.valid,
        invalid: result.invalid,
        ignored: result.ignored,
      });
      expect(entry.invalidTransactions).toStrictEqual(result.invalidTransactions);
      // The log is written before the items are queued, so they can link to it
      expect(logStub).toHaveBeenCalledBefore(queueStub);
    });

    it("labels the log per source and stores null for the default owner", async () => {
      vi.spyOn(DAO.parsing, "getVippsParsingRules").mockResolvedValue([]);
      await admin().uploads.vipps(uploadForm("vipps/Vipps April 2019.CSV"));
      await admin().uploads.bankNo(uploadForm("bank/sampleReport.CSV", {}));
      expect(logStub.mock.calls[0][0]).toBe("Vipps - Upload");
      expect(logStub.mock.calls[0][1].filename).toBe("Vipps April 2019.CSV");
      expect(logStub.mock.calls[1][0]).toBe("Bank NO - Upload");
      expect(logStub.mock.calls[1][1].upload.metaOwnerID).toBe(null);
    });

    it("queues without a log link when writing the log fails", async () => {
      vi.spyOn(console, "error").mockReturnValue(undefined);
      logStub.mockRejectedValue(new Error("db down"));
      addStub.mockRejectedValue(new Error("Invalid KID"));

      const result = await admin().uploads.ocr(uploadForm("ocr/TBOC2072.DAT"));

      expect(result.importLogId).toBe(null);
      expect(result.queue).not.toBe(null);
      expect(queueStub.mock.calls[0][2]).toBe(null);
    });

    it("still returns the upload result when queueing for review fails", async () => {
      vi.spyOn(console, "error").mockReturnValue(undefined);
      queueStub.mockRejectedValue(new Error("db down"));
      addStub.mockRejectedValue(new Error("Invalid KID"));

      const result = await admin().uploads.ocr(uploadForm("ocr/TBOC2072.DAT"));

      expect(result.invalidTransactions.length).toBeGreaterThan(0);
      expect(result.queue).toEqual(expect.objectContaining({ added: 0, existing: 0 }));
      expect(result.queue!.skipped).toBe(result.invalidTransactions.length);
    });

    it("vipps adds donations with a KID and queues the rest", async () => {
      vi.spyOn(DAO.parsing, "getVippsParsingRules").mockResolvedValue([]);

      const result = await admin().uploads.vipps(uploadForm("vipps/Vipps April 2019.CSV"));

      expect(result.valid).toBe(10);
      expect(result.invalidTransactions.length).toBeGreaterThan(0);
      const [item] = result.invalidTransactions;
      expect(item.reason).toBe("Could not find valid KID or matching parsing rule");
      expect(item.transaction).to.include.keys(
        "KID",
        "amount",
        "date",
        "transactionID",
        "paymentID",
        "message",
        "name",
        "location",
      );
      expect(item.transaction.paymentID).toBe(4);
      expect(item.transaction.date).toBeTypeOf("string");
    });

    it("bankNo registers transactions with a KID", async () => {
      const result = await admin().uploads.bankNo(uploadForm("bank/sampleReport.CSV"));

      expect(result.valid).toBe(addStub.mock.calls.length);
      expect(result.valid + result.invalid).toBeGreaterThan(0);
      for (const item of result.invalidTransactions) {
        expect(item.transaction.paymentID).toBe(5);
      }
    });

    it("bankSe dry run writes nothing and reports would-be donations", async () => {
      vi.spyOn(DAO.donations, "getByExternalPaymentID").mockResolvedValue(null as any);
      vi.spyOn(DAO.distributions, "KIDexists").mockResolvedValue(true);
      vi.spyOn(DAO.distributions, "getKIDsByPrefix").mockResolvedValue([]);
      vi.spyOn(DAO.donations, "getLatestByLegacySeDistribution").mockResolvedValue(null as any);

      const result = await admin().uploads.bankSe(
        uploadForm("camt/camt053_mixed.xml", { dryRun: "true" }),
      );

      expect(addStub).not.toHaveBeenCalled();
      expect(result.dryRun).not.toBe(null);
      expect(result.dryRun!.fileFormat).toBe("xml");
      expect(result.dryRun!.totalParsed).toBeGreaterThan(0);
      expect(result.dryRun!.validTransactions).toHaveLength(result.valid);
      expect(result.queue).toBe(null);
      expect(result.importLogId).toBe(null);
      expect(queueStub).not.toHaveBeenCalled();
      expect(logStub).not.toHaveBeenCalled();
    });

    it("bankSe without dryRun returns no dry run info", async () => {
      const processStub = vi
        .spyOn(reportsService, "processBankSeReport")
        .mockResolvedValue({ valid: 1, invalid: 0, invalidTransactions: [] });

      const result = await admin().uploads.bankSe(uploadForm("camt/camt053_mixed.xml", {}));

      expect(processStub.mock.calls[0][1]).toBe(false);
      expect(result).toStrictEqual({
        valid: 1,
        invalid: 0,
        invalidTransactions: [],
        queue: {
          added: 0,
          existing: 0,
          skipped: 0,
          statuses: { open: 0, registered: 0, ignored: 0 },
        },
        importLogId: 77,
        dryRun: null,
      });
      expect(logStub.mock.calls[0][0]).toBe("Bank SE - Upload");
    });
  });

  describe("transactions", () => {
    it("range returns the donations as rows", async () => {
      const rows = [
        {
          ID: 1,
          time: new Date("2024-01-02"),
          name: "Ola",
          donorID: 2,
          sum: "100.00",
          paymentMethod: "Bank",
          transactionCost: null,
          split: [],
        },
      ];
      const rangeStub = vi.spyOn(DAO.donations, "getFromRange").mockResolvedValue(rows);

      const file = await admin().transactions.range({
        fromDate: "2024-01-01",
        toDate: "2024-01-31",
        paymentMethodIDs: [2, 5],
      });

      // Whole Oslo days: from the start of 1 January to the start of 1 February (CET)
      expect(rangeStub.mock.calls[0][0]).toStrictEqual(new Date("2023-12-31T23:00:00Z"));
      expect(rangeStub.mock.calls[0][1]).toStrictEqual(new Date("2024-01-31T23:00:00Z"));
      expect(rangeStub.mock.calls[0][2]).toStrictEqual([2, 5]);
      expect(rangeStub.mock.calls[0][3]).toStrictEqual({ exclusiveEnd: true });
      expect(file).toStrictEqual({ filename: "transactions_2024-01-01_2024-01-31", rows });
    });

    it("range rejects a reversed date range", async () => {
      const rangeStub = vi.spyOn(DAO.donations, "getFromRange").mockResolvedValue([]);
      await expectTrpcError(
        admin().transactions.range({ fromDate: "2024-02-01", toDate: "2024-01-31" }),
        "BAD_REQUEST",
      );
      expect(rangeStub).not.toHaveBeenCalled();
    });

    it("range passes null for all payment methods", async () => {
      const rangeStub = vi.spyOn(DAO.donations, "getFromRange").mockResolvedValue([]);
      await admin().transactions.range({ fromDate: "2024-01-01", toDate: "2024-01-31" });
      expect(rangeStub.mock.calls[0][2]).toBe(null);
    });
  });

  describe("tax", () => {
    it("ku65 builds the XML file", async () => {
      const formData = new FormData();
      formData.append(
        "report",
        new File(["191212121212,500\n191212121212,250\n"], "ku65.csv", { type: "text/csv" }),
      );
      formData.append("year", "2025");

      const file = await admin().tax.ku65(formData);

      expect(file.filename).toBe("ku65_2025.xml");
      expect(file.contentType).toBe("application/xml");
      expect(file.content).toContain("<?xml");
      expect(file.content).toContain("750");
    });

    it("ku65 accepts .csv files with the content types Windows browsers send", async () => {
      for (const type of ["application/vnd.ms-excel", "application/octet-stream"]) {
        const formData = new FormData();
        formData.append("report", new File(["191212121212,500\n"], "KU65.CSV", { type }));
        formData.append("year", "2025");
        expect((await admin().tax.ku65(formData)).content).toContain("500");
      }

      const notCsvName = new FormData();
      notCsvName.append(
        "report",
        new File(["191212121212,500\n"], "ku65.xls", { type: "application/vnd.ms-excel" }),
      );
      notCsvName.append("year", "2025");
      await expectTrpcError(admin().tax.ku65(notCsvName), "BAD_REQUEST");
    });

    it("ku65 rejects invalid personnummer and non-CSV files", async () => {
      const invalid = new FormData();
      invalid.append("report", new File(["123,500\n"], "ku65.csv", { type: "text/csv" }));
      invalid.append("year", "2025");
      await expectTrpcError(admin().tax.ku65(invalid), "BAD_REQUEST");

      const notCsv = new FormData();
      notCsv.append("report", new File(["x"], "ku65.txt", { type: "text/plain" }));
      notCsv.append("year", "2025");
      await expectTrpcError(admin().tax.ku65(notCsv), "BAD_REQUEST");
    });
  });

  describe("logs", () => {
    it("list pages through log entries", async () => {
      const rows = [{ ID: 1, label: "Vipps", timestamp: new Date(), meta: "" }];
      const getEntries = vi
        .spyOn(DAO.logging, "getEntries")
        .mockResolvedValue({ results: rows, pages: 3, total: 70 });

      const result = await admin().logs.list({
        page: 2,
        limit: 25,
        filter: { fileSearch: "002370000101" },
      });

      expect(getEntries.mock.calls[0]).toStrictEqual([
        25,
        50,
        "002370000101",
        { id: "timestamp", desc: true },
        { searchFilename: true, uploadDetails: true },
      ]);
      expect(result).toStrictEqual({
        rows: [{ ...rows[0], displayLabel: "Vipps", source: null, filename: null, summary: null }],
        pages: 3,
        total: 70,
      });

      await admin().logs.list({ page: 0, limit: 10, sort: { id: "label", desc: false } });
      expect(getEntries.mock.calls[1][3]).toStrictEqual({ id: "label", desc: false });
      await expectTrpcError(
        admin().logs.list({ page: 0, limit: 10, sort: { id: "result" as any, desc: false } }),
        "BAD_REQUEST",
      );
    });

    it("sorts with an id tie-break, keeping the REST order when unsorted", async () => {
      const query = vi.spyOn(DAO, "query").mockReturnValue(undefined as any);
      query.mockResolvedValue([[{ count: 3 }], []] as any);

      await DAO.logging.getEntries(25, 0, null, { id: "label", desc: false });
      expect(query.mock.calls[0][0]).toMatch(/ORDER BY label ASC, ID ASC\s+LIMIT/);

      await DAO.logging.getEntries(25, 0, null);
      expect(query.mock.calls[2][0]).toMatch(/ORDER BY Import_logs.timestamp DESC\s+LIMIT/);
    });

    it("reads the DB-filled timestamp as UTC in the list and the detail", async () => {
      const query = vi.spyOn(DAO, "query").mockReturnValue(undefined as any);
      query.mockResolvedValue([[{ count: 0 }], []] as any);
      const convert =
        "CONVERT_TZ(Import_logs.timestamp, @@session.time_zone, '+00:00') AS timestamp";

      await DAO.logging.getEntries(25, 0, null, { id: "timestamp", desc: true });
      // Sorted by the column itself (indexed), not the converted alias
      expect(query.mock.calls[0][0]).toContain(convert);
      expect(query.mock.calls[0][0]).toMatch(/ORDER BY Import_logs.timestamp DESC, ID DESC/);

      query.mockClear();
      query.mockResolvedValue([[], []] as any);
      await DAO.logging.get(7);
      expect(query.mock.calls[0][0]).toContain(convert);
      expect(query.mock.calls[0][0]).not.toContain("SELECT *");
    });

    it("labels upload entries with the admin's source names and a summary", async () => {
      const timestamp = new Date();
      vi.spyOn(DAO.logging, "getEntries").mockResolvedValue({
        results: [
          {
            ID: 1,
            label: "Bank NO - Upload",
            timestamp,
            meta: "Upload [...]",
            uploadSource: "bankNo",
            filename: "konto.csv",
            donations: { valid: 12, invalid: 3 },
            reviewCount: 3,
          },
          {
            ID: 2,
            label: "OCR - Upload",
            timestamp,
            meta: "",
            uploadSource: "ocr",
            filename: "TBOC1.DAT",
            donations: { valid: 1, invalid: 0, ignored: 4 },
            reviewCount: 0,
          },
          { ID: 3, label: "OCR", timestamp, meta: "Donations [...]" },
        ] as any,
        pages: 1,
        total: 3,
      });
      const { rows } = await admin().logs.list({ page: 0, limit: 10 });
      expect(rows.map((row) => [row.displayLabel, row.source, row.summary])).toStrictEqual([
        ["Bank account export", "bankNo", "konto.csv: 12 donations registered, 3 sent to review"],
        [
          "Bank OCR",
          "ocr",
          "TBOC1.DAT: 1 donation registered, 4 already registered, 0 sent to review",
        ],
        ["OCR", null, null],
      ]);
    });

    it("searches file names too when asked", async () => {
      const query = vi.spyOn(DAO, "query").mockReturnValue(undefined as any);
      query.mockResolvedValueOnce([[], []] as any);
      query.mockResolvedValueOnce([[{ count: 0 }], []] as any);
      await DAO.logging.getEntries(25, 0, "TBOC", undefined, {
        searchFilename: true,
        uploadDetails: true,
      });
      const sql = query.mock.calls[0][0] as string;
      expect(sql).toContain(
        `WHERE JSON_EXTRACT(result, "$.file") LIKE '%TBOC%' OR JSON_UNQUOTE(JSON_EXTRACT(result, "$.filename")) LIKE '%TBOC%'`,
      );
      expect(sql).toContain("AS reviewCount");
    });

    it("counts pages with the file search filter applied", async () => {
      const query = vi.spyOn(DAO, "query").mockReturnValue(undefined as any);
      query.mockResolvedValueOnce([[], []] as any);
      query.mockResolvedValueOnce([[{ count: 30 }], []] as any);

      const result = await DAO.logging.getEntries(25, 0, "0023");

      expect(query.mock.calls[1][0]).toMatch(
        /WHERE JSON_EXTRACT\(result, "\$\.file"\) LIKE '%0023%'/,
      );
      expect(result.pages).toBe(2);
      expect(result.total).toBe(30);
    });

    it("get returns an entry or NOT_FOUND", async () => {
      const entry = { ID: 7, label: "OCR", result: { file: "..." }, timestamp: new Date() };
      const get = vi.spyOn(DAO.logging, "get").mockReturnValue(undefined as any);
      get.withArgs(7).resolves(entry);
      get.mockResolvedValue(null);

      expect(await admin().logs.get({ id: 7 })).toStrictEqual({ ...entry, displayLabel: "OCR" });
      await expectTrpcError(admin().logs.get({ id: 8 }), "NOT_FOUND");
    });
  });

  describe("fundraisers", () => {
    const fundraiser = {
      id: 5,
      donorId: 42,
      secret: "s3cret",
      registered: new Date("2025-01-01"),
      lastUpdated: new Date("2025-01-02"),
    };

    it("list passes filter with dates, sort and secrets to the DAO", async () => {
      const list = {
        rows: [],
        statistics: { totalCount: 0, totalSum: 0, avgDonation: 0 },
        pages: 0,
      };
      const getList = vi.spyOn(DAO.fundraisers, "getList").mockResolvedValue(list);

      const result = await admin().fundraisers.list({
        page: 1,
        limit: 20,
        sort: { id: "totalSum", desc: true },
        filter: {
          registrationDate: { from: "2025-01-01" },
          donationSum: { from: 100 },
          donor: "Ola",
          organizationIDs: [1],
        },
      });

      expect(result).toStrictEqual(list);
      const [page, limit, filter, sort, includeSecrets] = getList.mock.calls[0];
      expect([page, limit, includeSecrets]).toStrictEqual([1, 20, true]);
      expect(sort).toStrictEqual({ id: "totalSum", desc: true });
      expect(filter).toStrictEqual({
        registrationRange: { from: new Date("2024-12-31T23:00:00Z"), before: undefined },
        donationSum: { from: 100 },
        donor: "Ola",
        organizationIDs: [1],
      });
    });

    it("get combines the fundraiser with its totals and transactions", async () => {
      vi.spyOn(DAO.fundraisers, "getFundraiserWithSecret").mockResolvedValue(fundraiser);
      const transactions = [
        { id: 3, name: null, message: "Go!", amount: 100, date: new Date(), recurring: false },
      ];
      vi.spyOn(DAO.fundraisers, "getFundraiserByID").mockResolvedValue({
        totalSum: 100,
        donationCount: 1,
        transactions,
      });

      const result = await admin().fundraisers.get({ id: 5 });

      expect(result).toStrictEqual({
        ...fundraiser,
        totalSum: 100,
        donationCount: 1,
        transactions,
      });
    });

    it("get throws NOT_FOUND for unknown fundraisers", async () => {
      vi.spyOn(DAO.fundraisers, "getFundraiserWithSecret").mockResolvedValue(null);
      await expectTrpcError(admin().fundraisers.get({ id: 5 }), "NOT_FOUND");
    });

    it("create makes a fundraiser for an existing donor", async () => {
      vi.spyOn(DAO.donors, "getByID").mockResolvedValue({ id: 42 } as any);
      const create = vi
        .spyOn(DAO.fundraisers, "createFundraiser")
        .mockResolvedValue({ id: 5, secret: "s3cret" });
      vi.spyOn(DAO.fundraisers, "getFundraiserWithSecret").mockResolvedValue(fundraiser);

      expect(await admin().fundraisers.create({ donorId: 42 })).toStrictEqual(fundraiser);
      expect(create.mock.calls[0]).toStrictEqual([42]);
    });

    it("create rejects unknown donors", async () => {
      vi.spyOn(DAO.donors, "getByID").mockResolvedValue(null);
      const create = vi
        .spyOn(DAO.fundraisers, "createFundraiser")
        .mockReturnValue(undefined as any);

      await expectTrpcError(admin().fundraisers.create({ donorId: 42 }), "BAD_REQUEST");
      expect(create).not.toHaveBeenCalled();
    });

    describe("moving a donation into or out of a fundraiser", () => {
      const connection = { name: "transaction" } as any;
      const donation = (fundraiserId: number | null) =>
        ({ id: 10, KID: "11112222", donorId: 42, fundraiserId }) as any;
      const split = {
        kid: "11112222",
        donorId: 42,
        taxUnitId: 7,
        causeAreas: [{ id: 1, percentageShare: "100", standardSplit: true, organizations: [] }],
      } as any;
      let commit: MockInstance;
      let rollback: MockInstance;
      let copy: MockInstance;
      let move: MockInstance;

      beforeEach(() => {
        vi.spyOn(DAO, "startTransaction").mockResolvedValue(connection);
        commit = vi.spyOn(DAO, "commitTransaction").mockResolvedValue(undefined);
        rollback = vi.spyOn(DAO, "rollbackTransaction").mockResolvedValue(undefined);
        vi.spyOn(donationHelpers, "createKID").mockResolvedValue("99998888");
        copy = vi.spyOn(DAO.distributions, "copyToNewKID").mockResolvedValue(undefined);
        move = vi.spyOn(DAO.donations, "updateKIDById").mockResolvedValue(true);
      });

      const attachInput = {
        donationId: 10,
        fundraiserId: 5,
        message: " Lykke til! ",
        messageSenderName: "Kari",
        showName: true,
      };

      it("attach moves the donation to a new KID in a new transaction of the fundraiser", async () => {
        vi.spyOn(DAO.donations, "getByID").mockResolvedValue(donation(null));
        vi.spyOn(DAO.fundraisers, "getFundraiserWithSecret").mockResolvedValue(fundraiser);
        const addTransaction = vi
          .spyOn(DAO.fundraisers, "addFundraiserTransaction")
          .mockResolvedValue(300);

        const result = await admin().fundraisers.attachDonation(attachInput);

        expect(result).toStrictEqual({ donationId: 10, fundraiserId: 5, kid: "99998888" });
        expect(addTransaction.mock.calls[0]).toStrictEqual([
          { fundraiserId: 5, message: "Lykke til!", messageSenderName: "Kari", showName: true },
          connection,
        ]);
        expect(copy.mock.calls[0]).toStrictEqual(["11112222", "99998888", 300, connection]);
        expect(move.mock.calls[0]).toStrictEqual([10, "99998888", connection]);
        expect(commit).toHaveBeenCalledExactlyOnceWith(connection);
        expect(rollback).not.toHaveBeenCalled();
      });

      it("attach hides the name when there is none to show", async () => {
        vi.spyOn(DAO.donations, "getByID").mockResolvedValue(donation(null));
        vi.spyOn(DAO.fundraisers, "getFundraiserWithSecret").mockResolvedValue(fundraiser);
        const addTransaction = vi
          .spyOn(DAO.fundraisers, "addFundraiserTransaction")
          .mockResolvedValue(300);

        await admin().fundraisers.attachDonation({
          ...attachInput,
          message: "",
          messageSenderName: " ",
        });

        expect(addTransaction.mock.calls[0][0]).toStrictEqual({
          fundraiserId: 5,
          message: "",
          messageSenderName: null,
          showName: false,
        });
      });

      it("attach rolls back when a step fails", async () => {
        vi.spyOn(DAO.donations, "getByID").mockResolvedValue(donation(null));
        vi.spyOn(DAO.fundraisers, "getFundraiserWithSecret").mockResolvedValue(fundraiser);
        vi.spyOn(DAO.fundraisers, "addFundraiserTransaction").mockResolvedValue(300);
        copy.mockRejectedValue(new Error("Distribution 11112222 not found"));

        try {
          await admin().fundraisers.attachDonation(attachInput);
          expect.unreachable("expected an error");
        } catch (err: any) {
          expect(err.message).toMatch(/not found/);
        }
        expect(rollback).toHaveBeenCalledExactlyOnceWith(connection);
        expect(commit).not.toHaveBeenCalled();
        expect(move).not.toHaveBeenCalled();
      });

      it("attach refuses a donation that is already in a fundraiser", async () => {
        vi.spyOn(DAO.donations, "getByID").mockResolvedValue(donation(8));
        await expectTrpcError(
          admin().fundraisers.attachDonation(attachInput),
          "CONFLICT",
          /fundraiser 8/,
        );
        expect(copy).not.toHaveBeenCalled();
      });

      it("attach rejects unknown fundraisers and donations", async () => {
        const getDonation = vi.spyOn(DAO.donations, "getByID").mockResolvedValue(donation(null));
        vi.spyOn(DAO.fundraisers, "getFundraiserWithSecret").mockResolvedValue(null);
        await expectTrpcError(admin().fundraisers.attachDonation(attachInput), "BAD_REQUEST");

        getDonation.mockRejectedValue(new Error("Could not find donation with ID 10"));
        await expectTrpcError(admin().fundraisers.attachDonation(attachInput), "NOT_FOUND");
        expect(copy).not.toHaveBeenCalled();
      });

      it("detach reuses a KID with the same split outside fundraisers", async () => {
        vi.spyOn(DAO.donations, "getByID").mockResolvedValue(donation(5));
        vi.spyOn(DAO.distributions, "getSplitByKID").mockResolvedValue(split);
        const bySplit = vi.spyOn(DAO.distributions, "getKIDbySplit").mockResolvedValue("55554444");

        const result = await admin().fundraisers.detachDonation({ donationId: 10 });

        expect(result).toStrictEqual({ donationId: 10, fundraiserId: 5, kid: "55554444" });
        expect(bySplit.mock.calls[0][0]).toStrictEqual({
          donorId: 42,
          taxUnitId: 7,
          causeAreas: split.causeAreas,
        });
        expect(copy).not.toHaveBeenCalled();
        expect(move.mock.calls[0]).toStrictEqual([10, "55554444", connection]);
        expect(commit).toHaveBeenCalledOnce();
      });

      it("detach copies the split to a new KID when there is none", async () => {
        vi.spyOn(DAO.donations, "getByID").mockResolvedValue(donation(5));
        vi.spyOn(DAO.distributions, "getSplitByKID").mockResolvedValue(split);
        vi.spyOn(DAO.distributions, "getKIDbySplit").mockResolvedValue(null);

        const result = await admin().fundraisers.detachDonation({ donationId: 10 });

        expect(result.kid).toBe("99998888");
        expect(copy.mock.calls[0]).toStrictEqual(["11112222", "99998888", null, connection]);
        expect(move.mock.calls[0]).toStrictEqual([10, "99998888", connection]);
      });

      it("detach refuses a donation that is not in a fundraiser", async () => {
        vi.spyOn(DAO.donations, "getByID").mockResolvedValue(donation(null));
        await expectTrpcError(admin().fundraisers.detachDonation({ donationId: 10 }), "CONFLICT");
        expect(move).not.toHaveBeenCalled();
      });
    });
  });

  describe("multipart transport through Express", () => {
    // Same middleware order as server.ts: express.json, file upload (skipped for /trpc), tRPC
    const app = express();
    app.use(express.json());
    app.use(skipForTrpc(fileUpload()));
    app.post("/reports/ocr", (req, res) => {
      res.json({ hasFile: !!(req as any).files?.report, metaOwnerID: req.body.metaOwnerID });
    });
    app.use(
      "/trpc",
      passMultipartBodyToTrpc,
      createExpressMiddleware({
        router: appRouter,
        createContext: ({ req, res }) => ({ req, res, auth: { permissions: ["admin"] } }),
      }),
    );

    it("passes FormData uploads to tRPC procedures", async () => {
      const res = await request(app)
        .post("/trpc/reports.uploads.ocr")
        .field("metaOwnerID", "3")
        .attach("report", readData("ocr/TBOC2072.DAT"), "TBOC2072.DAT")
        .expect(200);

      expect(res.body.result.data.valid).toBe(addStub.mock.calls.length);
      expect(addStub.mock.calls[0][5]).toBe(3);
    });

    it("rejects multipart requests with invalid fields", async () => {
      await request(app)
        .post("/trpc/reports.uploads.ocr")
        .field("metaOwnerID", "x")
        .attach("report", readData("ocr/TBOC2072.DAT"), "TBOC2072.DAT")
        .expect(400);
      expect(addStub).not.toHaveBeenCalled();
    });

    it("still parses uploads for REST routes", async () => {
      const res = await request(app)
        .post("/reports/ocr")
        .field("metaOwnerID", "3")
        .attach("report", readData("ocr/TBOC2072.DAT"), "TBOC2072.DAT")
        .expect(200);
      expect(res.body).toStrictEqual({ hasFile: true, metaOwnerID: "3" });
    });
  });
});
