import paymentMethods from "../enums/paymentMethods";

/** AvtaleGiro and Vipps recurring charges are a donation on a standing ("fast") agreement */
const RECURRING_PAYMENT_METHOD_IDS: number[] = [
  paymentMethods.avtalegiro,
  paymentMethods.vipps_recurring,
];

export function isRecurringPaymentMethod(paymentMethodID: number | null | undefined): boolean {
  return paymentMethodID != null && RECURRING_PAYMENT_METHOD_IDS.includes(paymentMethodID);
}
