/**
 * Month arithmetic for the impact admin: which months an estimate or a fund grant covers, and
 * which months change when one is added, edited or removed. Months are YYYY-MM-01 strings, as
 * in custom_modules/impact. The rule is the module's (rules.ts): a month uses the latest item
 * whose validFrom is on or before it.
 */

/** YYYY-MM-01 */
export type Month = string;

/** Inclusive; `to` null means "until a newer one is added" */
export type MonthRange = { from: Month; to: Month | null };

export function addMonths(month: Month, n: number): Month {
  const year = Number(month.slice(0, 4));
  const index = year * 12 + Number(month.slice(5, 7)) - 1 + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

/** Months from `from` to `to`, both included (0 if to < from) */
export function monthCount(from: Month, to: Month): number {
  const index = (m: Month) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));
  return Math.max(0, index(to) - index(from) + 1);
}

/**
 * The months each item covers: from its validFrom to the month before the next item's. Items
 * may come in any order; the result follows validFrom.
 */
export function coverage<T extends { validFrom: Month }>(
  items: readonly T[],
): { item: T; range: MonthRange }[] {
  const sorted = [...items].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  return sorted.map((item, i) => {
    const next = sorted[i + 1];
    return {
      item,
      range: { from: item.validFrom, to: next ? addMonths(next.validFrom, -1) : null },
    };
  });
}

/** Months of `range` up to and including `until` (the current month): how long it has applied */
export function monthsApplied(range: MonthRange, until: Month): number {
  const end = range.to === null || range.to > until ? until : range.to;
  return monthCount(range.from, end);
}

/** The latest item on or before `month` (any order) */
export function effectiveAt<T extends { validFrom: Month }>(
  items: readonly T[],
  month: Month,
): T | null {
  let found: T | null = null;
  for (const item of items)
    if (item.validFrom <= month && (!found || item.validFrom > found.validFrom)) found = item;
  return found;
}

/**
 * The months whose figure differs between two versions of one charity's estimates (or one
 * fund's grants), as ranges. `key` says what a month shows (cost per output and what it buys);
 * edits that don't change it, such as a source's name, change no month. Months are checked up to
 * `until` or the last validFrom, whichever is later.
 */
export function changedMonths<T extends { validFrom: Month }>(
  before: readonly T[],
  after: readonly T[],
  key: (item: T | null) => string,
  until: Month,
): MonthRange[] {
  const all = [...before, ...after].map((i) => i.validFrom).sort();
  if (all.length === 0) return [];
  const last = all.at(-1)! > until ? all.at(-1)! : until;
  const ranges: MonthRange[] = [];
  let open: Month | null = null;
  for (let month = all[0]!; month <= last; month = addMonths(month, 1)) {
    const differs = key(effectiveAt(before, month)) !== key(effectiveAt(after, month));
    if (differs && open === null) open = month;
    if (!differs && open !== null) {
      ranges.push({ from: open, to: addMonths(month, -1) });
      open = null;
    }
  }
  // A change that lasts past the last month checked lasts until a newer item is added
  if (open !== null) ranges.push({ from: open, to: null });
  return ranges;
}
