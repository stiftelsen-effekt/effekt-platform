import React, { useContext, useEffect, useState } from "react";
import AnimateHeight from "react-animate-height";
import styles from "./InterventionWidget.module.scss";
import { LinkType, Links } from "../Links/Links";
import { Spinner } from "../../../shared/components/Spinner/Spinner";
import { thousandize } from "../../../../util/formatting";
import { PortableText } from "@portabletext/react";
import { NavLink } from "../../../shared/components/Navbar/Navbar";
import { stegaClean } from "@sanity/client/stega";
import { EffektButton } from "../../../shared/components/EffektButton/EffektButton";
import { WidgetContext } from "../../layout/layout";
import { usePlausible } from "next-plausible";
import { fetchInterventionCosts } from "./impactCosts";

export type InterventionWidgetOutputConfiguration = {
  interventions: SanityIntervention[];
  explanation_label: string;
  explanation_text: any[];
  explanation_links?: (LinkType | NavLink)[];
  donate_button?: boolean;
  donate_label_short?: string;
  locale: string;
};

export type SanityIntervention = {
  title: string;
  organization_name: string;
  abbreviation: string;
  template_string: string;
  organization_id: number;
  cause_area_id: number;
};

type Intervention = {
  title: string;
  organizationName: string;
  abbreviation: string;
  pricePerOutput?: number;
  outputStringTemplate: string;
  organizationId: number;
  causeAreaId: number;
  shortDescription: string;
};

export const InterventionWidgetOutput: React.FC<{
  sum: number;
  configuration: InterventionWidgetOutputConfiguration;
  currency: string;
  locale: string;
}> = ({ sum, configuration, currency }) => {
  const { interventions, explanation_label, explanation_text, explanation_links } = configuration;

  const [contextExpanded, setContextExpanded] = useState(false);
  const [interventionCosts, setInterventionCosts] = useState<Map<string, number>>(new Map());
  const [interventionShortDescriptions, setInterventionShortDescriptions] = useState<
    Map<string, string>
  >(new Map());
  const [selectedIntervention, setSelectedIntervention] = useState<string>(
    interventions ? interventions[0].title : "",
  );
  const [, setWidgetContext] = useContext(WidgetContext);
  const plausible = usePlausible();

  useEffect(() => {
    if (!interventions || interventions.length === 0) return;
    let cancelled = false;
    fetchInterventionCosts({
      abbreviations: interventions.map((i) => stegaClean(i.abbreviation)),
      locale: stegaClean(configuration.locale),
      currency: stegaClean(currency),
    })
      .then((byAbbreviation) => {
        if (cancelled) return;
        const costs = new Map<string, number>();
        const shortDescriptions = new Map<string, string>();
        for (const i of interventions) {
          const abbreviation = stegaClean(i.abbreviation);
          const cost = byAbbreviation.get(abbreviation.toUpperCase());
          if (!cost) continue;
          costs.set(abbreviation, cost.costPerOutput);
          shortDescriptions.set(abbreviation, cost.shortDescription);
        }
        setInterventionCosts(costs);
        setInterventionShortDescriptions(shortDescriptions);
      })
      .catch((err) => {
        console.error(err);
      });
    return () => {
      cancelled = true;
    };
  }, [interventions, currency, configuration.locale]);

  if (typeof interventions === "undefined" || interventions.length === 0) {
    return <span>No internventions</span>;
  }

  const mappedInterventions: Intervention[] = interventions.map((i: SanityIntervention) => ({
    title: i.title,
    abbreviation: i.abbreviation,
    pricePerOutput: interventionCosts.get(stegaClean(i.abbreviation)),
    outputStringTemplate: i.template_string,
    organizationName: i.organization_name,
    organizationId: i.organization_id,
    causeAreaId: i.cause_area_id,
    shortDescription: interventionShortDescriptions.get(stegaClean(i.abbreviation)) || "",
  }));

  const currentIntervention = mappedInterventions.find(
    (i: any) => stegaClean(i.title) === selectedIntervention,
  ) as Intervention;

  if (!currentIntervention) {
    setSelectedIntervention(stegaClean(mappedInterventions[0].title));
    return <Spinner />;
  }

  const output = currentIntervention.pricePerOutput
    ? Math.round(sum / currentIntervention.pricePerOutput)
    : 0;
  const loading = typeof currentIntervention.pricePerOutput === "undefined";
  let outputString;
  if (isNaN(output)) {
    outputString = "0";
  } else {
    outputString = output.toString();
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.select}>
        {interventions.map((i: any) => (
          <button
            data-cy={`${i.title}-button`}
            key={i.title}
            onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
              e.currentTarget.blur();
              setSelectedIntervention(stegaClean(i.title));
            }}
            className={stegaClean(i.title) === selectedIntervention ? styles.selected : ""}
          >
            {i.title}
          </button>
        ))}
      </div>
      <div className={styles.output}>
        {loading && (
          <div className={styles.spinnerWrapper}>
            <Spinner />
          </div>
        )}
        {!loading && (
          <>
            <span className="detailheader">{currentIntervention.organizationName}</span>
            <div className={styles.paragraphWrapper}>
              <span data-cy="impact-output" className={styles.paragraphNumber}>
                {thousandize(parseInt(outputString))}
              </span>
              <div className={styles.explanatory}>
                <p>
                  <span className={styles.innerParagraphNumber}>{outputString}</span>
                  {currentIntervention.outputStringTemplate}
                </p>
                <span
                  className={contextExpanded ? styles.captionopen : ""}
                  onClick={() => setContextExpanded(!contextExpanded)}
                >
                  {explanation_label}&nbsp;&nbsp;
                </span>
              </div>
            </div>
            <AnimateHeight duration={300} height={contextExpanded ? "auto" : 0} animateOpacity>
              <div className={styles.context}>
                <PortableText value={explanation_text} />
              </div>
              {explanation_links && <Links links={explanation_links}></Links>}
            </AnimateHeight>
            {configuration.donate_button && (
              <div className={styles.giveButtonWrapper}>
                <EffektButton
                  onClick={() => {
                    plausible("OpenDonationWidget", {
                      props: {
                        page: window.location.pathname,
                      },
                    });
                    plausible("OpenDonationWidgetInterventionWidgetCTA", {
                      props: {
                        page: window.location.pathname,
                      },
                    });
                    setWidgetContext({
                      open: true,
                      prefilled: [
                        {
                          causeAreaId: currentIntervention.causeAreaId,
                          share: 100,
                          organizations: [
                            {
                              organizationId: currentIntervention.organizationId,
                              share: 100,
                            },
                          ],
                        },
                      ],
                      prefilledSum: sum,
                      prefilledRecurring: null,
                    });
                  }}
                >
                  {configuration.donate_label_short?.replace(".", "") || "Gi"}{" "}
                  {thousandize(parseInt(outputString))}{" "}
                  {currentIntervention.shortDescription.toLowerCase()}
                </EffektButton>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
