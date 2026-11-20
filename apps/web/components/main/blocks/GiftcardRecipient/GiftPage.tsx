import React, { useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { SanityImageObject } from "@sanity/image-url";
import type { GiftcardGift } from "@effekt/api/giftcard";
import { SEO } from "../../../shared/seo/Seo";
import { ResponsiveImage } from "../../../shared/responsiveimage";
import {
  EffektButton,
  EffektButtonVariant,
} from "../../../shared/components/EffektButton/EffektButton";
import { WidgetContext } from "../../layout/layout";
import { RecurringDonation } from "../../../shared/components/Widget/types/Enums";
import { useCountUp, useNoMotion, useReveal } from "./motion";
import {
  SiteMenuTable,
  type NavigationItems,
} from "../../../shared/components/SiteMenuTable/SiteMenuTable";
import { Waffle } from "./Waffle";
import { StoryMap } from "./StoryMap";
import styles from "./GiftPage.module.scss";
// A static import: served from /_next/static, which the consent proxy (proxy.page.ts) leaves alone
import logo from "../../../../public/logo-cropped.svg";

type Image = SanityImageObject & { alt?: string };

type ChartData = {
  title?: string | null;
  bars?: Array<{
    _key: string;
    label?: string | null;
    value?: number | null;
    highlight?: boolean | null;
  }> | null;
  highlight_label?: string | null;
  caption?: string | null;
};

type WaffleData = {
  share?: number | null;
  filled_label?: string | null;
  empty_label?: string | null;
  caption?: string | null;
};

type Chapter = {
  _key: string;
  heading?: string | null;
  text?: string | null;
  stat?: { value?: string | null; label?: string | null } | null;
  waffle?: WaffleData | null;
  map?: { countries?: string[] | null; caption?: string | null } | null;
  chart?: ChartData | null;
  image?: Image | null;
};

export type GiftPageProduct = {
  title: string;
  slug: string;
  description?: string | null;
  images?: Image[] | null;
  productPage?: string | null;
  recipient?: {
    impact?: string | null;
    cta_heading?: string | null;
    cta_text?: string | null;
    recurring_label?: string | null;
    organization_label?: string | null;
    organization_logo?: Image | null;
    story?: Chapter[] | null;
    organization?: {
      name: string;
      subtitle?: string | null;
      oneliner?: string | null;
      logo?: Image | null;
      page?: string | null;
    } | null;
  } | null;
};

/** Squares in the unit chart; with more units each square stands for several */
const MAX_SQUARES = 100;
/** Set on <html> while the story is open: full-screen slides snap into place */
const SNAP_CLASS = "gift-snap";

export const fillImpact = (template: string, units: number, unit: string) =>
  template.replace(/\{units\}/g, String(units)).replace(/\{unit\}/g, unit);

/** "Over 400 000" → ["Over ", 400000, ""], so the number part can count up; null without one */
export const splitNumber = (text: string): [string, number, string] | null => {
  const match = /(\d[\d\s ]*\d|\d)/.exec(text);
  if (!match) return null;
  const value = Number(match[1].replace(/[\s ]/g, ""));
  if (!Number.isFinite(value)) return null;
  return [text.slice(0, match.index), value, text.slice(match.index + match[1].length)];
};

const formatNumber = (n: number) => n.toLocaleString("nb-NO");

const formatGivenAt = (iso: string) =>
  new Date(iso).toLocaleDateString("nb-NO", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Oslo",
  });

/**
 * The recipient's page (pages/[state]/gave/[code].page.tsx), in the site's own language: black
 * and white, large type, square corners, numbers as charts. Told as full-screen slides that snap
 * into place: an envelope to open, the greeting, the gift counted up
 * as a unit chart, the product's story (pictures, big numbers and bar charts that animate in),
 * who does the work, and a monthly donation to the same organization. Texts and pictures come
 * from the gift card product in Sanity (Recipient page); names and greeting from the purchase.
 * The site menu is not on top, only the logo; it comes after the story, before the footer, as on
 * the 404 page. With reduced motion nothing moves or snaps.
 */
