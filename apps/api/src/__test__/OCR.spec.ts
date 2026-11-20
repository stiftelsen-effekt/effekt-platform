import { describe, it, expect } from "vitest";
import * as fs from "fs";

const OCR = require("../custom_modules/parsers/OCR");

const sampleOCRfile = fs.readFileSync("src/__test__/data/ocr_test.ocr").toString("utf8");
const noTransactionOCRFile = fs
  .readFileSync("src/__test__/data/ocr_no_valid_records.ocr")
  .toString("utf8");

// Tests for Generate() in KID.js
describe("OCR", function () {
  describe("OCR parse", function () {
    it("parse should be a function", function () {
      expect(OCR.parse).toBeTypeOf("function");
    });

    it("parse should return an array", function () {
      expect(OCR.parse(sampleOCRfile)).toBeInstanceOf(Array);
    });

    it("when no interesting transaction in file, should return empty array", function () {
      expect(OCR.parse(noTransactionOCRFile).length).toBe(0);
    });
  });

  describe("Parses sample OCR file", () => {
    it("Parses sample file correctly", async () => {
      let filecontents = fs.readFileSync("src/__test__/data/ocr/TBOC2072.DAT").toString("utf8");
      let transactions = OCR.parse(filecontents);

      expect(transactions.length).toBe(2);
      expect(transactions[0].KID).toBe("47914510");
      expect(transactions[0].amount).toBe(5000.49);
    });
  });
});
