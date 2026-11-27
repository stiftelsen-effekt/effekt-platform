import React, { useEffect, useState } from "react";
import { Fundraiserchart } from "../../../../studio/sanity.types";
import { DateTime } from "luxon";
import { FundraiserChartSkeleton } from "./ChartSkeleton";
import styles from "./FundraiserChart.module.scss";

type FundraiserSum = { fundraiserId: string; sum: number };

const fetchFundraiserSums = async (fundraiserIds: string[]): Promise<FundraiserSum[]> => {
  const results = await Promise.all(
    fundraiserIds.map(async (fundraiserId) => {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_EFFEKT_API}/fundraisers/${fundraiserId}`,
      );
      if (!response.ok) return { fundraiserId, sum: 0 };
      const data = await response.json();
      return { fundraiserId, sum: data.content?.totalSum ?? 0 };
    }),
  );
  return results;
};

const formatNOK = (sum: number) =>
  Intl.NumberFormat("no-NB", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(sum);

export const FundraiserChart: React.FC<Fundraiserchart> = (props) => {
  const [sums, setSums] = useState<FundraiserSum[] | null>(null);
  const [lastUpdated, setLastUpdated] = useState<DateTime | null>(null);

  const fundraisers = props.fundraisers ?? [];
  const isDark = props.background === "dark";

  useEffect(() => {
    const ids = fundraisers.map((f) => f.fundraiser_id).filter((id): id is string => !!id);
    if (ids.length === 0) return;

    fetchFundraiserSums(ids).then((result) => {
      setSums(result);
      const now = DateTime.now();
      setLastUpdated(now.set({ minute: now.minute >= 30 ? 30 : 0, second: 0, millisecond: 0 }));
    });
    // Fundraiser IDs in the block are static content, read once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wrapperClass = isDark ? `${styles.wrapper} ${styles.dark}` : styles.wrapper;

  if (sums === null) {
    return (
      <div className={wrapperClass}>
        {props.heading && <h2 className={styles.heading}>{props.heading}</h2>}
        <div className={styles.graphWrapper}>
          <FundraiserChartSkeleton numberOfFundraisers={fundraisers.length} />
        </div>
      </div>
    );
  }

  const sumById = new Map(sums.map((s) => [s.fundraiserId, s.sum]));
  const ranked = fundraisers
    .map((f) => ({
      name: f.name ?? "Anonym",
      pageSlug: (f as any).page_slug as string | undefined,
      sum: (f.fundraiser_id ? sumById.get(f.fundraiser_id) : undefined) ?? 0,
    }))
    .sort((a, b) => b.sum - a.sum);

  const max = Math.max(...ranked.map((f) => f.sum), 1);
  const axisSteps = [0, max * 0.25, max * 0.5, max * 0.75, max];

  return (
    <div className={wrapperClass}>
      {props.heading && <h2 className={styles.heading}>{props.heading}</h2>}
      <div className={styles.graphWrapper}>
        {ranked.map((fundraiser) => {
          const pct = (fundraiser.sum / max) * 100;
          const insideLabel = pct > 25;
          return (
            <div className={styles.row} key={fundraiser.name}>
              <div className={styles.name}>
                {fundraiser.pageSlug ? (
                  <a href={fundraiser.pageSlug} target="_blank" rel="noopener noreferrer">
                    {fundraiser.name} ↗
                  </a>
                ) : (
                  fundraiser.name
                )}
              </div>
              <div className={styles.barTrack}>
                <div className={styles.bar} style={{ width: `${pct}%` }} />
                <div
                  className={`${styles.sum} ${insideLabel ? styles.sumInside : styles.sumOutside}`}
                  style={insideLabel ? undefined : { left: `calc(${pct}% + 1rem)` }}
                >
                  {formatNOK(fundraiser.sum)}
                </div>
              </div>
            </div>
          );
        })}
        <div className={styles.axis}>
          {axisSteps.map((value, i) => (
            <span key={i}>{formatNOK(Math.round(value))}</span>
          ))}
        </div>
      </div>
      {props.caption_template && (
        <div className={styles.caption}>
          {props.caption_template.replaceAll(
            "{lastUpdated}",
            lastUpdated ? lastUpdated.toFormat("HH:mm") : "",
          )}
        </div>
      )}
    </div>
  );
};