export const GiftPage: React.FC<{
  gift: GiftcardGift | null;
  product: GiftPageProduct | null;
  navigationItems?: NavigationItems | null;
}> = ({ gift, product, navigationItems }) => (
  <main className={styles.page}>
    <SEO
      title="En gave til deg"
      description="Noen har gitt deg en gave."
      siteName="Gi Effektivt"
      noIndex
    />
    <header className={styles.header}>
      <Link href="/" aria-label="Gi Effektivt">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo.src} alt="Gi Effektivt." />
      </Link>
    </header>
    {gift ? (
      <Gift gift={gift} product={product} />
    ) : (
      <section className={styles.unavailable}>
        <h2>Gaven din er trygt på plass.</h2>
        <p className="inngress">Vi får ikke vist den akkurat nå. Prøv igjen om litt.</p>
      </section>
    )}
    {navigationItems && navigationItems.length > 0 && (
      <nav className={styles.menu} aria-label="Meny">
        <SiteMenuTable navigationItems={navigationItems} />
      </nav>
    )}
  </main>
);

const Gift: React.FC<{ gift: GiftcardGift; product: GiftPageProduct | null }> = ({
  gift,
  product,
}) => {
  const [opened, setOpened] = useState(false);
  const noMotion = useNoMotion();
  const unit = gift.units === 1 ? gift.unitSingular : gift.unitPlural;
  const recipient = product?.recipient;
  const impact = recipient?.impact
    ? fillImpact(recipient.impact, gift.units, unit)
    : `${gift.units} ${unit}`;
  const story: Chapter[] =
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

  useEffect(() => {
    if (!opened || noMotion) return;
    const root = document.documentElement;
    root.classList.add(SNAP_CLASS);
    return () => root.classList.remove(SNAP_CLASS);
  }, [opened, noMotion]);

  const greetingRef = useRef<HTMLElement | null>(null);
  const open = () => {
    setOpened(true);
    // Let the envelope open before moving on to the greeting
    window.setTimeout(
      () => greetingRef.current?.scrollIntoView({ behavior: noMotion ? "auto" : "smooth" }),
      noMotion ? 0 : 1100,
    );
  };

  return (
    <>
      <section className={`${styles.slide} ${styles.hero}`} data-opened={opened}>
        <span className="detailheader">Til {gift.recipientName}</span>
        <h1 className={`${styles.display} ${styles.heroTitle}`}>
          {gift.senderName} har gitt deg en gave
        </h1>

        <button
          type="button"
          className={styles.envelope}
          onClick={open}
          disabled={opened}
          aria-label={opened ? "Gaven er åpnet" : "Åpne gaven"}
        >
          <span className={styles.letter} aria-hidden>
            <span />
            <span />
            <span />
          </span>
          <span className={styles.pocket} aria-hidden />
          <span className={styles.flap} aria-hidden />
          <span className={styles.seal} aria-hidden />
        </button>
        <div className={styles.openButton} data-hidden={opened}>
          <EffektButton onClick={open} tabIndex={opened ? -1 : 0}>
            Åpne gaven
          </EffektButton>
        </div>
        {opened && <Confetti />}
      </section>

      {opened && (
        <>
          <Slide className={styles.greeting} innerRef={greetingRef}>
            <div className={styles.card}>
              <span className="detailheader">{formatGivenAt(gift.givenAt)}</span>
              <p className={styles.cardTo}>Kjære {gift.recipientName},</p>
              <p className={styles.cardMessage}>
                {gift.message ||
                  "Jeg har gitt en gave til både deg og noen av dem som trenger det mest."}
              </p>
              <p className={styles.cardFrom}>Hilsen {gift.senderName}</p>
            </div>
            <span className={`detailheader ${styles.scrollHint}`}>Se hva gaven gjør ↓</span>
          </Slide>

          <Impact units={gift.units} unit={unit} unitSingular={gift.unitSingular} impact={impact} />

          {story.map((chapter, i) => (
            <StoryChapter
              key={chapter._key}
              chapter={chapter}
              // Alternate black and white; the map (black countries) always sits on white
              dark={i % 2 === 1 && !chapter.map?.countries?.length}
            />
          ))}

          {recipient?.organization && (
            <Slide className={styles.organization}>
              <div className={styles.split}>
                <div>
                  <span className="detailheader">Arbeidet gjøres av</span>
                  {(recipient.organization_logo ?? recipient.organization.logo)?.asset ? (
                    <div className={styles.logo}>
                      <ResponsiveImage
                        image={(recipient.organization_logo ?? recipient.organization.logo)!}
                        alt={recipient.organization.name}
                        layout="responsive"
                      />
                    </div>
                  ) : (
                    <h2>{recipient.organization.name}</h2>
                  )}
                </div>
                {(recipient.organization.subtitle || recipient.organization.oneliner) && (
                  <p className={styles.lead}>
                    {recipient.organization.subtitle || recipient.organization.oneliner}
                  </p>
                )}
              </div>
            </Slide>
          )}

          <Closing gift={gift} product={product} />
        </>
      )}
    </>
  );
};

