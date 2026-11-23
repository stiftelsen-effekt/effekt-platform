import { describe, it, expect } from "vitest";
import { normalizeReferralCode } from "../custom_modules/referralCode";

describe("donationReferralCodes", () => {
  describe("normalizeReferralCode", () => {
    it("trims whitespace", () => {
      expect(normalizeReferralCode("  match-2026  ")).toBe("match-2026");
    });

    it("treats empty and whitespace-only values as absent", () => {
      expect(normalizeReferralCode("")).toBeUndefined();
      expect(normalizeReferralCode("   ")).toBeUndefined();
    });

    it("ignores non-string values", () => {
      expect(normalizeReferralCode(undefined)).toBeUndefined();
      expect(normalizeReferralCode(12)).toBeUndefined();
    });
  });
});
