import { describe, expect, it } from "vitest";
import { DEMO_GIFT_CODES, getDemoGift } from "./giftDemos";
import { isGiftCode } from "./giftcardPaths";

describe("demo gift cards", () => {
  it("are served on previews and locally, never in production", () => {
    expect(getDemoGift("dmgvmdsnrb", "preview", "production")?.product).toBe("malaria");
    expect(getDemoGift("dmgvmdsnrb", undefined, "development")?.product).toBe("malaria");
    expect(getDemoGift("dmgvmdsnrb", "production", "production")).toBeNull();
    // A production build outside Vercel (no VERCEL_ENV)
    expect(getDemoGift("dmgvmdsnrb", undefined, "production")).toBeNull();
    // An unknown VERCEL_ENV
    expect(getDemoGift("dmgvmdsnrb", "staging", "production")).toBeNull();
  });

  it("only answer their own codes", () => {
    expect(getDemoGift("bbbbbbbbbb", "preview", "production")).toBeNull();
    expect(getDemoGift("constructor", "preview", "development")).toBeNull();
    expect(getDemoGift("__proto__", undefined, "development")).toBeNull();
  });

  it("have codes the page accepts, one per product", () => {
    expect(DEMO_GIFT_CODES.every(isGiftCode)).toBe(true);
    const products = DEMO_GIFT_CODES.map((c) => getDemoGift(c, "preview", "production")!.product);
    expect(new Set(products)).toEqual(new Set(["malaria", "myggnett", "a-vitamin", "vaksine"]));
  });
});
