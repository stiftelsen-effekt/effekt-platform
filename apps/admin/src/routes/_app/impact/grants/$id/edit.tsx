import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ErrorState } from "@/components/domain/error-state";
import { Pending } from "@/components/ui/pending";
import { GrantForm } from "@/features/impact/grant-form";
import { loadPage } from "@/lib/route-data";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_app/impact/grants/$id/edit")({
  loader: ({ context: { queryClient, trpc }, params, cause }) => {
    const id = Number(params.id);
    if (!(id > 0)) return;
    return loadPage(queryClient, cause, [
      trpc.impact.grants.get.queryOptions({ id }),
      trpc.impact.charities.list.queryOptions(),
      trpc.impact.interventions.list.queryOptions(),
    ]);
  },
  component: EditGrantPage,
});

function EditGrantPage() {
  const { id } = Route.useParams();
  const trpc = useTRPC();
  const grant = useQuery({
    ...trpc.impact.grants.get.queryOptions({ id: Number(id) }),
    // The form starts from this snapshot
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  if (grant.isError)
    return (
      <div className="p-6">
        <ErrorState
          back={{ to: "/impact/grants", label: "All fund grants" }}
          error={grant.error}
          title={`Couldn't load grant #${id}`}
          onRetry={() => void grant.refetch()}
        />
      </div>
    );
  if (!grant.data) return <Pending className="min-h-96" label="Loading the grant" />;
  return <GrantForm grant={grant.data} />;
}
