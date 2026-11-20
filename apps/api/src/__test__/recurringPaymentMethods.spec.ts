import { describe, it, expect } from "vitest";
import { isRecurringPaymentMethod } from "../custom_modules/recurringPaymentMethods";
import paymentMethods from "../enums/paymentMethods";

describe("isRecurringPaymentMethod", () => {
  it("is true for AvtaleGiro and Vipps recurring charges", () => {
    expect(isRecurringPaymentMethod(paymentMethods.avtalegiro)).toBe(true);
    expect(isRecurringPaymentMethod(paymentMethods.vipps_recurring)).toBe(true);
  });

  it("is false for one-off payment methods, null and undefined", () => {
    expect(isRecurringPaymentMethod(paymentMethods.vipps)).toBe(false);
    expect(isRecurringPaymentMethod(paymentMethods.bank)).toBe(false);
    expect(isRecurringPaymentMethod(null)).toBe(false);
    expect(isRecurringPaymentMethod(undefined)).toBe(false);
  });
});
