import { describe, it } from "vitest";
import { expect } from "chai";
import { isRecurringPaymentMethod } from "../custom_modules/recurringPaymentMethods";
import paymentMethods from "../enums/paymentMethods";

describe("isRecurringPaymentMethod", () => {
  it("is true for AvtaleGiro and Vipps recurring charges", () => {
    expect(isRecurringPaymentMethod(paymentMethods.avtalegiro)).to.be.true;
    expect(isRecurringPaymentMethod(paymentMethods.vipps_recurring)).to.be.true;
  });

  it("is false for one-off payment methods, null and undefined", () => {
    expect(isRecurringPaymentMethod(paymentMethods.vipps)).to.be.false;
    expect(isRecurringPaymentMethod(paymentMethods.bank)).to.be.false;
    expect(isRecurringPaymentMethod(null)).to.be.false;
    expect(isRecurringPaymentMethod(undefined)).to.be.false;
  });
});
