import React from "react";
import { GiftcardGallery } from "./GiftcardGallery";
import { GiftcardWidget } from "./GiftcardWidget";
import type { GiftcardDocument } from "./types";
import styles from "./GiftcardBlock.module.scss";

/** The `giftcardwidget` block: the product's pictures and the purchase steps side by side */
export const GiftcardBlock: React.FC<{ product: GiftcardDocument | null }> = ({ product }) => {
  if (!product?.slug?.current) return <div>Missing gift card product</div>;
  return (
    <div className={styles.container} data-cy="giftcard-block">
      <GiftcardGallery images={product.images ?? []} title={product.title ?? ""} />
      <div className={styles.panel}>
        <GiftcardWidget product={product} />
      </div>
    </div>
  );
};
