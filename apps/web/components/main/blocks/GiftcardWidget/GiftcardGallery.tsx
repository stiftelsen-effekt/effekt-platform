import React from "react";
import { ResponsiveImage } from "../../../shared/responsiveimage";
import type { GiftcardImage } from "./types";
import styles from "./GiftcardBlock.module.scss";

/**
 * The product's pictures: a column of small ones and a large one on desktop (as in the
 * wireframe), a sideways-scrolling row on mobile. Grey placeholders when there are none.
 */
export const GiftcardGallery: React.FC<{ images: GiftcardImage[]; title: string }> = ({
  images,
  title,
}) => {
  const valid = images.filter((image) => image?.asset);
  const [main, ...rest] = valid;
  return (
    <div className={styles.gallery} data-cy="giftcard-gallery">
      <div className={styles.galleryside}>
        {(rest.length > 0 ? rest.slice(0, 2) : [null, null]).map((image, i) => (
          <div key={i} className={styles.gallerysmall}>
            {image ? (
              <ResponsiveImage
                image={image}
                alt={image.alt || title}
                layout="cover"
                coverAspectRatio={0.73}
                sizes="(min-width: 1181px) 12vw, 45vw"
              />
            ) : (
              <div className={styles.placeholder} />
            )}
          </div>
        ))}
      </div>
      <div className={styles.gallerymain}>
        {main ? (
          <ResponsiveImage
            image={main}
            alt={main.alt || title}
            layout="cover"
            coverAspectRatio={0.73}
            priority
            sizes="(min-width: 1181px) 30vw, 90vw"
          />
        ) : (
          <div className={styles.placeholder} />
        )}
      </div>
    </div>
  );
};
