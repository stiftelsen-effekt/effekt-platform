import { describe, it } from "vitest";
import { expect } from "chai";

const { formatCurrency, getFundraiserReceiptText } = require("../custom_modules/mail");

describe("formatCurrency", function () {
  it("should use space character (U+00a0) as thousands separator", () => {
    expect(formatCurrency(123456789)).to.equal("123 456 789");
    expect(formatCurrency(12345)).to.equal("12 345");
  });

  it("should use comma (,) as decimal separator", () => {
    expect(formatCurrency(123.11)).to.equal("123,11");
    expect(formatCurrency(123.12)).to.equal("123,12");
  });

  it("should handle numeric string as input", () => {
    expect(formatCurrency("1234")).to.equal("1 234");
  });

  it("should handle number as input", () => {
    expect(formatCurrency(1234)).to.equal("1 234");
  });
});

describe("getFundraiserReceiptText", function () {
  it("should return a receipt line when the donation has a fundraiser ID", () => {
    expect(getFundraiserReceiptText(1)).to.equal(
      "Denne donasjonen var en del av en innsamlingsaksjon.",
    );
  });

  it("should return an empty string when the donation has no fundraiser ID", () => {
    expect(getFundraiserReceiptText(null)).to.equal("");
  });
});
