import { describe, expect, it } from "vitest";
import { DEMO_GIFT_CODES, getDemoGift } from "./giftDemos";
import { isGiftCode } from "./giftcardPaths";

describe("demo gift cards", () => {
  it("are served on previews and locally, never in production", () => {
    expect(getDemoGift("dmgvmdsnrb", "preview")?.product).toBe("malaria");
    expect(getDemoGift("dmgvmdsnrb", undefined)?.product).toBe("malaria");
    expect(getDemoGift("dmgvmdsnrb", "production")).toBeNull();
  });

  it("only answer their own codes", () => {
    expect(getDemoGift("bbbbbbbbbb", "preview")).toBeNull();
  });

  it("have codes the page accepts, one per product", () => {
    expect(DEMO_GIFT_CODES.every(isGiftCode)).toBe(true);
    const products = DEMO_GIFT_CODES.map((c) => getDemoGift(c, "preview")!.product);
    expect(new Set(products)).toEqual(new Set(["malaria", "myggnett", "a-vitamin", "vaksine"]));
  });
});
