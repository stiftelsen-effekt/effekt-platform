import { describe, expect, it } from "vitest";
import {
  breakEvenWeight,
  clampWeight,
  computeResults,
  fillTemplate,
  formatNumber,
  matchingPreset,
  outcomeValue,
  type Outcome,
} from "./moralWeights";

// GiveWell's rough example for $10,000 (blog.givewell.org/2025/07/17/apples-oranges-and-outcomes)
// with the weights from givewell.org/how-we-work/our-criteria/cost-effectiveness/moral-weights.
const outcomes: Outcome[] = [
  { label: "Kontanter", count: 15, weight: 1, fixed: true },
  { label: "Klumpfot", count: 8, weight: 30, weightMax: 100 },
  { label: "Liv", count: 2, weight: 116, weightMax: 300 },
];

describe("computeResults", () => {
  it("multiplies people by weight and compares with the benchmark", () => {
    const [cash, clubfoot, lives] = computeResults(outcomes, [1, 30, 116]);
    expect(cash.value).toBe(15);
    expect(clubfoot.value).toBe(240);
    expect(lives.value).toBe(232);
    expect(clubfoot.multiple).toBe(16);
    expect(lives.multiple).toBeCloseTo(15.47, 2);
  });

  it("marks the largest value as best and scales bars to it", () => {
    const results = computeResults(outcomes, [1, 30, 116]);
    expect(results.map((r) => r.best)).toEqual([false, true, false]);
    expect(results[1].share).toBe(1);
    expect(results[0].share).toBeCloseTo(15 / 240, 6);
  });

  it("lets lives win when they are weighted higher", () => {
    const results = computeResults(outcomes, [1, 30, 200]);
    expect(results.map((r) => r.best)).toEqual([false, false, true]);
  });

  it("flags results within 10% of the best as close to it", () => {
    // 240 vs 232 at GiveWell's weights: clubfoot and lives are too close to call, cash is not.
    expect(computeResults(outcomes, [1, 30, 116]).map((r) => r.closeToBest)).toEqual([
      false,
      true,
      true,
    ]);
    expect(computeResults(outcomes, [1, 30, 200]).map((r) => r.closeToBest)).toEqual([
      false,
      false,
      true,
    ]);
    expect(computeResults(outcomes, [0, 0, 0]).some((r) => r.closeToBest)).toBe(false);
  });

  it("has no winner on a tie, and no NaN when everything is zero", () => {
    expect(computeResults(outcomes, [1, 10, 40]).some((r) => r.best)).toBe(false);
    const zero = computeResults(outcomes, [0, 0, 0]);
    expect(zero.every((r) => r.value === 0 && r.share === 0 && r.multiple === 0 && !r.best)).toBe(
      true,
    );
  });

  it("treats a missing or negative weight as zero", () => {
    expect(outcomeValue(2, -5)).toBe(0);
    expect(computeResults(outcomes, [1])[2].value).toBe(0);
  });
});

describe("breakEvenWeight", () => {
  it("is the weight where an outcome matches the benchmark", () => {
    expect(breakEvenWeight(outcomes[0], 1, outcomes[2])).toBe(7.5);
    expect(breakEvenWeight(outcomes[0], 1, outcomes[1])).toBe(1.875);
  });

  it("moves with the benchmark weight and is null without people", () => {
    expect(breakEvenWeight(outcomes[0], 2, outcomes[2])).toBe(15);
    expect(breakEvenWeight(outcomes[0], 1, { ...outcomes[2], count: 0 })).toBeNull();
  });
});

describe("fillTemplate", () => {
  it("fills known placeholders and keeps unknown ones", () => {
    expect(fillTemplate("{label} gir {value}, {other}", { label: "Liv", value: "232" })).toBe(
      "Liv gir 232, {other}",
    );
  });
});

describe("formatNumber", () => {
  it("uses one decimal for small fractions and none for larger numbers", () => {
    expect(formatNumber(7.5)).toBe("7,5");
    expect(formatNumber(15)).toBe("15");
    expect(formatNumber(15.47)).toBe("15");
    expect(formatNumber(1.875)).toBe("1,9");
    expect(formatNumber(12700)).toMatch(/^12\s700$/);
  });
});

describe("matchingPreset and clampWeight", () => {
  const presets = [
    { label: "GiveWell", weights: [1, 30, 116] },
    { label: "Dobbel inntekt", weights: [1, 15, 58] },
  ];
  it("finds the preset equal to the current weights", () => {
    expect(matchingPreset(presets, [1, 15, 58])).toBe(1);
    expect(matchingPreset(presets, [1, 15, 59])).toBe(-1);
  });
  it("keeps slider values whole and in range", () => {
    expect(clampWeight(116.4, 300)).toBe(116);
    expect(clampWeight(-3, 300)).toBe(0);
    expect(clampWeight(999, 300)).toBe(300);
    expect(clampWeight(Number.NaN, 300)).toBe(0);
  });
});
