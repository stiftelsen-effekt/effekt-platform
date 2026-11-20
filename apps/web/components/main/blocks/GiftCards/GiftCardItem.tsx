import React from "react";
import styles from "./GiftCards.module.scss";
import type { SanityImageObject } from "@sanity/image-url";
import { ResponsiveImage } from "../../../shared/responsiveimage";
import { LinkType, Links } from "../Links/Links";
import { NavLink } from "../../../shared/components/Navbar/Navbar";
import { formatGiftCardPrice } from "./formatGiftCardPrice";
import Link from "next/link";

export interface GiftCardItemProps {
  title: string;
  price?: number;
  image: SanityImageObject;
  alt?: string;
  links?: (LinkType | NavLink)[];
  /** Slug of the page of the item's gift card product (giftcard->page), which the card links to */
  giftcard_page_slug?: string | null;
  locale?: string | null;
  currency?: string | null;
}

export const GiftCardItem: React.FC<GiftCardItemProps> = ({
  title,
  price,
  image,
  alt,
  links,
  giftcard_page_slug,
  locale,
  currency,
}) => {
  const image_ = (
    <ResponsiveImage
      image={image}
      alt={alt || title}
      layout={"cover"}
      coverAspectRatio={1}
      sizes="(min-width: 1181px) 25vw, 90vw"
    />
  );
  return (
    <div className={styles.giftcarditem}>
      <div className={styles.giftcarditemimage}>
        {giftcard_page_slug ? (
          <Link href={`/${giftcard_page_slug}`} tabIndex={-1} aria-hidden>
            {image_}
          </Link>
        ) : (
          image_
        )}
      </div>
      <div className={styles.giftcarditemtext}>
        <h3>{giftcard_page_slug ? <Link href={`/${giftcard_page_slug}`}>{title}</Link> : title}</h3>
        {price != null && (
          <p className={styles.giftcarditemprice}>{formatGiftCardPrice(price, locale, currency)}</p>
        )}
      </div>
      {links && <Links links={links} buttons />}
    </div>
  );
};
