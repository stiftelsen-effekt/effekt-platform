"use client";

import { DateTime } from "luxon";
import { useSearchParams } from "next/navigation";
import viewStyles from "./AgreementsView.module.scss";
import type { AgreementsPageData } from "../../../pages/dashboard/agreementsPageQuery";
import type { AgreementsData } from "../../../lib/minside/agreements";
import type { CauseAreaContext } from "../../shared/components/Widget/types/WidgetProps";
import { AgreementList } from "../shared/lists/agreementList/AgreementList";
import { DKAgreementList } from "../shared/lists/agreementList/DKAgreementList";
import { distributionsByKid } from "../shared/distributionsByKid";
import AgreementsMenu, { AgreementsMenuOptions } from "../agreements/AgreementsMenu/AgreementsMenu";

/** The mobile tab (`?vis=stoppede`); wide screens show both lists */
const TAB_PARAM = "vis";
const INACTIVE_TAB = "stoppede";

const useSelectedTab = () =>
  useSearchParams()?.get(TAB_PARAM) === INACTIVE_TAB
    ? AgreementsMenuOptions.INACTIVE_AGREEMENTS
    : AgreementsMenuOptions.ACTIVE_AGREEMENTS;

/**
 * The tab menu in the header on phones. It changes the URL without a server round trip
 * (history.replaceState, which useSearchParams follows), so the page's lists switch at once.
 */
export function AgreementsTabs({
  activeLabel,
  inactiveLabel,
}: {
  activeLabel: string;
  inactiveLabel: string;
}) {
  const selected = useSelectedTab();
  return (
    <AgreementsMenu
      selected={selected}
      activeLabel={activeLabel}
      inactiveLabel={inactiveLabel}
      onChange={(tab) => {
        const url = new URL(window.location.href);
        if (tab === AgreementsMenuOptions.INACTIVE_AGREEMENTS)
          url.searchParams.set(TAB_PARAM, INACTIVE_TAB);
        else url.searchParams.delete(TAB_PARAM);
        window.history.replaceState(null, "", url);
      }}
    />
  );
}

/** The agreements page's content, from the donor's data rendered on the server */
export function AgreementsView({
  page,
  causeAreaContexts,
  data,
}: {
  page: AgreementsPageData;
  causeAreaContexts: CauseAreaContext[];
  data: AgreementsData;
}) {
  const selected = useSelectedTab();
  // Phones show the selected tab's list; wide screens both (CSS, so server and browser agree)
  const shown = (tab: AgreementsMenuOptions) =>
    selected === tab ? undefined : viewStyles.onlyOnWideScreens;
  const distributions = distributionsByKid(data.distributions, { fetched: true, failed: false });

  if (data.site === "dk") {
    return (
      <div className={viewStyles.lists}>
        <div className={shown(AgreementsMenuOptions.ACTIVE_AGREEMENTS)}>
          <DKAgreementList
            agreements={data.dkAgreements.filter((agreement) => !agreement.cancelled)}
            distributions={distributions}
            taxUnits={data.taxUnits}
            expandable={true}
            configuration={page.active_list_configuration}
            causeAreaContexts={causeAreaContexts}
          />
        </div>
        <div className={shown(AgreementsMenuOptions.INACTIVE_AGREEMENTS)}>
          <DKAgreementList
            agreements={data.dkAgreements.filter((agreement) => agreement.cancelled)}
            distributions={distributions}
            taxUnits={data.taxUnits}
            expandable={false}
            configuration={page.inactive_list_configuration}
            causeAreaContexts={causeAreaContexts}
          />
        </div>
      </div>
    );
  }

  const { vipps, avtaleGiro } = data;
  const now = DateTime.now();
  const isRecent = (iso: string | null) =>
    iso !== null && DateTime.fromISO(iso).diff(now, "days").days > -7;
  const pendingCount =
    vipps.filter((a) => a.status === "PENDING" && isRecent(a.timestamp_created)).length +
    avtaleGiro.filter((a) => a.active === 0 && a.cancelled === null && isRecent(a.created)).length;
  const pendingBox = page.pending_agreements_box_configuration;
  const fill = (template: string) => template.replace("{{count}}", String(pendingCount));

  return (
    <>
      {pendingCount >= 1 && (
        <div className={viewStyles.pending}>
          <strong>
            {pendingCount === 1
              ? pendingBox.single_pending_agreement_title
              : fill(pendingBox.multiple_pending_agreements_title_template)}
          </strong>
          <p>
            {pendingCount === 1
              ? pendingBox.single_pending_agreement_text
              : fill(pendingBox.multiple_pending_agreements_text_template)}
          </p>
        </div>
      )}

      <div className={viewStyles.lists}>
        <div className={shown(AgreementsMenuOptions.ACTIVE_AGREEMENTS)}>
          <AgreementList
            vipps={vipps.filter((agreement) => agreement.status === "ACTIVE")}
            avtalegiro={avtaleGiro.filter((agreement) => agreement.active === 1)}
            distributions={distributions}
            taxUnits={data.taxUnits}
            expandable={true}
            configuration={page.active_list_configuration}
          />
        </div>
        <div className={shown(AgreementsMenuOptions.INACTIVE_AGREEMENTS)}>
          <AgreementList
            vipps={vipps.filter((agreement) => agreement.status !== "ACTIVE")}
            avtalegiro={avtaleGiro.filter((agreement) => agreement.cancelled !== null)}
            distributions={distributions}
            taxUnits={data.taxUnits}
            expandable={false}
            configuration={page.inactive_list_configuration}
          />
        </div>
      </div>
    </>
  );
}
