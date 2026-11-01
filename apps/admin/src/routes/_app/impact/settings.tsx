import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SettingsPage, useScrollTopOn } from "@/components/templates";
import { CharitiesSection, InterventionsSection } from "@/features/impact/settings-sections";
import { useTRPC } from "@/lib/trpc";

const sectionIds = ["charities", "interventions"] as const;
type SectionId = (typeof sectionIds)[number];

export const Route = createFileRoute("/_app/impact/settings")({
  validateSearch: (search: Record<string, unknown>): { section?: SectionId } =>
    typeof search.section === "string" && (sectionIds as readonly string[]).includes(search.section)
      ? { section: search.section as SectionId }
      : {},
  component: ImpactSettings,
});

function ImpactSettings() {
  const { section = "charities" } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  useScrollTopOn(section);
  const trpc = useTRPC();
  const charities = useQuery(trpc.impact.charities.list.queryOptions());
  const interventions = useQuery(trpc.impact.interventions.list.queryOptions());

  return (
    <SettingsPage
      title="Charities & interventions"
      description="Which organization each charity's estimates belong to, and the texts donors see for each intervention."
      nav={[
        { id: "charities", label: "Charities", count: charities.data?.length },
        { id: "interventions", label: "Interventions", count: interventions.data?.length },
      ]}
      value={section}
      onValueChange={(id) =>
        void navigate({
          search: id === "charities" ? {} : { section: id as SectionId },
          replace: true,
        })
      }
    >
      {section === "charities" && <CharitiesSection />}
      {section === "interventions" && <InterventionsSection />}
    </SettingsPage>
  );
}
