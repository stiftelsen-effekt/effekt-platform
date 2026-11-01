import { createFileRoute } from "@tanstack/react-router";
import { GrantForm } from "@/features/impact/grant-form";
import { loadPage } from "@/lib/route-data";

export const Route = createFileRoute("/_app/impact/grants/new")({
  loader: ({ context: { queryClient, trpc }, cause }) =>
    loadPage(queryClient, cause, [
      trpc.impact.charities.list.queryOptions(),
      trpc.impact.interventions.list.queryOptions(),
    ]),
  component: () => <GrantForm />,
});
