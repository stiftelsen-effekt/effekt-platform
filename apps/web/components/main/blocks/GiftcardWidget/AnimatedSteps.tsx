import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import styles from "./GiftcardWidget.module.scss";

export type StepDirection = "forward" | "backward";

/** How long the step being left stays on screen while it fades out (matches the CSS) */
const EXIT_MS = 140;

type Snapshot = { key: string; node: React.ReactNode; header: React.ReactNode; open: boolean };
type Exiting = {
  key: string;
  node: React.ReactNode;
  direction: StepDirection;
  /** The header as it was, when it closes with this step (it fades out with it) */
  header: React.ReactNode | null;
  /** Where the step was: below the header if that stays open, otherwise at the top */
  belowHeader: boolean;
};

/**
 * The widget's steps with a short crossfade. The step being left fades out exactly where it was
 * (with the step indicator, if that closes with it), while the next one slides a little in from
 * the side it comes from; the indicator fades in when the flow starts instead of pushing the
 * content down. The panel eases to the new height in the same frame, and nothing is clipped.
 * Nothing animates until the first step change; reduced motion turns it all off (CSS).
 */
export const AnimatedSteps: React.FC<{
  stepKey: string;
  direction: StepDirection;
  /** Above the steps, without sliding (the step indicator) */
  header?: React.ReactNode;
  /** Whether the header shows */
  headerOpen?: boolean;
  children: React.ReactNode;
}> = ({ stepKey, direction, header, headerOpen = false, children }) => {
  // Known in the same render as the first change: the step that comes in needs its class
  const [initialStep] = useState(stepKey);
  const [changedBefore, setChangedBefore] = useState(false);
  const animate = changedBefore || stepKey !== initialStep;

  // The last rendered step and header, kept so they can fade out after the step changes
  const last = useRef<Snapshot>({ key: stepKey, node: children, header, open: headerOpen });
  const [exiting, setExiting] = useState<Exiting | null>(null);
  const [headerJustOpened, setHeaderJustOpened] = useState(false);

  // Before paint, so the old step never disappears for a frame
  useLayoutEffect(() => {
    const before = last.current;
    if (before.key === stepKey) return;
    setExiting({
      key: before.key,
      node: before.node,
      direction,
      header: before.open && !headerOpen ? before.header : null,
      belowHeader: before.open && headerOpen,
    });
    setHeaderJustOpened(!before.open && headerOpen);
    setChangedBefore(true);
    // Only when the step changes; the rest is read as it is then
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);
  // The current step as last rendered (what fades out when the step changes)
  useLayoutEffect(() => {
    last.current = { key: stepKey, node: children, header, open: headerOpen };
  });

  useEffect(() => {
    if (!exiting) return;
    const timer = setTimeout(() => setExiting(null), EXIT_MS);
    return () => clearTimeout(timer);
  }, [exiting]);

  // The panel's height is the header and current step's; measured before paint on a step change
  // (the observer reports a frame or two later), so it moves with the crossfade
  const flowRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ height: number; header: number } | null>(null);
  const measureRef = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    const flow = flowRef.current;
    if (!flow) return;
    const measure = () => {
      const next = { height: flow.offsetHeight, header: headerRef.current?.offsetHeight ?? 0 };
      setSize((prev) =>
        prev?.height === next.height && prev.header === next.header ? prev : next,
      );
    };
    measureRef.current = measure;
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(flow);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    measureRef.current();
  }, [stepKey, headerOpen]);

  return (
    <div
      className={`${styles.steps} ${animate ? styles.stepsinteractive : ""}`}
      style={size ? { height: size.height } : undefined}
    >
      <div ref={flowRef} className={styles.flowroot}>
        {headerOpen && (
          <div
            ref={headerRef}
            className={`${styles.flowroot} ${headerJustOpened ? styles.headerenter : ""}`}
          >
            {header}
          </div>
        )}
        <div key={stepKey} className={animate ? styles[`enter${direction}`] : undefined}>
          {children}
        </div>
      </div>
      {exiting && (
        <div
          key={`exit-${exiting.key}`}
          className={`${styles.stepexit} ${styles[`exit${exiting.direction}`]}`}
          style={{ top: exiting.belowHeader ? (size?.header ?? 0) : 0 }}
          aria-hidden="true"
          inert
        >
          {exiting.header && <div className={styles.flowroot}>{exiting.header}</div>}
          {exiting.node}
        </div>
      )}
    </div>
  );
};
