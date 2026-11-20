import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import styles from "./GiftcardWidget.module.scss";

export type StepDirection = "forward" | "backward";

/** How long the step being left stays on screen while it fades out (matches the CSS) */
const EXIT_MS = 140;

type Exiting = { key: string; node: React.ReactNode; direction: StepDirection };

/**
 * The widget's steps with a short crossfade: the step being left fades out where it was while
 * the next one slides a little in from the side it comes from, so the panel is never empty.
 * Nothing is clipped: the panel grows at once (new content is never cut off) and shrinks
 * smoothly (the old step fades out inside it). Nothing animates until the first step change,
 * and reduced motion turns it all off (CSS).
 */
export const AnimatedSteps: React.FC<{
  stepKey: string;
  direction: StepDirection;
  /** Shown above the steps without sliding (the step indicator) */
  header?: React.ReactNode;
  children: React.ReactNode;
}> = ({ stepKey, direction, header, children }) => {
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

  // The panel follows the current step's height: growing is immediate, shrinking eases
  const innerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ height: number; growing: boolean } | null>(null);
  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const measure = () => {
      const height = inner.offsetHeight;
      setSize((prev) =>
        prev?.height === height ? prev : { height, growing: !prev || height > prev.height },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={`${styles.steps} ${animate && size && !size.growing ? styles.stepsshrinking : ""}`}
      style={size ? { height: size.height } : undefined}
    >
      <div ref={innerRef} className={styles.stepsinner}>
        {header}
        <div className={styles.stage}>
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
    </div>
  );
};