/** One full-screen slide that fades in when it is reached */
const Slide: React.FC<{
  className?: string;
  dark?: boolean;
  innerRef?: React.MutableRefObject<HTMLElement | null>;
  children: React.ReactNode | ((visible: boolean) => React.ReactNode);
}> = ({ className, dark, innerRef, children }) => {
  const [revealRef, visible] = useReveal<HTMLElement>(0.15);
  const setRef = (el: HTMLElement | null) => {
    revealRef.current = el;
    if (innerRef) innerRef.current = el;
  };
  return (
    <section
      ref={setRef}
      className={`${styles.slide} ${styles.reveal} ${className ?? ""}`}
      data-visible={visible}
      data-dark={dark ?? false}
    >
      {typeof children === "function" ? children(visible) : children}
    </section>
  );
};

const Impact: React.FC<{
  units: number;
  unit: string;
  unitSingular: string;
  impact: string;
}> = ({ units, unit, unitSingular, impact }) => {
  const perSquare = Math.max(1, Math.ceil(units / MAX_SQUARES));
  const squares = Math.ceil(units / perSquare);
  return (
    <Slide className={styles.impact} dark>
      {(visible: boolean) => (
        <div className={styles.split}>
          <div>
            <span className="detailheader">Gaven din</span>
            <Counter to={units} start={visible} unit={unit} />
          </div>
          <div>
            <div className={styles.chart} aria-hidden>
              <div className={styles.squares}>
                {Array.from({ length: squares }, (_, i) => (
                  <span
                    key={i}
                    className={styles.square}
                    style={{ animationDelay: `${300 + Math.min(i, 40) * 60}ms` }}
                  />
                ))}
              </div>
              <span className="caption">
                1 rute = {perSquare === 1 ? `1 ${unitSingular}` : `${perSquare} ${unit}`}
              </span>
            </div>
            <p className={styles.lead}>Gaven {impact}.</p>
          </div>
        </div>
      )}
    </Slide>
  );
};

const Counter: React.FC<{ to: number; start: boolean; unit: string }> = ({ to, start, unit }) => {
  const count = useCountUp(to, start);
  return (
    <p className={styles.counter} aria-label={`${to} ${unit}`}>
      <span className={styles.counterNumber}>{formatNumber(count)}</span>
      <span className={styles.counterUnit}>{unit}</span>
    </p>
  );
};

const StoryChapter: React.FC<{
  chapter: Chapter;
  dark: boolean;
}> = ({ chapter, dark }) => {
  const hasImage = !!chapter.image?.asset;
  const hasChart = !!chapter.chart?.bars?.length;
  // Without a picture, a square chart or map sits beside the text, or else a big number does:
  // two columns on wide screens, stacked on narrow ones
  const visual = !hasImage && (chapter.waffle?.share != null || !!chapter.map?.countries?.length);
  const statBeside = !hasImage && !visual && !hasChart && !!chapter.stat?.value;

  return (
    <Slide
      className={[
        styles.chapter,
        hasImage ? styles.withImage : "",
        hasChart ? styles.withChart : "",
      ].join(" ")}
      dark={dark}
    >
      {(visible: boolean) => {
        const title = chapter.heading && <h2 className={styles.chapterTitle}>{chapter.heading}</h2>;
        const body = chapter.text && <p className={styles.chapterBody}>{chapter.text}</p>;
        const stat = chapter.stat?.value && (
          <Stat
            value={chapter.stat.value}
            label={chapter.stat.label}
            start={visible}
            large={statBeside}
          />
        );

        if (visual || statBeside) {
          return (
            <div className={styles.split}>
              {visual ? (
                <div className={styles.chapterVisual}>
                  {chapter.waffle && <Waffle data={chapter.waffle} start={visible} />}
                  {chapter.map?.countries && (
                    <StoryMap
                      countries={chapter.map.countries}
                      caption={chapter.map.caption}
                      start={visible}
                    />
                  )}
                </div>
              ) : (
                <div>
                  {title}
                  {body}
                </div>
              )}
              {visual ? (
                <div>
                  {title}
                  {stat}
                  {body}
                </div>
              ) : (
                <div>{stat}</div>
              )}
            </div>
          );
        }

        return (
          <>
            {hasImage && (
              <div className={styles.chapterImage}>
                <ResponsiveImage
                  image={chapter.image!}
                  alt={chapter.image!.alt ?? ""}
                  layout="cover"
                  sizes="(min-width: 1181px) 50vw, 100vw"
                />
              </div>
            )}
            <div className={styles.chapterText}>
              {title}
              {stat}
              {hasChart && <BarChart chart={chapter.chart!} start={visible} />}
              {body}
            </div>
          </>
        );
      }}
    </Slide>
  );
};

