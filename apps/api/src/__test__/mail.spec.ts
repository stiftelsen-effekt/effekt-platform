import { describe, it, expect } from "vitest";

const { formatCurrency, isSingleDonation } = require("../custom_modules/mail");

describe("formatCurrency", function () {
  it("should use space character (U+00a0) as thousands separator", () => {
    expect(formatCurrency(123456789)).toBe("123 456 789");
    expect(formatCurrency(12345)).toBe("12 345");
  });

  it("should use comma (,) as decimal separator", () => {
    expect(formatCurrency(123.11)).toBe("123,11");
    expect(formatCurrency(123.12)).toBe("123,12");
  });

  it("should handle numeric string as input", () => {
    expect(formatCurrency("1234")).toBe("1 234");
  });

  it("should handle number as input", () => {
    expect(formatCurrency(1234)).toBe("1 234");
  });
});

describe("isSingleDonation", function () {
  it("should return true for a one-off bank or card payment", () => {
    expect(isSingleDonation(2)).toBe(true); // bank
    expect(isSingleDonation(3)).toBe(true); // paypal
  });

  it("should return false for an AvtaleGiro or Vipps recurring payment", () => {
    expect(isSingleDonation(7)).toBe(false); // avtalegiro
    expect(isSingleDonation(8)).toBe(false); // vipps_recurring
  });

  it("should return false when the payment method is missing", () => {
    expect(isSingleDonation(null)).toBe(false);
    expect(isSingleDonation(undefined)).toBe(false);
  });
});
