import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import styles from "./GiftcardWidget.module.scss";

export type StepDirection = "forward" | "backward";

/** How long the step being left stays on screen while it fades out (matches the CSS) */
const EXIT_MS = 140;

type Exiting = { key: string; node: React.ReactNode; direction: StepDirection };

/**
 * The widget's steps with a short crossfade: the step being left fades out where it was while
 * the next one slides a little in from the side it comes from, so the panel is never empty.
 * The header (step indicator) opens and closes smoothly, and the panel eases to its new height
 * both ways without clipping anything. Nothing animates until the first step change, and
 * reduced motion turns it all off (CSS).
 */
export const AnimatedSteps: React.FC<{
  stepKey: string;
  direction: StepDirection;
  /** Shown above the steps without sliding (the step indicator) */
  header?: React.ReactNode;
  /** Whether the header shows: it opens and closes by animating its height */
  headerOpen?: boolean;
  children: React.ReactNode;
}> = ({ stepKey, direction, header, headerOpen = false, children }) => {
  // Known in the same render as the first change: the step that comes in needs its class
  const [initialStep] = useState(stepKey);
  const [changedBefore, setChangedBefore] = useState(false);
  const animate = changedBefore || stepKey !== initialStep;

  // The last rendered step, kept so it can fade out after the step changes
  const last = useRef<{ key: string; node: React.ReactNode }>({ key: stepKey, node: children });
  const [exiting, setExiting] = useState<Exiting | null>(null);

  // Before paint, so the old step never disappears for a frame
  useLayoutEffect(() => {
    if (last.current.key === stepKey) return;
    setExiting({ ...last.current, direction });
    setChangedBefore(true);
    last.current = { key: stepKey, node: children };
    // Only when the step changes; `children` and `direction` are read as they are then
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);
  // The current step as last rendered (what fades out when the step changes)
  useLayoutEffect(() => {
    last.current = { key: stepKey, node: children };
  });

  useEffect(() => {
    if (!exiting) return;
    const timer = setTimeout(() => setExiting(null), EXIT_MS);
    return () => clearTimeout(timer);
  }, [exiting]);

  // The panel's height goes straight to where it ends up (the header's full height when open,
  // plus the current step), so it eases once instead of chasing the header as it opens
  const headerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [heights, setHeights] = useState<{ header: number; stage: number } | null>(null);
  useLayoutEffect(() => {
    const headerEl = headerRef.current;
    const stage = stageRef.current;
    if (!headerEl || !stage) return;
    const measure = () => {
      const next = { header: headerEl.offsetHeight, stage: stage.offsetHeight };
      setHeights((prev) =>
        prev?.header === next.header && prev.stage === next.stage ? prev : next,
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(headerEl);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);
  const height = heights ? (headerOpen ? heights.header : 0) + heights.stage : undefined;

  return (
    <div
      className={`${styles.steps} ${animate ? styles.stepsinteractive : ""}`}
      style={height === undefined ? undefined : { height }}
    >
      <div
        className={`${styles.headerwrap} ${headerOpen ? styles.headeropen : ""}`}
        inert={!headerOpen}
        aria-hidden={!headerOpen || undefined}
      >
        <div className={styles.headerclip}>
          <div ref={headerRef} className={styles.flowroot}>
            {header}
          </div>
        </div>
      </div>
      <div ref={stageRef} className={styles.stage}>
        {exiting && (
          <div
            key={exiting.key}
            className={`${styles.stepexit} ${styles[`exit${exiting.direction}`]}`}
            aria-hidden="true"
            inert
          >
            {exiting.node}
          </div>
        )}
        <div key={stepKey} className={animate ? styles[`enter${direction}`] : undefined}>
          {children}
        </div>
      </div>
    </div>
  );
};
