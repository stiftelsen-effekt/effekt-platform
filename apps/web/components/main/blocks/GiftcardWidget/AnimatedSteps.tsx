import React, { useLayoutEffect, useRef, useState } from "react";
import styles from "./GiftcardWidget.module.scss";

export type StepDirection = "forward" | "backward";

/**
 * The widget's steps, animated like the fundraiser widget's panes: the panel's height follows
 * the content (300 ms), and each new step slides in from the side it comes from while fading
 * in. `stepKey` changing is what starts the slide. Reduced motion turns both off (CSS).
 */
export const AnimatedSteps: React.FC<{
  stepKey: string;
  direction: StepDirection;
  /** Shown above the steps without sliding (the step indicator); its height is animated too */
  header?: React.ReactNode;
  children: React.ReactNode;
}> = ({ stepKey, direction, header, children }) => {
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const measure = () => setHeight(inner.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={styles.steps} style={height === null ? undefined : { height }}>
      <div ref={innerRef} className={styles.stepsinner}>
        {header}
        <div key={stepKey} className={styles[`enter${direction}`]}>
          {children}
        </div>
      </div>
    </div>
  );
};
