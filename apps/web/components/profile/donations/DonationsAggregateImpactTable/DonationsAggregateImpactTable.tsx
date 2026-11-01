import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import AnimateHeight from "react-animate-height";
import { ChevronDown } from "react-feather";
import style from "./DonationsAggregateImpactTable.module.scss";
import { Donation } from "../../../../models";
import { useMainLocale } from "../../../../context/MainLocaleContext";
import { DistributionsRow } from "./DistributionsRow";
import { LoadingButtonSpinner } from "../../../shared/components/Spinner/LoadingButtonSpinner";
import {
  aggregateDanishImpact,
  aggregateImpact,
  DK_OPERATIONS_KEY,
  GIVEWELL_ALL_GRANTS_FUND_KEY,
} from "./_util";

export type AggregatedImpactTableConfiguration = {
  title: string;
  org_grant_template_string: string;
  org_direct_template_string: string;
  org_operations_string: string;
  currency: string;
  locale: string;
};

export const DonationsAggregateImpactTable: React.FC<{
  donations: Donation[];
  configuration: AggregatedImpactTableConfiguration;
  defaultExpanded?: boolean;
}> = ({ donations, configuration, defaultExpanded = true }) => {
  const isDK = configuration.locale === "dk";
  // Sweden's database has no impact figures (docs/impact-api-migration.md, decision 5)
  const isSE = useMainLocale() === "sv" || configuration.locale === "sv";
  const [expanded, setExpanded] = useState(
    defaultExpanded || (typeof window !== "undefined" && window.innerWidth > 1180),
  );
  const [loadedClass, setLoadedClass] = useState<string>("");
  const [lastimpactCount, setLastimpactCount] = useState<number>(0);
  const [currentHeight, setCurrentHeight] = useState<number | "auto">(0);
  const [currentTimeoutId, setCurrentTimeoutId] = useState<NodeJS.Timeout | null>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // The impact comes with the donations (minside.donations): nothing to fetch
  const impact = useMemo(
    () =>
      isSE
        ? {}
        : isDK
          ? aggregateDanishImpact(donations)
          : aggregateImpact(donations, {
              org_direct_template_string: configuration.org_direct_template_string,
              org_grant_template_string: configuration.org_grant_template_string,
            }),
    [
      isSE,
      isDK,
      donations,
      configuration.org_direct_template_string,
      configuration.org_grant_template_string,
    ],
  );
  const loading = false;

  useLayoutEffect(() => {
    setTimeout(() => setLoadedClass(style.loaded), 50);
  }, []);

  const currentImpactCount = Object.keys(impact).length;
  if (!loading && lastimpactCount !== currentImpactCount) {
    setLastimpactCount(currentImpactCount);
  }

  if (currentImpactCount != lastimpactCount || loading) {
    // oxlint-disable-next-line react/refs -- measures the table's height while rendering to animate it; moving it to an effect needs restructuring
    const height = tableContainerRef.current?.clientHeight;
    // oxlint-disable-next-line react/refs -- measures the table's height while rendering to animate it; moving it to an effect needs restructuring
    if (currentHeight != height && typeof height !== "undefined") {
      // oxlint-disable-next-line react/refs -- measures the table's height while rendering to animate it; moving it to an effect needs restructuring
      setCurrentHeight(height);
    }
  } else {
    if (currentHeight !== "auto") {
      if (currentTimeoutId === null) {
        const timeoutId: NodeJS.Timeout = setTimeout(() => {
          setCurrentHeight("auto");
          clearTimeout(timeoutId);
          setCurrentTimeoutId(null);
        }, 100);
        setCurrentTimeoutId(timeoutId);
      }
    }
  }

  if (isSE) return null;

  return (
    <div
      className={[style.distribution, loadedClass].join(" ")}
      data-cy="aggregated-distribution-table"
    >
      <div
        className={style.distributionHeader}
        onClick={() => {
          if (typeof window !== "undefined" && window.innerWidth <= 1180) {
            setExpanded(!expanded);
          }
        }}
      >
        <span>
          {configuration.title}
          <div className={style.loadingSpinner}>
            <LoadingButtonSpinner />
          </div>
        </span>

        <ChevronDown size={"24"} color={"black"} className={expanded ? style.chevronRotated : ""} />
      </div>
      <AnimateHeight height={expanded ? currentHeight : 0}>
        <div
          ref={tableContainerRef}
          style={{
            height: expanded ? currentHeight : "auto",
            overflow: "hidden",
          }}
        >
          <table
            cellSpacing={0}
            className={style.maintable}
            data-cy="aggregated-distribution-table-main"
          >
            <tbody>
              {Object.keys(impact)
                .filter(
                  (key) =>
                    key.toLowerCase().indexOf("drift") === -1 &&
                    key !== GIVEWELL_ALL_GRANTS_FUND_KEY &&
                    key !== DK_OPERATIONS_KEY,
                )
                .sort((a: string, b: string) => (b < a ? 1 : -1))
                .map((key: string) => (
                  <DistributionsRow
                    aggregatedimpact={impact}
                    outputkey={key}
                    key={key}
                  ></DistributionsRow>
                ))}
              {Object.keys(impact)
                .filter(
                  (key) =>
                    key.toLowerCase().indexOf("drift") !== -1 ||
                    key === GIVEWELL_ALL_GRANTS_FUND_KEY ||
                    key === DK_OPERATIONS_KEY,
                )
                .sort((a: string, b: string) => {
                  if (a === GIVEWELL_ALL_GRANTS_FUND_KEY && b !== GIVEWELL_ALL_GRANTS_FUND_KEY)
                    return 1;
                  if (b === GIVEWELL_ALL_GRANTS_FUND_KEY && a !== GIVEWELL_ALL_GRANTS_FUND_KEY)
                    return -1;
                  return 0;
                })
                .map((key: string) => (
                  <DistributionsRow
                    aggregatedimpact={impact}
                    outputkey={key}
                    key={key}
                  ></DistributionsRow>
                ))}
            </tbody>
          </table>
        </div>
      </AnimateHeight>
    </div>
  );
};
