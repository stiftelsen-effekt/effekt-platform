/**
 * The maths of the moral weights calculator, kept free of React so it can be unit tested.
 *
 * Each outcome has a number of people helped for a fixed amount of money and a moral weight (units
 * of value per person). Value = count × weight. The first outcome is the benchmark the others are
 * compared with; its weight is fixed (GiveWell: doubling one person's consumption for a year = 1).
 */

export type Outcome = {
  label: string;
  /** What the count means, e.g. "15 people, one year each" */
  detail?: string;
  /** How many people (or cases, or lives) the money covers */
  count: number;
  /** The moral weight, in units of value per person */
  weight: number;
  /** The benchmark's weight cannot be changed by the user */
  fixed?: boolean;
  /** Slider range for non fixed outcomes */
  weightMax?: number;
  weightLabel?: string;
  /** Shown next to the slider value, e.g. "people" */
  weightUnit?: string;
  /** What the count counts, e.g. "children" */
  countLabel?: string;
};

export type Preset = { label: string; weights: number[] };

export type OutcomeResult = {
  label: string;
  detail?: string;
  value: number;
  /**
   * How many people the benchmark would have to help to be worth the same: value divided by the
   * benchmark's weight per person. With the benchmark weight 1 this equals the value.
   */
  equivalent: number;
  /** value / the benchmark's value */
  multiple: number;
  /** value / the largest value, 0 to 1, for drawing the bar */
  share: number;
  best: boolean;
  /** Within 10% of the largest value: too close to call given how rough the inputs are */
  closeToBest: boolean;
};

/** How close to the largest value counts as "about the same". */
export const CLOSE_SHARE = 0.9;

export const outcomeValue = (count: number, weight: number) =>
  Math.max(0, count) * Math.max(0, weight);

/** Values for every outcome given the current weights (same order as `outcomes`). */
export const computeResults = (outcomes: Outcome[], weights: number[]): OutcomeResult[] => {
  const values = outcomes.map((outcome, i) => outcomeValue(outcome.count, weights[i] ?? 0));
  const max = Math.max(...values, 0);
  const benchmark = values[0] || 0;
  const benchmarkWeight = weights[0] ?? 0;
  return outcomes.map((outcome, i) => ({
    label: outcome.label,
    detail: outcome.detail,
    value: values[i],
    equivalent: benchmarkWeight > 0 ? values[i] / benchmarkWeight : 0,
    multiple: benchmark > 0 ? values[i] / benchmark : 0,
    share: max > 0 ? values[i] / max : 0,
    // Ties are not "best": nothing wins when every outcome is worth the same.
    best: max > 0 && values[i] === max && values.filter((v) => v === max).length === 1,
    closeToBest: max > 0 && values[i] >= max * CLOSE_SHARE,
  }));
};

/**
 * The weight at which `outcome` would be worth exactly as much as the benchmark. Below it the
 * benchmark gives more value for the same money. null when it cannot be computed.
 */
export const breakEvenWeight = (benchmark: Outcome, benchmarkWeight: number, outcome: Outcome) =>
  outcome.count > 0 ? outcomeValue(benchmark.count, benchmarkWeight) / outcome.count : null;

/** Replaces {name} placeholders. Unknown placeholders are left as they are. */
export const fillTemplate = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (match, name) => (name in values ? values[name] : match));

export const formatNumber = (value: number, locale = "nb-NO") => {
  const rounded = Math.abs(value) < 10 && !Number.isInteger(value) ? 1 : 0;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: rounded,
  }).format(value);
};

/** The preset whose weights equal the current ones, if any. */
export const matchingPreset = (presets: Preset[], weights: number[]) =>
  presets.findIndex(
    (preset) =>
      preset.weights.length === weights.length && preset.weights.every((w, i) => w === weights[i]),
  );

/** Clamps a slider value into its range and snaps it to a whole number. */
export const clampWeight = (value: number, max: number) =>
  Math.min(Math.max(Math.round(Number.isFinite(value) ? value : 0), 0), max);
