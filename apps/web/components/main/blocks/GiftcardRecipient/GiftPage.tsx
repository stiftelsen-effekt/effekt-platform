import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { SanityImageObject } from "@sanity/image-url";
import type { GiftcardGift } from "@effekt/api/giftcard";
import { SEO } from "../../../shared/seo/Seo";
import { ResponsiveImage } from "../../../shared/responsiveimage";
import { GiftIcon, type GiftIconName } from "./GiftIcons";
import { useCountUp, useReveal } from "./motion";
import styles from "./GiftPage.module.scss";

type Image = SanityImageObject & { alt?: string };

export type GiftPageProduct = {
  title: string;
  slug: string;
  description?: string | null;
  images?: Image[] | null;
  productPage?: string | null;
  recipient?: {
    impact?: string | null;
    icon?: GiftIconName | null;
    cta_heading?: string | null;
    cta_label?: string | null;
    story?: Array<{
      _key: string;
      kicker?: string | null;
      heading?: string | null;
      text?: string | null;
      stat?: { value?: string | null; label?: string | null } | null;
      image?: Image | null;
    }> | null;
    organization?: {
      name: string;
      subtitle?: string | null;
      oneliner?: string | null;
      logo?: Image | null;
      page?: string | null;
    } | null;
  } | null;
};

/** How many icons the counter draws; more units show as "+ N" */
const MAX_ICONS = 24;

export const fillImpact = (template: string, units: number, unit: string) =>
  template.replace(/\{units\}/g, String(units)).replace(/\{unit\}/g, unit);

const formatGivenAt = (iso: string) =>
  new Date(iso).toLocaleDateString("nb-NO", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Oslo",
  });

/**
 * The recipient's page (pages/[state]/gave/[code].page.tsx): an envelope to open, the greeting
 * as a card, the gift's impact counted up, the product's story told in chapters as you scroll,
 * who does the work, and an invitation to give a gift card yourself. Texts and pictures come from
 * the gift card product in Sanity (Recipient page group); names and greeting from the purchase.
 * With reduced motion everything is simply shown.
 */
export const GiftPage: React.FC<{
  gift: GiftcardGift | null;
  product: GiftPageProduct | null;
}> = ({ gift, product }) => {
  if (!gift) {
    return (
      <main className={styles.page}>
        <SEO title="En gave til deg" description="" siteName="Gi Effektivt" noIndex />
        <section className={styles.unavailable}>
          <h1>Gaven din er trygt på plass 🎁</h1>
          <p>Vi får ikke vist den akkurat nå. Prøv igjen om litt.</p>
        </section>
      </main>
    );
  }
  return <Gift gift={gift} product={product} />;
};

const Gift: React.FC<{ gift: GiftcardGift; product: GiftPageProduct | null }> = ({
  gift,
  product,
}) => {
  const [opened, setOpened] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const unit = gift.units === 1 ? gift.unitSingular : gift.unitPlural;
  const recipient = product?.recipient;
  const impact = recipient?.impact
    ? fillImpact(recipient.impact, gift.units, unit)
    : `${gift.units} ${unit}`;
  const story =
    recipient?.story && recipient.story.length > 0
      ? recipient.story
      : product?.description
        ? [
            {
              _key: "description",
              heading: product.title,
              text: product.description,
              image: product.images?.[0] ?? null,
            },
          ]
        : [];

  const open = () => {
    setOpened(true);
    // Let the envelope open before bringing the card into view
    window.setTimeout(
      () => cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }),
      900,
    );
  };

  return (
    <main className={styles.page}>
      <SEO
        title="En gave til deg"
        description="Noen har gitt deg en gave."
        siteName="Gi Effektivt"
        noIndex
      />

      <section className={styles.hero} data-opened={opened}>
        <p className={styles.eyebrow}>Til {gift.recipientName}</p>
        <h1 className={styles.heroTitle}>
          {gift.senderName} har gitt deg
          <br />
          en gave
        </h1>

        <button
          type="button"
          className={styles.envelope}
          onClick={open}
          disabled={opened}
          aria-label={opened ? "Gaven er åpnet" : "Åpne gaven"}
        >
          <span className={styles.envelopeBack} aria-hidden />
          <span className={styles.letter} aria-hidden>
            <span className={styles.letterLine} />
            <span className={styles.letterLine} />
            <span className={styles.letterLineShort} />
          </span>
          <span className={styles.envelopeFront} aria-hidden />
          <span className={styles.flap} aria-hidden />
          <span className={styles.seal} aria-hidden>
            ♥
          </span>
        </button>
        <button
          type="button"
          className={styles.openButton}
          onClick={open}
          data-hidden={opened}
          tabIndex={opened ? -1 : 0}
        >
          Åpne gaven
        </button>
        {opened && <Confetti />}
      </section>

      <section className={styles.greeting} data-opened={opened} aria-hidden={!opened}>
        <div className={styles.card} ref={cardRef}>
          <p className={styles.cardDate}>{formatGivenAt(gift.givenAt)}</p>
          <p className={styles.cardTo}>Kjære {gift.recipientName},</p>
          {gift.message ? (
            <p className={styles.cardMessage}>{gift.message}</p>
          ) : (
            <p className={styles.cardMessage}>
              Jeg har gitt en gave til både deg og noen av dem som trenger det mest.
            </p>
          )}
          <p className={styles.cardFrom}>Hilsen {gift.senderName}</p>
        </div>
        <p className={styles.scrollHint}>Se hva gaven gjør ↓</p>
      </section>

      {opened && (
        <>
          <Impact
            units={gift.units}
            unit={unit}
            impact={impact}
            icon={recipient?.icon ?? "heart"}
          />

          {story.map((chapter, i) => (
            <Chapter key={chapter._key} chapter={chapter} flip={i % 2 === 1} />
          ))}

          {recipient?.organization && <Organization organization={recipient.organization} />}

          <Reveal as="section" className={styles.cta}>
            <h2>{recipient?.cta_heading || "Vil du også glede noen?"}</h2>
            <p>
              Et gavekort fra Gi Effektivt går uavkortet til noen av verdens mest effektive tiltak.
            </p>
            <Link className={styles.ctaButton} href={`/${product?.productPage || "gavekort"}`}>
              {recipient?.cta_label || "Gi et gavekort"}
            </Link>
          </Reveal>
        </>
      )}
    </main>
  );
};

