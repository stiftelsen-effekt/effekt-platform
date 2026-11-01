import { Link } from "@tanstack/react-router";
import { ArrowUpRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Status } from "@/components/domain/status";
import { impactCoverage } from "@/lib/status";
import { cn } from "@/lib/utils";
import { coverageState, formatUsdCents } from "./model";

const linkClass = "rounded-xs text-accent hover:underline focus-ring";

/** A charity's cost estimates through time (opens as a panel over lists) */
export function CharityLink({ charityId, children }: { charityId: number; children: ReactNode }) {
  return (
    <Link
      to="/impact/estimates/$charityId"
      params={{ charityId: String(charityId) }}
      className={linkClass}
    >
      {children}
    </Link>
  );
}

export function GrantLink({ id, children }: { id: number; children: ReactNode }) {
  return (
    <Link to="/impact/grants/$id" params={{ id: String(id) }} className={linkClass}>
      {children}
    </Link>
  );
}

/** USD cents, tabular digits */
export function UsdCents({ value, className }: { value: number | null; className?: string }) {
  return <span className={cn("num whitespace-nowrap", className)}>{formatUsdCents(value)}</span>;
}

export function CoverageStatus({
  row,
  currentMonth,
}: {
  row: { validFrom: string; current: boolean };
  currentMonth: string;
}) {
  return <Status catalog={impactCoverage} value={coverageState(row, currentMonth)} />;
}

/**
 * A source: its name, linking to its URL(s). Old rows sometimes hold several URLs, one per line,
 * or none.
 */
export function SourceLinks({
  name,
  url,
  truncate = false,
}: {
  name: string;
  url: string;
  /** One line per link, the whole name in the tooltip */
  truncate?: boolean;
}) {
  const urls = url
    .split(/\s+/)
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u));
  if (urls.length === 0) return name ? <span>{name}</span> : <span>–</span>;
  return (
    <span className="grid gap-0.5">
      {urls.map((href, i) => (
        <a
          key={href + i}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title={i === 0 && name ? name : href}
          className={cn(linkClass, "inline-flex max-w-full items-start gap-0.5 break-words")}
        >
          <span className={cn("min-w-0", truncate && "truncate")}>
            {i === 0 && name ? name : new URL(href).hostname}
          </span>
          <ArrowUpRightIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ))}
    </span>
  );
}
