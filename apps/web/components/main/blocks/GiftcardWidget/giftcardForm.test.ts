import { describe, expect, it } from "vitest";
import {
  addDays,
  calendarDays,
  monthTitle,
  SEND_TIMES,
  clampMessage,
  countMessage,
  defaultSendDate,
  fillGiftcardText,
  formatOsloDateTime,
  giftcardTotal,
  isNorwegianMobile,
  osloDateTimeToIso,
  presetLabel,
  validateStep,
  type GiftcardFormState,
} from "./giftcardForm";

const form = (patch: Partial<GiftcardFormState> = {}): GiftcardFormState => ({
  delivery: "sms",
  units: 3,
  recipientName: "Kari",
  message: "",
  senderName: "Ola",
  recipientPhone: "912 34 567",
  sendDate: "2026-12-24",
  sendTime: "16:00",
  email: "",
  name: "",
  taxDeduction: false,
  ssn: "",
  newsletter: false,
  method: "vipps",
  ...patch,
});

describe("giftcardTotal", () => {
  it("multiplies units by the unit price", () => {
    expect(giftcardTotal(3, 100)).toBe(300);
    expect(giftcardTotal(3, 33.33)).toBe(99.99);
  });
  it("is 0 without units", () => {
    expect(giftcardTotal(null, 100)).toBe(0);
    expect(giftcardTotal(0, 100)).toBe(0);
  });
});

describe("countMessage", () => {
  it("counts an emoji as one character", () => {
    expect(countMessage("God jul 🎄").count).toBe(9);
  });
  it("flags near and over the limit", () => {
    expect(countMessage("a".repeat(269))).toMatchObject({ nearLimit: false, over: false });
    expect(countMessage("a".repeat(270))).toMatchObject({ nearLimit: true, over: false });
    expect(countMessage("a".repeat(301))).toMatchObject({ over: true, max: 300 });
  });
  it("clamps without splitting emoji", () => {
    expect(clampMessage("🎄".repeat(301))).toBe("🎄".repeat(300));
    expect(clampMessage("hei")).toBe("hei");
  });
});

describe("isNorwegianMobile", () => {
  it.each(["91234567", "412 34 567", "+47 912 34 567", "004791234567"])("accepts %s", (p) =>
    expect(isNorwegianMobile(p)).toBe(true),
  );
  it.each(["22334455", "9123456", "+46701234567", ""])("rejects %s", (p) =>
    expect(isNorwegianMobile(p)).toBe(false),
  );
});

describe("osloDateTimeToIso", () => {
  it("uses winter time (+01:00) in December", () => {
    expect(osloDateTimeToIso("2026-12-24", "16:00")).toBe("2026-12-24T16:00:00+01:00");
  });
  it("uses summer time (+02:00) in June", () => {
    expect(osloDateTimeToIso("2026-06-01", "08:30")).toBe("2026-06-01T08:30:00+02:00");
  });
  it("rejects malformed input", () => {
    expect(osloDateTimeToIso("24.12.2026", "16:00")).toBeNull();
    expect(osloDateTimeToIso("2026-12-24", "")).toBeNull();
  });
  it("formats back in Oslo time", () => {
    expect(formatOsloDateTime("2026-12-24T15:00:00Z")).toBe("24.12.2026 kl. 16:00");
  });
});

describe("defaultSendDate", () => {
  it("is Christmas Eve while it is ahead", () => {
    expect(defaultSendDate(new Date("2026-11-20T12:00:00Z"))).toBe("2026-12-24");
  });
  it("is tomorrow on and after Christmas Eve, and when it is far away", () => {
    expect(defaultSendDate(new Date("2026-12-24T12:00:00Z"))).toBe("2026-12-25");
    // 23:30 on New Year's Eve in Oslo
    expect(defaultSendDate(new Date("2026-12-31T22:30:00Z"))).toBe("2027-01-01");
    expect(defaultSendDate(new Date("2027-03-10T12:00:00Z"))).toBe("2027-03-11");
  });
});

describe("texts", () => {
  it("fills preset labels and placeholders", () => {
    expect(presetLabel("Beskytt {units} barn", 5)).toBe("Beskytt 5 barn");
    expect(
      fillGiftcardText("[dato] sender vi til [mottaker].", {
        dato: "24.12.2026 kl. 16:00",
        mottaker: "Kari",
      }),
    ).toBe("24.12.2026 kl. 16:00 sender vi til Kari.");
  });
});

describe("validateStep", () => {
  const limits = { minUnits: 1, maxUnits: 1000 };
  const now = new Date("2026-11-20T12:00:00Z");
  it("checks the number of units", () => {
    expect(validateStep("amount", form({ units: 0 }), limits, now)).toHaveProperty("units");
    expect(validateStep("amount", form({ units: 5 }), limits, now)).toEqual({});
  });
  it("requires names and a short enough greeting", () => {
    const errors = validateStep(
      "message",
      form({ recipientName: " ", senderName: "", message: "a".repeat(301) }),
      limits,
      now,
    );
    expect(Object.keys(errors).sort()).toEqual(["message", "recipientName", "senderName"]);
  });
  it("requires a mobile number and a time ahead", () => {
    expect(validateStep("delivery", form(), limits, now)).toEqual({});
    const errors = validateStep(
      "delivery",
      form({ recipientPhone: "123", sendDate: "2026-11-01" }),
      limits,
      now,
    );
    expect(Object.keys(errors).sort()).toEqual(["recipientPhone", "sendAt"]);
  });
});

describe("calendar helpers", () => {
  it("starts weeks on Monday", () => {
    // 1 December 2026 is a Tuesday
    const days = calendarDays("2026-12");
    expect(days.slice(0, 2)).toEqual([null, "2026-12-01"]);
    expect(days.filter(Boolean)).toHaveLength(31);
  });

  it("names the month in Norwegian", () => {
    expect(monthTitle("2026-12")).toBe("Desember 2026");
  });

  it("moves days across months", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("offers half hours from 08:00 to 22:00", () => {
    expect(SEND_TIMES[0]).toBe("08:00");
    expect(SEND_TIMES).toContain("16:00");
    expect(SEND_TIMES.at(-1)).toBe("22:00");
  });
});
