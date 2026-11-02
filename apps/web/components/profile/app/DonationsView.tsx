"use client";

import { useMemo, type ReactNode } from "react";
import { useIsMobile } from "../../../hooks/useIsMobile";
import style from "./DonationsView.module.scss";
import type { AggregatedDonations, Distribution, Donation, Donor, TaxUnit } from "../../../models";
import type { Organization } from "../../shared/components/Widget/types/Organization";
import type { CauseArea } from "../../shared/components/Widget/types/CauseArea";
import type { DonationsPageData } from "../../../pages/dashboard/donationsPageQuery";
import { ErrorMessage } from "../shared/ErrorMessage/ErrorMessage";
import { DonationList } from "../shared/lists/donationList/DonationList";
import DonationYearMenu from "../donations/YearMenu/YearMenu";
import { DonationsAggregateImpactTable } from "../donations/DonationsAggregateImpactTable/DonationsAggregateImpactTable";
import DonationsChart from "../donations/DonationsChart/DonationsChart";
import { ImpactEstimateExplanation } from "../donations/DonationsAggregateImpactTable/ImpactEstimateExplanation";
import { toNumber } from "../../../util/decimal";
import DonationsTotals from "../donations/DonationsTotal/DonationsTotal";
import { DonationsYearlyGraph } from "../donations/DonationsYearlyChart/DonationsYearlyChart";
import { getDonationSum, getYearlySum, getYears } from "../donations/donationsPageData";

export type DonationsData = {
  donorId: number;
  donor: Donor;
  donations: Donation[];
  aggregated: AggregatedDonations[];
  distributions: Distribution[];
  taxUnits: TaxUnit[];
  organizations: Organization[];
  causeAreas: CauseArea[];
};

/**
 * The donations page's content once the donor's data is there (rendered on the server with it,
 * then interactive in the browser). The same layout as the pages router's DonationsPage.
 */
export function DonationsView({
  page,
  mainLocale,
  filterYear,
  data,
}: {
  page: DonationsPageData;
  mainLocale: string;
  filterYear: string | null;
  data: DonationsData;
}) {
  const isMobile = useIsMobile();
  const { donor, donations, aggregated, distributions, taxUnits, organizations, causeAreas } = data;
  const periodDonations = useMemo(
    () =>
      filterYear === null
        ? donations
        : donations.filter(
            (donation) => new Date(donation.timestamp).getFullYear() === parseInt(filterYear),
          ),
    [donations, filterYear],
  );
  const distributionsMap = useMemo(
    () => new Map<string, Distribution>(distributions.map((d) => [d.kid, d])),
    [distributions],
  );
  const tableConfiguration = isMobile
    ? page.mobile_donations_table_configuration
    : page.desktop_donations_table_configuration;

  const missingListConfig = (
    <ErrorMessage>
      <p>Missing Sanity configuration for donation list.</p>
    </ErrorMessage>
  );

  if (donations.length === 0) {
    return (
      <>
        <DonationYearMenu totalTitle={page.year_menu_total_title} years={[]} selected={"total"} />
        {tableConfiguration ? (
          <DonationList
            donations={[]}
            distributions={new Map<string, Distribution>()}
            taxUnits={taxUnits}
            year={page.year_menu_total_title}
            configuration={tableConfiguration}
            detailsConfiguration={page.donations_details_configuration}
            firstOpen={false}
            organizations={organizations}
            causeAreas={causeAreas}
          />
        ) : (
          missingListConfig
        )}
      </>
    );
  }

  const isTotal = filterYear === null;
  const years = getYears(donor, donations);
  const firstYear = Math.min(...years);
  const sum = getDonationSum(aggregated, filterYear || undefined);
  const totalsByOrganization = new Map<string, number>();
  for (const row of aggregated) {
    if (row.organization !== null && (filterYear === null || row.year === Number(filterYear))) {
      totalsByOrganization.set(
        row.organization,
        (totalsByOrganization.get(row.organization) ?? 0) + toNumber(row.value),
      );
    }
  }
  const distribution = Array.from(totalsByOrganization, ([org, sum]) => ({ org, sum }));

  let periodText = "";
  if (isTotal) {
    periodText = page.sum_all_times_template_string?.replace("{{year}}", String(firstYear)) ?? "";
  } else {
    periodText = page.sum_year_template_string?.replace("{{year}}", filterYear) ?? "";
  }

  const donationsOfYear = (year: number) =>
    donations
      .filter((donation) => new Date(donation.timestamp).getFullYear() === year)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  let donationList: ReactNode;
  if (!tableConfiguration) {
    donationList = missingListConfig;
  } else {
    const listYears = isTotal ? [...years].sort((a, b) => b - a) : [parseInt(filterYear)];
    donationList = listYears.map((year) => (
      <DonationList
        key={year}
        donations={donationsOfYear(year)}
        distributions={distributionsMap}
        taxUnits={taxUnits}
        year={String(year)}
        configuration={tableConfiguration}
        detailsConfiguration={page.donations_details_configuration}
        firstOpen={false}
        organizations={organizations}
        causeAreas={causeAreas}
      />
    ));
  }

  return (
    <>
      {mainLocale === "sv" && (
        <div className={style.notice}>
          Ännu är inte alla donationer registrerade i vår databas. Vi arbetar med att importera
          donationer från före 2023. Om du saknar en donation, vänligen kontakta oss på{" "}
          <a href="mailto:donationer@geeffektivt.se">donationer@geeffektivt.se</a>.
        </div>
      )}

      <DonationYearMenu
        totalTitle={page.year_menu_total_title}
        years={years}
        selected={filterYear || "total"}
      />

      <DonationsChart distribution={distribution} organizations={[...organizations]} />
      <DonationsTotals sum={sum} period={periodText} />

      {/* A new year's rows and lists fade in (React ViewTransition; nothing under reduced motion) */}
      <div key={filterYear ?? "total"}>
        <div className={style.period}>
          {page.aggregate_estimated_impact ? (
            <DonationsAggregateImpactTable
              donations={periodDonations}
              configuration={page.aggregate_estimated_impact}
            />
          ) : (
            <ErrorMessage>Aggregate donations impact texts are missing in Sanity</ErrorMessage>
          )}
          <ImpactEstimateExplanation
            explanations={page.donations_details_configuration?.cause_area_impact_estimates}
          />
          {isTotal && isMobile ? (
            <DonationsYearlyGraph data={getYearlySum(aggregated, years)} />
          ) : (
            <div className={style.lists}>{donationList}</div>
          )}
        </div>
      </div>
    </>
  );
}
