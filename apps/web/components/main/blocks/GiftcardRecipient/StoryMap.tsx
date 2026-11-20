import React, { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { getCountryName } from "../../../shared/components/AfricaMap/countryNames";
import { useNoMotion } from "./motion";
import styles from "./GiftPage.module.scss";

// The site's Africa map (d3 and textures), loaded only on pages that show one
const AfricaMap = dynamic(
  () => import("../../../shared/components/AfricaMap/AfricaMap").then((m) => m.AfricaMap),
  { ssr: false },
);

const SVG_NS = "http://www.w3.org/2000/svg";
const STEP_MS = 650;
const PATTERN_ID = "gift-map-hatch";

/**
 * The site's Africa map, told as a small animation once the slide is shown: the countries draw
 * in from north to south, then the given countries land one by one, filled with the map's hatch
 * pattern drifting slowly, and their names appear in the list beside it. The map component
 * itself is unchanged: the animated countries are copies drawn on top of it.
 */
export const StoryMap: React.FC<{
  countries: string[];
  caption?: string | null;
  start: boolean;
}> = ({ countries, caption, start }) => {
  const noMotion = useNoMotion();
  const [shown, setShown] = useState(0);
  const [svg, setSvg] = useState<SVGSVGElement | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const ignoreHover = useCallback(() => {}, []);

  // The map loads separately; wait for its <svg>
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const find = () => {
      const found = el.querySelector("svg");
      if (found) setSvg(found);
      return !!found;
    };
    if (find()) return;
    const observer = new MutationObserver(() => find() && observer.disconnect());
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // Once: the overlay group, the drifting hatch pattern, and each country's entrance delay
  useEffect(() => {
    if (!svg) return;
    let defs = svg.querySelector("defs");
    if (!defs) defs = svg.insertBefore(document.createElementNS(SVG_NS, "defs"), svg.firstChild);
    if (!svg.querySelector(`#${PATTERN_ID}`)) {
      const pattern = document.createElementNS(SVG_NS, "pattern");
      pattern.setAttribute("id", PATTERN_ID);
      pattern.setAttribute("patternUnits", "userSpaceOnUse");
      pattern.setAttribute("width", "3");
      pattern.setAttribute("height", "3");
      pattern.innerHTML =
        '<rect width="3" height="3" fill="#fafafa"/>' +
        '<path d="M 0,3 l 3,-3 M -0.75,0.75 l 1.5,-1.5 M 2.25,3.75 l 1.5,-1.5" stroke="black" stroke-width="1" stroke-linecap="square"/>';
      if (!noMotion) {
        const drift = document.createElementNS(SVG_NS, "animateTransform");
        drift.setAttribute("attributeName", "patternTransform");
        drift.setAttribute("type", "translate");
        drift.setAttribute("from", "0 0");
        drift.setAttribute("to", "3 0");
        drift.setAttribute("dur", "1.6s");
        drift.setAttribute("repeatCount", "indefinite");
        pattern.appendChild(drift);
      }
      defs.appendChild(pattern);
    }

    const root = svg.querySelector(":scope > g");
    if (!root) return;
    const all = Array.from(root.children) as SVGGraphicsElement[];
    const boxes = all.map((c) => c.getBBox());
    const top = Math.min(...boxes.map((b) => b.y));
    const height = Math.max(...boxes.map((b) => b.y + b.height)) - top || 1;
    all.forEach((country, i) => {
      const middle = (boxes[i].y + boxes[i].height / 2 - top) / height;
      country.classList.add(styles.mapCountry);
      country.style.setProperty("--delay", `${Math.round(middle * 700)}ms`);
    });

    if (!svg.querySelector(`.${styles.mapOverlay}`)) {
      const overlay = document.createElementNS(SVG_NS, "g");
      overlay.setAttribute("class", styles.mapOverlay);
      svg.appendChild(overlay);
    }
  }, [svg, noMotion]);

  // One country after another, starting when the continent has drawn in
  useEffect(() => {
    if (!start || noMotion) return;
    const timers = countries.map((_, i) =>
      window.setTimeout(() => setShown(i + 1), 1100 + i * STEP_MS),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [start, noMotion, countries]);

  const lit = noMotion ? countries.length : shown;

  // A copy of each lit country, on top of its neighbours, that lands into place
  useEffect(() => {
    const overlay = svg?.querySelector(`.${styles.mapOverlay}`);
    if (!svg || !overlay) return;
    for (const id of countries.slice(0, lit)) {
      // The codes come from Sanity: escaped, so an odd one can't break the selector
      if (overlay.querySelector(`[data-country="${CSS.escape(id)}"]`)) continue;
      const source = svg.querySelector(`:scope > g > [id="${CSS.escape(id)}"]`);
      if (!source) continue;
      const copy = source.cloneNode(true) as SVGElement;
      copy.removeAttribute("id");
      copy.setAttribute("data-country", id);
      copy.setAttribute("fill", `url(#${PATTERN_ID})`);
      copy.querySelectorAll("[fill]").forEach((n) => n.removeAttribute("fill"));
      copy.setAttribute("class", styles.mapLanding);
      overlay.appendChild(copy);
    }
  }, [svg, lit, countries]);

  return (
    <figure className={styles.storyMap} data-visible={start || noMotion}>
      <div className={styles.storyMapSvg} ref={container}>
        <AfricaMap highlightedCountries={[]} setHoveredCountry={ignoreHover} locale="no" />
      </div>
      <figcaption>
        <ul className={styles.countryList}>
          {countries.map((country, i) => (
            <li key={country} data-shown={i < lit} data-current={i === lit - 1}>
              {getCountryName(country, "no")}
            </li>
          ))}
        </ul>
        {caption && <span className="caption">{caption}</span>}
      </figcaption>
    </figure>
  );
};
