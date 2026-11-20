import React, { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { getCountryName } from "../../../shared/components/AfricaMap/countryNames";
import { useNoMotion } from "./motion";
import styles from "./GiftPage.module.scss";

// The site's Africa map (d3 and textures), loaded only on pages that show one
const AfricaMap = dynamic(
  () => import("../../../shared/components/AfricaMap/AfricaMap").then((m) => m.AfricaMap),
  { ssr: false },
);

const STEP_MS = 450;

/**
 * The site's Africa map with the given countries lighting up one by one once the slide is shown,
 * each name appearing in the list beside it as its country does.
 */
export const StoryMap: React.FC<{
  countries: string[];
  caption?: string | null;
  start: boolean;
}> = ({ countries, caption, start }) => {
  const noMotion = useNoMotion();
  const [shown, setShown] = useState(0);
  const ignoreHover = useCallback(() => {}, []);

  useEffect(() => {
    if (!start || noMotion) return;
    const timers = countries.map((_, i) =>
      window.setTimeout(() => setShown(i + 1), 400 + i * STEP_MS),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [start, noMotion, countries]);

  const lit = noMotion ? countries.length : shown;
  return (
    <figure className={styles.storyMap}>
      <div className={styles.storyMapSvg}>
        <AfricaMap
          highlightedCountries={countries.slice(0, lit)}
          setHoveredCountry={ignoreHover}
          locale="no"
        />
      </div>
      <figcaption>
        <ul className={styles.countryList}>
          {countries.map((country, i) => (
            <li key={country} data-shown={i < lit}>
              {getCountryName(country, "no")}
            </li>
          ))}
        </ul>
        {caption && <span className="caption">{caption}</span>}
      </figcaption>
    </figure>
  );
};