/** A big number that counts up over a rule that draws itself */
const Stat: React.FC<{
  value: string;
  label?: string | null;
  start: boolean;
  /** Alone in its column: larger, and may break between words (never inside the number) */
  large?: boolean;
}> = ({ value, label, start, large }) => {
  const parts = splitNumber(value);
  const count = useCountUp(parts?.[1] ?? 0, start, 1400);
  return (
    <div className={`${styles.stat} ${large ? styles.statLarge : ""}`} data-visible={start}>
      <span className={styles.statValue} aria-label={value}>
        {parts ? (
          <>
            {parts[0]}
            {/* The number keeps its unit: "Over / 400 000", never "Rundt 70 / kr" */}
            <span className={styles.statNumber}>
              {formatNumber(count)}
              {parts[2]}
            </span>
          </>
        ) : (
          value
        )}
      </span>
      <span className={styles.statRule} aria-hidden />
      {label && <span className="caption">{label}</span>}
    </div>
  );
};

/** Bars that grow from the axis one after another; highlighted bars are filled */
const BarChart: React.FC<{ chart: ChartData; start: boolean }> = ({ chart, start }) => {
  const bars = (chart.bars ?? []).filter((b) => typeof b.value === "number");
  const max = Math.max(...bars.map((b) => b.value ?? 0), 1);
  return (
    <figure className={styles.barChart} data-visible={start}>
      {chart.title && <figcaption className="caption">{chart.title}</figcaption>}
      <div className={styles.bars} role="img" aria-label={chart.title ?? undefined}>
        {bars.map((bar, i) => (
          <div key={bar._key} className={styles.barColumn}>
            <div className={styles.barTrack}>
              <span
                className={styles.bar}
                data-highlight={bar.highlight ?? false}
                style={{
                  height: `${((bar.value ?? 0) / max) * 100}%`,
                  transitionDelay: `${150 + i * 70}ms`,
                }}
              />
            </div>
            <span className={styles.barLabel}>{bar.label}</span>
          </div>
        ))}
      </div>
      {(chart.highlight_label || chart.caption) && (
        <div className={styles.legend}>
          {chart.highlight_label && (
            <span className="caption">
              <span className={styles.legendSwatch} aria-hidden /> {chart.highlight_label}
            </span>
          )}
          {chart.caption && <span className="caption">{chart.caption}</span>}
        </div>
      )}
    </figure>
  );
};

/** Next steps: give to the same organization every month (the donation widget), or read more */
const Closing: React.FC<{
  gift: GiftcardGift;
  product: GiftPageProduct | null;
}> = ({ gift, product }) => {
  const [, setWidgetContext] = useContext(WidgetContext);
  const recipient = product?.recipient;
  const organizationPage = recipient?.organization?.page;
  return (
    <Slide className={styles.closing} dark>
      <div className={styles.split}>
        <h2 className={styles.display}>{recipient?.cta_heading || "Vil du gjøre enda mer?"}</h2>
        <div>
          {recipient?.cta_text && <p className={styles.lead}>{recipient.cta_text}</p>}
          <div className={styles.buttons}>
            <EffektButton
              variant={EffektButtonVariant.SECONDARY}
              onClick={() =>
                setWidgetContext({
                  open: true,
                  prefilled: [
                    {
                      causeAreaId: gift.causeAreaId,
                      share: 100,
                      organizations: [{ organizationId: gift.organizationId, share: 100 }],
                    },
                  ],
                  prefilledSum: null,
                  prefilledRecurring: RecurringDonation.RECURRING,
                })
              }
            >
              {recipient?.recurring_label || "Sett opp fast donasjon"}
            </EffektButton>
            {organizationPage && (
              <Link className={styles.textLink} href={`/${organizationPage}`}>
                {recipient?.organization_label || "Les mer om organisasjonen"} →
              </Link>
            )}
          </div>
        </div>
      </div>
    </Slide>
  );
};

/** A short burst of black and white squares when the envelope opens (none with reduced motion) */
const Confetti: React.FC = () => {
  const [pieces] = useState(() =>
    Array.from({ length: 26 }, () => ({
      left: 50 + (Math.random() - 0.5) * 70,
      delay: Math.random() * 250,
      drift: (Math.random() - 0.5) * 240,
      rotate: Math.random() * 540 - 270,
      size: 6 + Math.round(Math.random() * 6),
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
          style={
            {
              left: `${p.left}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
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
