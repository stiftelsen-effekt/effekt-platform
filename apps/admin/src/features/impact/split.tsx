import { useQuery } from "@tanstack/react-query";
import { OrgSplitBar, OrgSplitLegend } from "@/components/domain/org-split";
import { orgColor, type OrgSlice } from "@/features/distribution/orgs";
import { useTRPC } from "@/lib/trpc";

type SplitPart = {
  charityId: number;
  charityName: string;
  organizationId: number | null;
  /** 0..1 */
  share: number;
};

/**
 * A fund grant's split as one bar of organizations, in their colours (docs/admin-design.md ›
 * Distributions). Allotments to the same charity are added up. A charity without an
 * organization gets a colour from its own ID.
 */
export function grantSlices(parts: SplitPart[], colors: Map<number, string | null>): OrgSlice[] {
  const byCharity = new Map<number, OrgSlice>();
  for (const part of parts) {
    const slice = byCharity.get(part.charityId);
    if (slice) {
      slice.share += part.share * 100;
      continue;
    }
    const id = part.organizationId ?? -part.charityId;
    byCharity.set(part.charityId, {
      id,
      name: part.charityName,
      share: part.share * 100,
      causeAreaId: null,
      causeAreaName: null,
      color: orgColor({ id, chartColor: colors.get(id) ?? null }),
    });
  }
  return [...byCharity.values()].sort((a, b) => b.share - a.share);
}

export function GrantSplit({ parts }: { parts: SplitPart[] }) {
  const trpc = useTRPC();
  const organizations = useQuery(trpc.config.organizations.listAll.queryOptions());
  const colors = new Map((organizations.data ?? []).map((o) => [o.id, o.chartColor ?? null]));
  const slices = grantSlices(parts, colors);
  return (
    <div className="grid gap-3">
      <OrgSplitBar slices={slices} />
      <OrgSplitLegend slices={slices} className="sm:max-w-md" />
    </div>
  );
}
