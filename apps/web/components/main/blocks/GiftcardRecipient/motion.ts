import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

const subscribe = (onChange: () => void) => {
  const media = window.matchMedia?.(QUERY);
  media?.addEventListener("change", onChange);
  return () => media?.removeEventListener("change", onChange);
};

/**
 * True when the visitor asked for reduced motion, or the browser can't tell us when things scroll
 * into view: then everything is simply shown. False while rendering on the server.
 */
export const useNoMotion = () =>
  useSyncExternalStore(
    subscribe,
    () =>
      window.matchMedia?.(QUERY).matches === true || typeof IntersectionObserver === "undefined",
    () => false,
  );

/** True once the element has scrolled into view (and stays true); always true with useNoMotion */
export function useReveal<T extends Element>(threshold = 0.2) {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  const noMotion = useNoMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el || noMotion) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold, noMotion]);
  return [ref, seen || noMotion] as const;
}

/**
 * Counts from 0 to `to` over about a second once `start` is true (eased; instant with
 * useNoMotion), rounded to `decimals` places on the way, so 2,1 counts 0,0 … 1,4 … 2,1.
 */
export function useCountUp(to: number, start: boolean, durationMs = 1100, decimals = 0) {
  const [value, setValue] = useState(0);
  const noMotion = useNoMotion();
  useEffect(() => {
    if (!start || noMotion) return;
    let frame = 0;
    const began = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / durationMs);
      const factor = Math.pow(10, decimals);
      setValue(Math.round((1 - Math.pow(1 - t, 3)) * to * factor) / factor);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to, start, durationMs, decimals, noMotion]);
  return noMotion ? to : value;
}
