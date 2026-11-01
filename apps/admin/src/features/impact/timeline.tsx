import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatMonthRange, formatUsdCents } from "./model";

type TimelineEstimate = {
  id: number;
  validFrom: string;
  validTo: string | null;
  centsPerOutput: number;
  current: boolean;
};

const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));

/**
 * A charity's estimates as one bar from the first estimate's month to this month, a segment per
 * estimate sized by the months it covers. The table beside it holds the same facts; the bar is
 * there to see gaps and how long each estimate has applied at a glance.
 */
export function EstimateTimeline({
  estimates,
  currentMonth,
}: {
  /** Oldest first */
  estimates: TimelineEstimate[];
  currentMonth: string;
}) {
  if (estimates.length === 0) return null;
  const start = monthIndex(estimates[0]!.validFrom);
  const last = estimates.at(-1)!;
  const end = Math.max(monthIndex(currentMonth), monthIndex(last.validFrom));
  const total = end - start + 1;
  const years = [];
  for (let year = Number(estimates[0]!.validFrom.slice(0, 4)) + 1; year * 12 + 1 <= end; year++)
    years.push(year);

  return (
    <figure aria-hidden className="grid gap-1">
      <div className="flex h-8 overflow-hidden rounded-sm border border-border">
        {estimates.map((e) => {
          const to = e.validTo === null ? end : monthIndex(e.validTo);
          const months = to - monthIndex(e.validFrom) + 1;
          return (
            <div
              key={e.id}
              title={`${formatMonthRange(e.validFrom, e.validTo)}: ${formatUsdCents(e.centsPerOutput)}`}
              style={{ flexGrow: months, flexBasis: 0 }}
              className={cn(
                "flex min-w-0 items-center border-r border-background px-1.5 text-xs last:border-r-0",
                e.current ? "bg-success-subtle font-semibold" : "bg-muted text-muted-foreground",
              )}
            >
              <span className="num truncate">{formatUsdCents(e.centsPerOutput)}</span>
            </div>
          );
        })}
      </div>
      <div className="relative h-4 text-xs text-muted-foreground">
        <span className="absolute left-0">{formatDate(estimates[0]!.validFrom, "month")}</span>
        {years
          .filter((_, i) => years.length <= 8 || i % 2 === 1)
          .map((year) => (
            <span
              key={year}
              className="num absolute -translate-x-1/2"
              style={{ left: `${((year * 12 + 1 - start) / total) * 100}%` }}
            >
              {year}
            </span>
          ))}
      </div>
    </figure>
  );
}
