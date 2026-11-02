import type { Metadata } from "next";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { getDonationsPageContent, getMinsideFrame } from "../../../../../../lib/minside/content";
import {
  errorCode,
  getDonationsData,
  visibleDonationsPath,
} from "../../../../../../lib/minside/donations";
import { MinsidePageProviders } from "../../../../../../components/profile/app/MinsidePageProviders";
import { isMobileUserAgent } from "../../../../../../lib/minside/userAgent";
import { PageContent } from "../../../../../../components/profile/layout/PageContent/PageContent";
import { ErrorMessage, MissingNameModal } from "../../../../../../components/profile/app/client";
import {
  DonationsView,
  type DonationsData,
} from "../../../../../../components/profile/app/DonationsView";

/**
 * A blocking route: the page is rendered once the donor's data is there and sent whole, like a
 * classic server-rendered page. No loaders, skeletons or layout shift: on navigation inside Min
 * Side the current page stays until the next one is ready. That only works if it's fast, so a
 * page that would need a loader is a performance bug (docs/minside-ssr-plan.md, budget).
 */
export const instant = false;

type Params = Promise<{ year?: string[] }>;

export async function generateMetadata(): Promise<Metadata> {
  const [{ siteTitle }, content] = await Promise.all([
    getMinsideFrame(),
    getDonationsPageContent(),
  ]);
  return { title: `${siteTitle} | ${content.page?.title ?? ""}` };
}

export default async function DonationsPage({ params }: { params: Params }) {
  const [content, { mainLocale }, { year }] = await Promise.all([
    getDonationsPageContent(),
    getMinsideFrame(),
    params,
  ]);
  const page = content.page;
  if (!content.dashboard?.[0] || !page) {
    return (
      <PageContent>
        <ErrorMessage>
          <p>Missing {page ? "dashboard" : "page"} configuration</p>
        </ErrorMessage>
      </PageContent>
    );
  }
  const filterYear = year?.[0] ?? null;
  // The donations page is where a login lands, so it asks a donor without a name for one (a card
  // at the top of the page)
  const missingNameConfig = content.dashboard[0].missing_name_modal_configuration;

  let data: DonationsData | null = null;
  try {
    data = await getDonationsData(mainLocale, visibleDonationsPath(filterYear), filterYear);
  } catch (error) {
    unstable_rethrow(error); // the login redirect of verifySession
    console.error(`Min Side donations: loading failed (${errorCode(error)})`);
  }
  const userAgent = (await headers()).get("user-agent") ?? "";

  return (
    <PageContent title={page.title}>
      {data ? (
        <MinsidePageProviders
          donorId={data.donorId}
          taxUnits={data.taxUnits}
          causeAreas={data.causeAreas}
          mobileGuess={isMobileUserAgent(userAgent)}
        >
          {missingNameConfig && <MissingNameModal config={missingNameConfig} donor={data.donor} />}
          <DonationsView page={page} mainLocale={mainLocale} filterYear={filterYear} data={data} />
        </MinsidePageProviders>
      ) : (
        <ErrorMessage />
      )}
    </PageContent>
  );
}
