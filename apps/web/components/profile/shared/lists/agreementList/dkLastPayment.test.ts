import { describe, expect, it } from "vitest";
import { lastPaymentByKid } from "./dkLastPayment";

describe("lastPaymentByKid", () => {
  it("keeps the newest donation per KID, whatever the order", () => {
    const latest = lastPaymentByKid([
      { KID: "111", timestamp: "2026-09-01T10:00:00.000Z" },
      { KID: "222", timestamp: "2026-08-15T10:00:00.000Z" },
      { KID: "111", timestamp: "2026-10-01T10:00:00.000Z" },
      { KID: "111", timestamp: "2026-07-01T10:00:00.000Z" },
    ]);
    expect(latest.get("111")).toBe("2026-10-01T10:00:00.000Z");
    expect(latest.get("222")).toBe("2026-08-15T10:00:00.000Z");
  });

  it("has nothing for a KID without donations", () => {
    expect(lastPaymentByKid([]).get("111")).toBeUndefined();
  });
});
