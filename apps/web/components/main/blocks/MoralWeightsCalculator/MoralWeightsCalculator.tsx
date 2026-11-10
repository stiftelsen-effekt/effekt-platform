import { useEffect, useId, useMemo, useRef, useState } from "react";
import styles from "./MoralWeightsCalculator.module.scss";
import {
  breakEvenWeight,
  clampWeight,
  computeResults,
  fillTemplate,
  formatNumber,
  matchingPreset,
  type Outcome,
  type Preset,
} from "./moralWeights";

export type MoralWeightsCalculatorProps = {
  title?: string;
  description?: string;
  outcomes: Outcome[];
  presets?: Preset[];
  presetsLabel?: string;
  unitLabel?: string;
  multipleTemplate?: string;
  winnerTemplate?: string;
  tieTemplate?: string;
  breakevenTemplate?: string;
  locale?: string;
};

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Eases a displayed number towards `target`, so changing a slider counts up or down. */
const useAnimatedNumber = (target: number, enabled: boolean, duration = 500) => {
  const [display, setDisplay] = useState(target);
  const current = useRef(target);
  // Before the calculator is in view, and for people who ask for less motion, show the number as is
  const skip = !enabled || prefersReducedMotion();

  useEffect(() => {
    if (skip) {
      current.current = target;
      return;
    }
    const from = current.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      current.current = from + (target - from) * eased;
      setDisplay(current.current);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, skip, duration]);

  return skip ? target : display;
};

const AnimatedValue: React.FC<{ value: number; enabled: boolean; locale: string }> = ({
  value,
  enabled,
  locale,
}) => <>{formatNumber(useAnimatedNumber(value, enabled), locale)}</>;

export const MoralWeightsCalculator: React.FC<MoralWeightsCalculatorProps> = ({
  title,
  description,
  outcomes,
  presets = [],
  presetsLabel,
  unitLabel = "",
  multipleTemplate = "{value} × {benchmark}",
  winnerTemplate = "{label}",
  tieTemplate = "{labels}",
  breakevenTemplate = "{benchmark}: {label} {value}",
  locale = "nb-NO",
}) => {
  const id = useId();
  const [weights, setWeights] = useState(() => outcomes.map((o) => o.weight));
  const [revealed, setRevealed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // The bars grow when the calculator scrolls into view, once.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setRevealed(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const results = useMemo(() => computeResults(outcomes, weights), [outcomes, weights]);
  const activePreset = matchingPreset(presets, weights);
  const benchmark = outcomes[0];
  const benchmarkName = benchmark?.label.toLowerCase() ?? "";
  const leaders = results.filter((r) => r.closeToBest);

  if (!benchmark || outcomes.length < 2) return null;

  const setWeight = (index: number, value: number) =>
    setWeights((current) =>
      current.map((w, i) => (i === index ? clampWeight(value, outcomes[i].weightMax ?? 300) : w)),
    );

  const verdict =
    leaders.length === 0
      ? ""
      : leaders.length === 1
        ? fillTemplate(winnerTemplate, { label: leaders[0].label })
        : fillTemplate(tieTemplate, { labels: leaders.map((l) => l.label).join(" / ") });

  const breakEvens = outcomes
    .map((outcome, i) => ({ outcome, i }))
    .filter(({ outcome, i }) => i > 0 && !outcome.fixed)
    .map(({ outcome, i }) => ({
      outcome,
      weight: breakEvenWeight(benchmark, weights[0], outcome),
      i,
    }))
    .filter((b): b is typeof b & { weight: number } => b.weight !== null);

  return (
    <div className={styles.wrapper} ref={rootRef} data-revealed={revealed}>
      {/* Without JavaScript nothing scrolls into view: show the bars at their full length */}
      <noscript>
        <style>{`.${styles.bar}{transform:scaleX(var(--share))!important}`}</style>
      </noscript>
      {title && <h2 className={styles.title}>{title}</h2>}
      {description && <p className={styles.description}>{description}</p>}

      {presets.length > 0 && (
        <div className={styles.presets} role="group" aria-label={presetsLabel}>
          {presetsLabel && <span className={styles.presetsLabel}>{presetsLabel}</span>}
          {presets.map((preset, i) => (
            <button
              key={preset.label}
              type="button"
              className={styles.preset}
              aria-pressed={activePreset === i}
              onClick={() => setWeights(preset.weights.map((w) => w))}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}

      <div className={styles.sliders}>
        {outcomes.map((outcome, i) => {
          if (outcome.fixed) return null;
          const max = outcome.weightMax ?? 300;
          const inputId = `${id}-weight-${i}`;
          return (
            <div className={styles.slider} key={outcome.label}>
              <div className={styles.sliderHeader}>
                <label htmlFor={inputId}>{outcome.weightLabel ?? outcome.label}</label>
                <output htmlFor={inputId}>{formatNumber(weights[i], locale)}</output>
              </div>
              <input
                id={inputId}
                type="range"
                min={0}
                max={max}
                step={1}
                value={weights[i]}
                style={{ ["--fill" as string]: `${(weights[i] / max) * 100}%` }}
                onChange={(e) => setWeight(i, Number(e.target.value))}
              />
            </div>
          );
        })}
      </div>

      <ol className={styles.results}>
        {results.map((result, i) => (
          <li key={result.label} className={styles.result} data-lead={result.closeToBest}>
            <div className={styles.resultHeader}>
              <span className={styles.resultLabel}>{result.label}</span>
              <span className={styles.resultValue}>
                <AnimatedValue value={result.value} enabled={revealed} locale={locale} />
                {unitLabel && <span className={styles.unit}> {unitLabel}</span>}
              </span>
            </div>
            <div className={styles.track} aria-hidden="true">
              <div
                className={styles.bar}
                style={{
                  ["--share" as string]: result.share,
                  transform: `scaleX(${revealed ? result.share : 0})`,
                }}
              />
            </div>
            <div className={styles.resultFooter}>
              {result.detail && <span>{result.detail}</span>}
              {i > 0 && (
                <span className={styles.multiple}>
                  {fillTemplate(multipleTemplate, {
                    value: formatNumber(result.multiple, locale),
                    benchmark: benchmarkName,
                  })}
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>

      <p className={styles.verdict} aria-live="polite">
        {verdict}
      </p>

      {breakEvens.length > 0 && (
        <ul className={styles.breakEvens}>
          {breakEvens.map(({ outcome, weight }) => (
            <li key={outcome.label}>
              {fillTemplate(breakevenTemplate, {
                benchmark: benchmark.label,
                label: outcome.label.toLowerCase(),
                value: formatNumber(weight, locale),
              })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
