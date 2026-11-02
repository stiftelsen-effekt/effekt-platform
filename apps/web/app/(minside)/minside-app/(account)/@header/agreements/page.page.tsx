import { getAgreementsPageContent } from "../../../../../../lib/minside/content";
import { AgreementsTabs } from "../../../../../../components/profile/app/AgreementsView";

/** Blocking, like the page: the tabs read the URL's search params (request data) */
export const instant = false;

/** The agreements page's tabs in the header, shown on phones (active / stopped agreements) */
export default async function AgreementsHeader() {
  const { page } = await getAgreementsPageContent();
  if (!page) return null;
  return (
    <AgreementsTabs
      activeLabel={page.active_list_configuration?.title ?? ""}
      inactiveLabel={page.inactive_list_configuration?.title ?? ""}
    />
  );
}
