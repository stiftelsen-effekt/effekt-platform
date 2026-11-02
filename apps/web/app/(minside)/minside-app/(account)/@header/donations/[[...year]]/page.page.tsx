import { unstable_rethrow } from "next/navigation";
import { getDonationsPageContent, getMinsideFrame } from "../../../../../../../lib/minside/content";
import { getDonationsData, visibleDonationsPath } from "../../../../../../../lib/minside/donations";
import { getYears } from "../../../../../../../components/profile/donations/donationsPageData";
import { DonationYearMenu } from "../../../../../../../components/profile/app/client";

/**
 * The donations page's year menu in the header, as on mobile (hidden on wide screens, where the
 * page shows its own). Same data as the page: getDonationsData is memoised per request.
 */
export const instant = false;

export default async function DonationsHeader({
  params,
}: {
  params: Promise<{ year?: string[] }>;
}) {
  const [content, { mainLocale }, { year }] = await Promise.all([
    getDonationsPageContent(),
    getMinsideFrame(),
    params,
  ]);
  if (!content.page) return null;
  const filterYear = year?.[0] ?? null;
  // A failure shows on the page itself; the header just leaves the menu out
  const data = await getDonationsData(
    mainLocale,
    visibleDonationsPath(filterYear),
    filterYear,
  ).catch((error) => {
    unstable_rethrow(error); // the login redirect of verifySession
    return null;
  });
  const years = data && data.donations.length > 0 ? getYears(data.donor, data.donations) : [];
  return (
    <DonationYearMenu
      totalTitle={content.page.year_menu_total_title}
      years={years}
      selected={filterYear || "total"}
      mobile
    />
  );
}
