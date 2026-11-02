import type { Metadata } from "next";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { getAgreementsPageContent, getMinsideFrame } from "../../../../../lib/minside/content";
import { getAgreementsData, type AgreementsData } from "../../../../../lib/minside/agreements";
import { errorCode } from "../../../../../lib/minside/donations";
import { isMobileUserAgent } from "../../../../../lib/minside/userAgent";
import { PageContent } from "../../../../../components/profile/layout/PageContent/PageContent";
import { ErrorMessage } from "../../../../../components/profile/app/client";
import { MinsidePageProviders } from "../../../../../components/profile/app/MinsidePageProviders";
import { AgreementsView } from "../../../../../components/profile/app/AgreementsView";

/** Rendered whole once the donor's agreements are there, like the donations page */
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const [{ siteTitle }, content] = await Promise.all([
    getMinsideFrame(),
    getAgreementsPageContent(),
  ]);
  return { title: `${siteTitle} | ${content.page?.title ?? ""}` };
}

export default async function AgreementsPage() {
  const [content, { mainLocale }] = await Promise.all([
    getAgreementsPageContent(),
    getMinsideFrame(),
  ]);
  const page = content.page;
  if (!page) {
    return (
      <PageContent>
        <ErrorMessage>
          <p>Missing page configuration</p>
        </ErrorMessage>
      </PageContent>
    );
  }

  let data: AgreementsData | null = null;
  try {
    data = await getAgreementsData(mainLocale);
  } catch (error) {
    unstable_rethrow(error); // the login redirect of verifySession
    console.error(`Min Side agreements: loading failed (${errorCode(error)})`);
  }
  const userAgent = (await headers()).get("user-agent") ?? "";

  return (
    <PageContent title={page.title}>
      {data ? (
        <MinsidePageProviders
          donorId={data.donorId}
          taxUnits={data.taxUnits}
          causeAreas={data.causeAreas}
          agreementFeedbackTypes={data.agreementFeedbackTypes}
          mobileGuess={isMobileUserAgent(userAgent)}
        >
          <AgreementsView
            page={page}
            causeAreaContexts={content.causeAreaContexts ?? []}
            data={data}
          />
        </MinsidePageProviders>
      ) : (
        <ErrorMessage />
      )}
    </PageContent>
  );
}
