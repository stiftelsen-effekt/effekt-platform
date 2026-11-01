import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ErrorState } from "@/components/domain/error-state";
import { Pending } from "@/components/ui/pending";
import { EstimateForm } from "@/features/impact/estimate-form";
import { loadPage } from "@/lib/route-data";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_app/impact/estimates/$charityId/edit/$estimateId")({
  loader: ({ context: { queryClient, trpc }, params, cause }) => {
    const charityId = Number(params.charityId);
    if (!(charityId > 0)) return;
    return loadPage(queryClient, cause, [
      trpc.impact.estimates.charity.queryOptions({ charityId }),
      trpc.impact.interventions.list.queryOptions(),
    ]);
  },
  component: EditEstimatePage,
});

function EditEstimatePage() {
  const { charityId, estimateId } = Route.useParams();
  const trpc = useTRPC();
  const timeline = useQuery({
    ...trpc.impact.estimates.charity.queryOptions({ charityId: Number(charityId) }),
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const estimate = timeline.data?.estimates.find((e) => String(e.id) === estimateId);
  if (timeline.isError || (timeline.data && !estimate))
    return (
      <div className="p-6">
        <ErrorState
          back={{ to: "/impact/estimates", label: "All cost estimates" }}
          error={timeline.error ?? new Error(`No estimate #${estimateId} for this charity`)}
          title={`Couldn't load estimate #${estimateId}`}
          onRetry={() => void timeline.refetch()}
        />
      </div>
    );
  if (!timeline.data || !estimate)
    return <Pending className="min-h-96" label="Loading the estimate" />;
  return <EstimateForm timeline={timeline.data} estimate={estimate} />;
}
