import React from "react";
import styles from "./GiftPage.module.scss";

/** Deterministic shuffle, so server and browser agree on which squares empty out */
const order = Array.from({ length: 100 }, (_, i) => i)
  .map((i) => ({ i, k: Math.sin(i * 12.9898) * 43758.5453 }))
  .map(({ i, k }) => ({ i, k: k - Math.floor(k) }))
  .sort((a, b) => a.k - b.k)
  .map(({ i }) => i);

/**
 * 100 filled squares; when the slide is shown, `share` of them empty out one after another, e.g.
 * 75 for "three in four malaria cases prevented". The squares that stay filled are what is left.
 */
export const Waffle: React.FC<{
  data: {
    share?: number | null;
    filled_label?: string | null;
    empty_label?: string | null;
    caption?: string | null;
  };
  start: boolean;
}> = ({ data, start }) => {
  const raw = Math.round(data.share ?? 0);
  const share = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
  const emptied = new Map(order.slice(0, share).map((square, rank) => [square, rank]));
  return (
    <figure className={styles.waffle} data-visible={start}>
      <div className={styles.waffleGrid} role="img" aria-label={`${share} av 100`}>
        {Array.from({ length: 100 }, (_, i) => {
          const rank = emptied.get(i);
          return (
            <span
              key={i}
              className={styles.waffleSquare}
              data-empty={rank !== undefined}
              style={rank !== undefined ? { transitionDelay: `${500 + rank * 22}ms` } : undefined}
            />
          );
        })}
      </div>
      {(data.filled_label || data.empty_label || data.caption) && (
        <figcaption className={styles.legend}>
          {data.empty_label && (
            <span className="caption">
              <span className={styles.legendSwatchEmpty} aria-hidden /> {data.empty_label}
            </span>
          )}
          {data.filled_label && (
            <span className="caption">
              <span className={styles.legendSwatch} aria-hidden /> {data.filled_label}
            </span>
          )}
          {data.caption && <span className="caption">{data.caption}</span>}
        </figcaption>
      )}
    </figure>
  );
};