const Reveal: React.FC<{
  as?: "section" | "div";
  className?: string;
  children: React.ReactNode;
}> = ({ as: Tag = "div", className, children }) => {
  const [ref, visible] = useReveal<HTMLElement>();
  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement>}
      className={`${styles.reveal} ${className ?? ""}`}
      data-visible={visible}
    >
      {children}
    </Tag>
  );
};

const Impact: React.FC<{ units: number; unit: string; impact: string; icon: GiftIconName }> = ({
  units,
  unit,
  impact,
  icon,
}) => {
  const [ref, visible] = useReveal<HTMLElement>(0.4);
  const count = useCountUp(units, visible);
  const icons = Math.min(units, MAX_ICONS);
  return (
    <section
      ref={ref as React.Ref<HTMLElement>}
      className={`${styles.impact} ${styles.reveal}`}
      data-visible={visible}
    >
      <p className={styles.kicker}>Gaven din</p>
      <p className={styles.counter} aria-label={`${units} ${unit}`}>
        <span className={styles.counterNumber}>{count}</span> <span>{unit}</span>
      </p>
      <div className={styles.icons} aria-hidden>
        {Array.from({ length: icons }, (_, i) => (
          <span key={i} className={styles.icon} style={{ animationDelay: `${300 + i * 90}ms` }}>
            <GiftIcon name={icon} />
          </span>
        ))}
        {units > MAX_ICONS && <span className={styles.more}>+ {units - MAX_ICONS}</span>}
      </div>
      <p className={styles.impactText}>Gaven {impact}.</p>
    </section>
  );
};

const Chapter: React.FC<{
  chapter: NonNullable<NonNullable<GiftPageProduct["recipient"]>["story"]>[number];
  flip: boolean;
}> = ({ chapter, flip }) => (
  <Reveal as="section" className={`${styles.chapter} ${flip ? styles.flip : ""}`}>
    {chapter.image?.asset && (
      <div className={styles.chapterImage}>
        <ResponsiveImage
          image={chapter.image}
          alt={chapter.image.alt ?? ""}
          layout="cover"
          sizes="(min-width: 900px) 45vw, 100vw"
        />
      </div>
    )}
    <div className={styles.chapterText}>
      {chapter.kicker && <p className={styles.kicker}>{chapter.kicker}</p>}
      {chapter.heading && <h2>{chapter.heading}</h2>}
      {chapter.stat?.value && (
        <p className={styles.stat}>
          <span>{chapter.stat.value}</span> {chapter.stat.label}
        </p>
      )}
      {chapter.text && <p className={styles.chapterBody}>{chapter.text}</p>}
    </div>
  </Reveal>
);

const Organization: React.FC<{
  organization: NonNullable<NonNullable<GiftPageProduct["recipient"]>["organization"]>;
}> = ({ organization }) => (
  <Reveal as="section" className={styles.organization}>
    <p className={styles.kicker}>Arbeidet gjøres av</p>
    {organization.logo?.asset ? (
      <div className={styles.logo}>
        <ResponsiveImage image={organization.logo} alt={organization.name} layout="responsive" />
      </div>
    ) : (
      <h2>{organization.name}</h2>
    )}
    {(organization.subtitle || organization.oneliner) && (
      <p>{organization.subtitle || organization.oneliner}</p>
    )}
    {organization.page && (
      <Link className={styles.textLink} href={`/${organization.page}`}>
        Les mer om tiltaket →
      </Link>
    )}
  </Reveal>
);

/** A short burst of paper pieces when the envelope opens (CSS only; none with reduced motion) */
const Confetti: React.FC = () => {
  const [pieces] = useState(() =>
    Array.from({ length: 28 }, (_, i) => ({
      left: 50 + (Math.random() - 0.5) * 70,
      delay: Math.random() * 250,
      drift: (Math.random() - 0.5) * 240,
      rotate: Math.random() * 720 - 360,
      shade: i % 3,
    })),
  );
  const [done, setDone] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setDone(true), 2600);
    return () => window.clearTimeout(t);
  }, []);
  if (done) return null;
  return (
    <span className={styles.confetti} aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          className={styles.piece}
          data-shade={p.shade}
          style={
            {
              left: `${p.left}%`,
              animationDelay: `${p.delay}ms`,
              "--drift": `${p.drift}px`,
              "--rotate": `${p.rotate}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </span>
  );
};
