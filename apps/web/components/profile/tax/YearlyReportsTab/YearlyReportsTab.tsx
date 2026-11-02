import { Fragment } from "react";
import { Distribution, Donation, TaxYearlyReport } from "../../../../models";

import { TaxYearlyReportList } from "../../shared/lists/taxYearlyReportsList/TaxYearlyReportList";
import { TaxYearlyReportMobileList } from "../../shared/lists/taxYearlyReportsList/TaxYearlyReportMobileList";
import styles from "./YearlyReportsTab.module.scss";
import { AggregatedImpactTableConfiguration } from "../../donations/DonationsAggregateImpactTable/DonationsAggregateImpactTable";

/** The yearly tax reports, from the donor's data rendered on the server */
export const YearlyReportsTab: React.FC<{
  aggregatedImpactConfiguration: AggregatedImpactTableConfiguration;
  reports: TaxYearlyReport[];
  donations: Donation[];
  distributions: Distribution[];
}> = ({ aggregatedImpactConfiguration, reports, donations, distributions }) => {
  if (reports.length === 0) {
    return (
      <div className={styles.container}>
        <p>Vi har ingen årsoppgaver til deg ennå.</p>
      </div>
    );
  }

  const distributionsMap = new Map<string, Distribution>(
    distributions.map((dist) => [dist.kid, dist]),
  );

  return (
    <div className={styles.container}>
      {reports.map((report: TaxYearlyReport) => {
        const filteredDonations = donations.filter(
          (donation: Donation) => new Date(donation.timestamp).getFullYear() === report.year,
        );

        // oxlint-disable-next-line react/purity -- reads today's date for a label; recomputing it each render is intended
        const currentYear = new Date().getFullYear();

        return (
          <Fragment key={report.year}>
            {report.sumDonationsWithoutTaxUnit.sumDonations > 0 &&
              report.year === currentYear - 1 && (
                <div className={styles.notice}>
                  <strong>Donasjoner mangler skatteenhet</strong>
                  <p>
                    {report.units.length == 0
                      ? 'Registrer en skatteenhet i fanen til venstre i menyen under "skatt" og alle donasjoner vil knyttes til den. Ta kontakt på donasjon@gieffektivt.no om du ønsker å knytte donasjonene dine til flere skatteenheter.'
                      : "Du har allerede en eller flere skatteenheter. Kontakt oss på donasjon@gieffektivt.no for å knytte donasjonene dine til rett skatteenhet."}
                  </p>
                </div>
              )}
            <div className={styles.desktopList}>
              <TaxYearlyReportList
                key={report.year}
                donations={filteredDonations}
                report={report}
                aggregateImpactConfig={aggregatedImpactConfiguration}
              />
            </div>
            <div className={styles.mobileList}>
              <TaxYearlyReportMobileList
                key={report.year}
                donations={donations.filter(
                  (donation: Donation) =>
                    new Date(donation.timestamp).getFullYear() === report.year &&
                    distributionsMap.get(donation.KID)?.taxUnitId,
                )}
                report={report}
                aggregateImpactConfig={aggregatedImpactConfiguration}
              />
            </div>
          </Fragment>
        );
      })}
    </div>
  );
};
