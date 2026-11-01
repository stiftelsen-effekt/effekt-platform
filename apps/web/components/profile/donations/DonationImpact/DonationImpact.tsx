import React, { useCallback, useState } from "react";
import {
  Distribution,
  DistributionCauseArea,
  Donation,
  DonationImpactEntry,
} from "../../../../models";
import { useMainLocale } from "../../../../context/MainLocaleContext";
import { Organization } from "../../../shared/components/Widget/types/Organization";
import style from "./DonationImpact.module.scss";
import { DonationImpactItem, PreComputedImpact } from "./DonationImpactItem";
import {
  DonationImpactItemsConfiguration,
  DonationImpactList,
  ImpactDistributionEntry,
} from "./DonationImpactList";
import { isFundOrganizationId, mapNameToOrgAbbriv } from "../../../../util/mappings";
import { toNumber } from "../../../../util/decimal";

export type { DonationImpactItemsConfiguration };

const isOperationsOrg = (name: string) => name === "Drift" || mapNameToOrgAbbriv(name) === "Drift";

/**
 * The estimate for money given directly to an organization, from the donation's `impact`
 * (minside.donations): its entries for that organization with a count, summed per output. Null
 * when there is none (no evaluation, operations, funds, or no figures for the donation).
 */
export const directImpactFor = (
  entries: DonationImpactEntry[] | undefined,
  organizationId: number,
  aboutOrgUrlTemplate: string,
): PreComputedImpact | null => {
  const own = (entries ?? []).filter(
    (e) => e.organizationId === organizationId && e.count !== null && !e.viaFund,
  );
  if (own.length === 0) return null;
  const [first] = own;
  return {
    output: own.filter((e) => e.unit === first.unit).reduce((sum, e) => sum + (e.count ?? 0), 0),
    shortDescription: first.unit ?? "",
    longDescription: first.description ?? "",
    charityName: first.recipient,
    orgUrl: aboutOrgUrlTemplate.replace("{{org}}", first.recipient).replaceAll(" ", "_"),
  };
};

const toDistributionEntry = (
  org: { id: number; name?: string; percentageShare: string | number },
  donationSum: number,
  causeAreaShare: number,
  impact: PreComputedImpact | null,
): ImpactDistributionEntry => ({
  org: mapNameToOrgAbbriv(org.name as string),
  orgName: org.name ?? "unknown",
  isFund: isFundOrganizationId(org.id),
  isOperations: isOperationsOrg(org.name as string),
  sum: donationSum * (toNumber(org.percentageShare) / 100) * causeAreaShare,
  impact,
});

const DonationImpact: React.FC<{
  donation: Donation;
  distribution: Distribution;
  configuration: DonationImpactItemsConfiguration;
  organizations: Organization[];
}> = ({ donation, distribution, configuration, organizations }) => {
  const mainLocale = useMainLocale();
  const [requiredPrecision, setRequiredPrecision] = useState(0);
  const updatePrecision = useCallback(
    (precision: number) => {
      if (precision > requiredPrecision) setRequiredPrecision(precision);
    },
    [requiredPrecision],
  );

  if (mainLocale === "dk" && donation.impact?.length) {
    return (
      <div className={style.container}>
        <table className={style.wrapper} cellSpacing={0} data-cy="donation-impact-list">
          <tbody>
            {donation.impact.map((entry, i) => {
              const matchedOrg = organizations.find((org) => org.name === entry.organization);
              if (!matchedOrg) {
                console.error(
                  `No organization found matching DK impact organization "${entry.organization}"`,
                );
              }
              return (
                <DonationImpactItem
                  key={`${donation.id}-impact-${i}`}
                  orgAbriv=""
                  orgName={entry.recipient}
                  sumToOrg={entry.amount}
                  precision={requiredPrecision}
                  signalRequiredPrecision={updatePrecision}
                  configuration={configuration.impact_item_configuration}
                  preComputedImpact={{
                    output: entry.count ?? 0,
                    shortDescription: entry.unit ?? "",
                    longDescription: matchedOrg?.shortDescription ?? "",
                    charityName: entry.recipient,
                    orgUrl: matchedOrg?.informationUrl ?? "",
                  }}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  const multipleCauseAreas = distribution.causeAreas.length > 1;
  const donationSum = toNumber(donation.sum);

  /**
   * When a donation spans multiple cause areas, operations (Drift) is pulled out of the
   * individual cause area sections and shown as its own titled section aggregating the
   * operations amount across all cause areas (see donation overview design).
   */
  const operationsSum = multipleCauseAreas
    ? distribution.causeAreas.reduce((total, causeArea) => {
        const causeAreaShare = toNumber(causeArea.percentageShare) / 100;
        const causeAreaOperations = causeArea.organizations
          .filter((org) => isOperationsOrg(org.name as string))
          .reduce(
            (sum, org) =>
              sum + donationSum * (toNumber(org.percentageShare) / 100) * causeAreaShare,
            0,
          );
        return total + causeAreaOperations;
      }, 0)
    : 0;

  return (
    <>
      {distribution.causeAreas.map((causeArea: DistributionCauseArea) => {
        const causeAreaShare = toNumber(causeArea.percentageShare) / 100;
        const organizations = multipleCauseAreas
          ? causeArea.organizations.filter((org) => !isOperationsOrg(org.name as string))
          : causeArea.organizations;

        return (
          <div key={`${donation.id}-causarea${causeArea.id}-impact`}>
            {multipleCauseAreas && <h5 className={style.causeAreaHeader}>{causeArea.name}</h5>}
            <DonationImpactList
              donation={donation}
              distribution={organizations.map((org) =>
                toDistributionEntry(
                  org,
                  donationSum,
                  causeAreaShare,
                  // Sweden's database has no impact figures (docs/impact-api-migration.md)
                  mainLocale === "sv"
                    ? null
                    : directImpactFor(
                        donation.impact,
                        org.id,
                        configuration.impact_item_configuration.about_org_link_url_format_string,
                      ),
                ),
              )}
              configuration={configuration}
            />
          </div>
        );
      })}
      {multipleCauseAreas && operationsSum > 0 && (
        <div key={`${donation.id}-operations`}>
          <h5 className={style.causeAreaHeader}>
            {configuration.operations_section_title ?? configuration.operations_label}
          </h5>
          <DonationImpactList
            donation={donation}
            distribution={[
              {
                org: "Drift",
                orgName: configuration.operations_label,
                isOperations: true,
                sum: operationsSum,
              },
            ]}
            configuration={configuration}
          />
        </div>
      )}
    </>
  );
};

export default DonationImpact;
