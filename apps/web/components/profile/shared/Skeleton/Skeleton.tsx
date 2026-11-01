import React from "react";
import style from "./Skeleton.module.scss";

/**
 * A fixed-size placeholder for content that is loading. It keeps the space the content will take,
 * so nothing on screen moves when the data arrives. `data-skeleton` marks it for tests and
 * measurements (content has loaded when no skeleton is left).
 */
export const Skeleton: React.FC<{
  height: number | string;
  width?: number | string;
}> = ({ height, width = "100%" }) => (
  <span className={style.skeleton} style={{ height, width }} data-skeleton aria-hidden />
);

/** Several skeletons stacked, marked as busy for screen readers */
export const SkeletonStack: React.FC<{ heights: (number | string)[] }> = ({ heights }) => (
  <div className={style.stack} aria-busy="true">
    {heights.map((height, i) => (
      <Skeleton key={i} height={height} />
    ))}
  </div>
);
