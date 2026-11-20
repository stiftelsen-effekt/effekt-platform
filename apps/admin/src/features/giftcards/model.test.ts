import { describe, expect, it } from "vitest";
import { displayStatus, giftcardActions, parseSendAt, toGiftcardFilter } from "./model";

describe("gift card model", () => {
  it("turns URL filters into the API filter, leaving out what isn't set", () => {
    expect(toGiftcardFilter({})).toStrictEqual({});
    expect(
      toGiftcardFilter({ q: " mia ", status: ["failed"], delivery: ["sms"], product: ["malaria"] }),
    ).toStrictEqual({
      search: "mia",
      statuses: ["failed"],
      deliveries: ["sms"],
      products: ["malaria"],
    });
  });

  it("shows a paid SMS gift card as waiting, a paid PDF one as paid", () => {
    expect(displayStatus({ status: "paid", delivery: "sms" })).toBe("waiting");
    expect(displayStatus({ status: "paid", delivery: "pdf" })).toBe("paid");
    expect(displayStatus({ status: "failed", delivery: "sms" })).toBe("failed");
  });

  it("offers retry for failed SMS, reschedule and cancel only before sending", () => {
    expect(giftcardActions({ status: "failed", delivery: "sms" })).toStrictEqual({
      retry: true,
      reschedule: false,
      cancel: false,
    });
    expect(giftcardActions({ status: "paid", delivery: "sms" })).toStrictEqual({
      retry: false,
      reschedule: true,
      cancel: true,
    });
    expect(giftcardActions({ status: "paid", delivery: "pdf" })).toStrictEqual({
      retry: false,
      reschedule: false,
      cancel: true,
    });
    expect(giftcardActions({ status: "sent", delivery: "sms" })).toStrictEqual({
      retry: false,
      reschedule: false,
      cancel: false,
    });
  });

  it("reads the send time in Oslo time, in the future and within a year", () => {
    const now = new Date("2026-12-01T12:00:00Z");
    expect(parseSendAt("2026-12-24", "16:00", now)).toStrictEqual({
      sendAt: "2026-12-24T15:00:00.000Z",
    });
    expect(parseSendAt("2026-07-01", "12:00", new Date("2026-06-01T00:00:00Z"))).toStrictEqual({
      sendAt: "2026-07-01T10:00:00.000Z",
    });
    expect(parseSendAt("2026-12-01", "12:00", now)).toStrictEqual({
      error: "Pick a time in the future",
    });
    expect(parseSendAt("2028-01-01", "12:00", now)).toStrictEqual({
      error: "Pick a time within a year",
    });
    expect(parseSendAt("", "12:00", now)).toStrictEqual({ error: "Enter a date and a time" });
  });
});
