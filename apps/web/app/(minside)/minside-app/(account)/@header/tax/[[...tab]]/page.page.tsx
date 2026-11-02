import { getTaxPageContent } from "../../../../../../../lib/minside/content";
import { TaxMenu } from "../../../../../../../components/profile/app/client";
import { selectedTaxFeature } from "../../../../../../../pages/dashboard/taxPageQuery";

/** The tax page's tabs in the header, shown on phones */
export const instant = false;

export default async function TaxHeader({ params }: { params: Promise<{ tab?: string[] }> }) {
  const [{ page }, { tab }] = await Promise.all([getTaxPageContent(), params]);
  if (!page?.features) return null;
  return (
    <TaxMenu
      mobile
      selected={selectedTaxFeature(page.features, tab?.[0])}
      choices={page.features}
    />
  );
}
