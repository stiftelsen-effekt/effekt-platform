import { ViewTransition } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { getMinsideFrame, getTaxPageContent } from "../../../../../../lib/minside/content";
import { getTaxData, type TaxData } from "../../../../../../lib/minside/tax";
import { errorCode } from "../../../../../../lib/minside/donations";
import { builtMinsidePaths } from "../../../../../../lib/minside/sanityPaths";
import { isMobileUserAgent } from "../../../../../../lib/minside/userAgent";
import { selectedTaxFeature } from "../../../../../../pages/dashboard/taxPageQuery";
import { PageContent } from "../../../../../../components/profile/layout/PageContent/PageContent";
import { MinsidePageProviders } from "../../../../../../components/profile/app/MinsidePageProviders";
import {
  ErrorMessage,
  TaxDeductionsTab,
  TaxMenu,
  TaxUnitsTab,
  YearlyReportsTab,
} from "../../../../../../components/profile/app/client";

/** Rendered whole once the tab's data is there, like the other Min Side pages */
export const instant = false;

type Params = Promise<{ tab?: string[] }>;

export async function generateMetadata(): Promise<Metadata> {
  const [{ siteTitle }, content] = await Promise.all([getMinsideFrame(), getTaxPageContent()]);
  return { title: `${siteTitle} | ${content.page?.title ?? ""}` };
}

export default async function TaxPage({ params }: { params: Params }) {
  const [content, { mainLocale }, { tab }] = await Promise.all([
    getTaxPageContent(),
    getMinsideFrame(),
    params,
  ]);
  const page = content.page;
  if (!page?.features) {
    return (
      <PageContent>
        <ErrorMessage>
          {page ? "No features defined for tax page" : "Missing tax page"}
        </ErrorMessage>
      </PageContent>
    );
  }
  const feature = selectedTaxFeature(page.features, tab?.[0]);

  let data: TaxData | null = null;
  try {
    const returnTo = "/" + [...(builtMinsidePaths().tax ?? []), ...(tab ?? [])].join("/");
    data = await getTaxData(mainLocale, feature?._type === "taxstatements", returnTo);
  } catch (error) {
    unstable_rethrow(error); // the login redirect of verifySession
    console.error(`Min Side tax: loading failed (${errorCode(error)})`);
  }
  const userAgent = (await headers()).get("user-agent") ?? "";

  let tabContent = null;
  if (!data) {
    tabContent = <ErrorMessage />;
  } else if (!feature || feature._type === "taxunits") {
    tabContent = (
      <TaxUnitsTab
        title={feature?.tax_units_title}
        createButtonLabel={feature?.create_tax_unit_button_label}
        emptyStateDescription={feature?.empty_tax_units_description}
        emptyStateLinkLabel={feature?.empty_tax_units_link_label}
        numberOfDonationsLabel={feature?.number_of_donations_label || "Antall donasjoner"}
        sumDonationsLabel={feature?.sum_donations_label || "Sum donasjoner"}
        sumTaxDeductionsLabel={feature?.sum_tax_deductions_label || "Sum skattefradrag"}
        sumTaxBenefitLabel={feature?.sum_tax_benefit_label || "Sum skattefordel"}
      />
    );
  } else if (feature._type === "taxstatements") {
    tabContent = data.reports ? (
      <YearlyReportsTab
        aggregatedImpactConfiguration={feature.aggregate_estimated_impact}
        reports={data.reports.reports}
        donations={data.reports.donations}
        distributions={data.reports.distributions}
      />
    ) : (
      <ErrorMessage />
    );
  } else if (feature._type === "abouttaxdeductions") {
    tabContent = (
      <TaxDeductionsTab
        description={feature.about || []}
        links={feature.links ? feature.links.links : []}
      />
    );
  }

  return (
    <PageContent title={page.title}>
      <TaxMenu selected={feature} choices={page.features} />
      {/* Another tab's content crossfades in (a view transition) */}
      <ViewTransition
        key={feature?.slug.current ?? "default"}
        enter="ds-swap"
        exit="ds-swap"
        default="none"
      >
        <div>
          {data ? (
            <MinsidePageProviders
              donorId={data.donorId}
              taxUnits={data.taxUnits}
              mobileGuess={isMobileUserAgent(userAgent)}
            >
              {tabContent || <ErrorMessage>Missing page content</ErrorMessage>}
            </MinsidePageProviders>
          ) : (
            tabContent
          )}
        </div>
      </ViewTransition>
    </PageContent>
  );
}
