import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ErrorState } from "@/components/domain/error-state";
import { Pending } from "@/components/ui/pending";
import { EstimateForm } from "@/features/impact/estimate-form";
import { loadPage } from "@/lib/route-data";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_app/impact/estimates/$charityId/new")({
  loader: ({ context: { queryClient, trpc }, params, cause }) => {
    const charityId = Number(params.charityId);
    if (!(charityId > 0)) return;
    return loadPage(queryClient, cause, [
      trpc.impact.estimates.charity.queryOptions({ charityId }),
      trpc.impact.interventions.list.queryOptions(),
    ]);
  },
  component: NewEstimatePage,
});

function NewEstimatePage() {
  const { charityId } = Route.useParams();
  const trpc = useTRPC();
  const timeline = useQuery({
    ...trpc.impact.estimates.charity.queryOptions({ charityId: Number(charityId) }),
    // The form starts from this snapshot
    refetchOnWindowFocus: false,
  });
  if (timeline.isError)
    return (
      <div className="p-6">
        <ErrorState
          back={{ to: "/impact/estimates", label: "All cost estimates" }}
          error={timeline.error}
          title="Couldn't load the charity"
          onRetry={() => void timeline.refetch()}
        />
      </div>
    );
  if (!timeline.data) return <Pending className="min-h-96" label="Loading the charity" />;
  return <EstimateForm timeline={timeline.data} />;
}
