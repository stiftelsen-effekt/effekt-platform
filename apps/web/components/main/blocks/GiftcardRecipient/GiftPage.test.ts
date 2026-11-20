import { describe, expect, it } from "vitest";
import { axisTicks, barValue, fillImpact, splitNumber } from "./GiftPage";

describe("gift page helpers", () => {
  it("fills the impact template", () => {
    expect(fillImpact("beskytter {units} {unit}", 3, "barn")).toBe("beskytter 3 barn");
  });

  it("splits out the number to count up", () => {
    expect(splitNumber("Over 400 000")).toEqual(["Over ", 400000, ""]);
    expect(splitNumber("Rundt 70 kr")).toEqual(["Rundt ", 70, " kr"]);
    expect(splitNumber("Mange")).toBeNull();
  });

  it("keeps bar values from Sanity finite and never negative", () => {
    expect(barValue(12)).toBe(12);
    expect(barValue(-5)).toBe(0);
    expect(barValue(null)).toBe(0);
    expect(barValue(undefined)).toBe(0);
    expect(barValue(Number.NaN)).toBe(0);
    expect(barValue(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("makes round axis ticks up to the max", () => {
    expect(axisTicks(1_000_000)).toEqual([250_000, 500_000, 750_000, 1_000_000]);
    expect(axisTicks(1)).toEqual([0.25, 0.5, 0.75, 1]);
    expect(axisTicks(0.4)).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it("has no ticks for an empty or broken chart", () => {
    expect(axisTicks(0)).toEqual([]);
    expect(axisTicks(-10)).toEqual([]);
    expect(axisTicks(Number.NaN)).toEqual([]);
  });
});
