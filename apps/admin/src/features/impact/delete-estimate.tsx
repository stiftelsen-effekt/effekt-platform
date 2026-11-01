import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/domain/confirm-dialog";
import { Button } from "@/components/ui/button";
import { formatDate, formatNumber } from "@/lib/format";
import { notify } from "@/lib/notify";
import { useTRPC } from "@/lib/trpc";
import { formatMonthRange, formatMonths, formatUsdCents, type ImpactEstimate } from "./model";

/**
 * Deletes an estimate (irreversible): its months fall back to the estimate before it, or to no
 * estimate. The confirmation lists what changes for donors (impact.estimates.preview).
 */
export function DeleteEstimate({
  estimate,
  charity,
}: {
  estimate: ImpactEstimate;
  charity: { abbreviation: string; name: string };
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const preview = useQuery({
    ...trpc.impact.estimates.preview.queryOptions({ id: estimate.id, remove: true }),
    enabled: open,
  });
  const remove = useMutation(trpc.impact.estimates.delete.mutationOptions());
  const p = preview.data;
  const month = formatDate(estimate.validFrom, "month");
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="ghost" size="icon-sm" aria-label={`Delete the estimate from ${month}`}>
          <Trash2Icon />
        </Button>
      }
      tone="danger"
      title={`Delete ${charity.abbreviation}'s estimate from ${month}?`}
      consequences={
        p
          ? [
              p.after
                ? `Its months use ${formatUsdCents(p.after.centsPerOutput)} (the estimate from ${formatDate(p.after.validFrom, "month")}) instead of ${formatUsdCents(estimate.centsPerOutput)}`
                : "Its months get no estimate: donations in them show no impact",
              p.changedMonths.length
                ? `${p.changedMonths.map((r) => formatMonthRange(r.from, r.to)).join(", ")} (${formatMonths(p.monthsChanged)} so far)`
                : "No month's figure changes",
              p.organizationLinked
                ? `${formatNumber(p.donations)} donations from ${formatNumber(p.donors)} donors change on Min Side`
                : "No organization is linked, so no donation uses it",
            ]
          : ["Working out what changes…"]
      }
      disabled={!p}
      confirmLabel="Delete estimate"
      onConfirm={async () => {
        await remove.mutateAsync({ id: estimate.id });
        await queryClient.invalidateQueries({ queryKey: trpc.impact.pathKey() });
        notify.success("Estimate deleted", `${charity.name}, ${month}`);
      }}
    />
  );
}
