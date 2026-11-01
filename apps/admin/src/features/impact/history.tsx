import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ErrorState } from "@/components/domain/error-state";
import { DateTime } from "@/components/domain/format";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatNumber } from "@/lib/format";
import { useTRPC, type RouterInputs, type RouterOutputs } from "@/lib/trpc";
import { formatUsdCents } from "./model";

export type ImpactChange = RouterOutputs["impact"]["changes"]["list"][number];
export type ImpactChangeFilter = RouterInputs["impact"]["changes"]["list"];

export const entityLabels: Record<ImpactChange["entity"], string> = {
  estimate: "Estimate",
  grant: "Fund grant",
  charity: "Charity",
  intervention: "Intervention",
};
export const actionLabels: Record<ImpactChange["action"], string> = {
  create: "Added",
  update: "Changed",
  delete: "Deleted",
};

const fieldLabels: Record<string, string> = {
  interventionId: "Intervention",
  validFrom: "From month",
  centsPerOutput: "Cost per output",
  centsPerOutputLowerBound: "Low end",
  centsPerOutputUpperBound: "High end",
  sourceName: "Source",
  sourceUrl: "Link",
  comment: "Comment",
  allotments: "Allotments",
  name: "Name",
  abbreviation: "Abbreviation",
  organizationId: "Organization",
  organizationName: "Organization name",
  shortDescription: "Short text",
  longDescription: "Long text",
  texts: "Texts in other languages",
  fund: "Fund",
  legacyId: "ID in the old API",
  charityId: "Charity",
};

/** A field's value in words: dollars for cents, months for months, a count for lists */
export function formatChangeValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "–";
  if (field.startsWith("centsPerOutput") && typeof value === "number") return formatUsdCents(value);
  if (field === "validFrom" && typeof value === "string") return formatDate(value, "month");
  if (Array.isArray(value))
    return `${formatNumber(value.length)} ${value.length === 1 ? "row" : "rows"}`;
  if (typeof value === "object") return `${Object.keys(value).length} languages`;
  const text = String(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

export function describeFields(change: ImpactChange): string[] {
  if (change.action !== "update") return [];
  return change.fields
    .filter((f) => f.field !== "organizationName")
    .map(
      (f) =>
        `${fieldLabels[f.field] ?? f.field}: ${formatChangeValue(f.field, f.before)} → ${formatChangeValue(f.field, f.after)}`,
    );
}

/** Where the changed row is shown, if it still exists */
export function changeHref(change: ImpactChange): string | null {
  if (change.action === "delete" && change.entity !== "estimate") return null;
  switch (change.entity) {
    case "estimate":
      return change.charityId ? `/impact/estimates/${change.charityId}` : null;
    case "grant":
      return `/impact/grants/${change.entityId}`;
    case "charity":
      return `/impact/estimates/${change.entityId}`;
    case "intervention":
      return "/impact/settings?section=interventions";
  }
}

const th = "text-left text-xs text-muted-foreground [&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold";
const td = "[&>td]:border-t [&>td]:border-border [&>td]:px-3 [&>td]:py-1.5 [&>td]:align-top";

/** A record's history, newest first (a section on the charity and grant pages) */
export function ChangeHistory({ filter, label }: { filter: ImpactChangeFilter; label: string }) {
  const trpc = useTRPC();
  const changes = useQuery(trpc.impact.changes.list.queryOptions(filter));
  if (changes.isError)
    return <ErrorState error={changes.error} onRetry={() => void changes.refetch()} />;
  if (!changes.data) return <div className="h-16" aria-busy />;
  if (changes.data.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        No changes made in the admin yet. Rows from the old impact API show who created them.
      </p>
    );
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm" aria-label={label}>
        <thead>
          <tr className={th}>
            <th scope="col">When</th>
            <th scope="col">Who</th>
            <th scope="col">What</th>
            <th scope="col">Changes</th>
          </tr>
        </thead>
        <tbody>
          {changes.data.map((c) => (
            <tr key={c.id} className={td}>
              <td className="whitespace-nowrap">
                <DateTime value={c.changedAt} format="datetime" />
              </td>
              <td className="max-w-48 truncate" title={c.changedBy}>
                {c.changedBy}
              </td>
              <td>
                <Badge tone={c.action === "delete" ? "danger" : undefined}>
                  {actionLabels[c.action]}
                </Badge>{" "}
                {c.summary}
              </td>
              <td>
                <ul className="grid gap-0.5">
                  {describeFields(c).map((line) => (
                    <li key={line} className="num">
                      {line}
                    </li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChangeLink({ change }: { change: ImpactChange }) {
  const href = changeHref(change);
  if (!href) return <span>{change.summary}</span>;
  return (
    <Link to={href} className="rounded-xs text-accent hover:underline focus-ring">
      {change.summary}
    </Link>
  );
}
