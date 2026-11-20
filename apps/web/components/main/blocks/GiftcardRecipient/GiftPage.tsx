import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
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
    /** Stacked on top, outlined and hatched: e.g. "if there had been no malaria control" */
    extra?: number | null;
    highlight?: boolean | null;
  }> | null;
  highlight_label?: string | null;
  extra_label?: string | null;
  /** Bars lying down, label on the left and value at the end: for a few bars compared */
  horizontal?: boolean | null;
  /** A y-axis with a few round values (short format, e.g. "1,5 mill"), left of the chart */
  axis?: boolean | null;
  /** Big numbers beside the chart, counted up after the bars, e.g. "+99 %" */
  callouts?: Array<{ _key: string; value?: string | null; label?: string | null }> | null;
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

/** Words with a hyphen ("A-vitamin") never break at it: a non-breaking hyphen between letters */
export const keepHyphenated = (text: string) =>
  text.replace(/([A-Za-zÀ-ÿ])-([A-Za-zÀ-ÿ])/g, "$1\u2011$2");

/**
 * "Over 400 000" → ["Over ", 400000, "", 0] and "2,1 millioner" → ["", 2.1, " millioner", 1], so
 * the number part can count up with its decimals; null without a number. Spaces (incl. no-break)
 * group thousands; a comma or point followed by digits is the decimal mark.
 */
export const splitNumber = (text: string): [string, number, string, number] | null => {
  const match = /(\d(?:[\d\s\u00a0]*\d)?)(?:[,.](\d+))?/.exec(text);
  if (!match) return null;
  const whole = match[1].replace(/[\s\u00a0]/g, "");
  const decimals = match[2]?.length ?? 0;
  const value = Number(decimals ? `${whole}.${match[2]}` : whole);
  if (!Number.isFinite(value)) return null;
  return [text.slice(0, match.index), value, text.slice(match.index + match[0].length), decimals];
};

/** Norwegian number format with a fixed number of decimals: 400 000, 2,1 */
export const formatNumber = (n: number, decimals = 0) =>
  n.toLocaleString("nb-NO", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

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
 * who does the work, and a monthly donation to Smart fordeling. Texts and pictures come
 * from the gift card product in Sanity (Recipient page); names and greeting from the purchase.
 * The site menu is not on top, only the logo; it comes after the story, before the footer, as on
 * the 404 page. With reduced motion nothing moves or snaps.
 */
export const GiftPage: React.FC<{
  gift: GiftcardGift | null;
  product: GiftPageProduct | null;
  navigationItems?: NavigationItems | null;
  siteLogo?: SanityImageObject | null;
}> = ({ gift, product, navigationItems, siteLogo }) => (
  <main className={styles.page}>
    <SEO
      title="En gave til deg"
      description="Noen har gitt deg en gave."
      siteName="Gi Effektivt"
      noIndex
    />
    <header className={styles.header}>
      <Link href="/" aria-label="Gi Effektivt" className={styles.headerLogo}>
        <SiteLogo image={siteLogo} priority />
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
        <Link href="/" className={styles.menuLogo} aria-label="Gi Effektivt">
          <SiteLogo image={siteLogo} />
        </Link>
        <SiteMenuTable navigationItems={navigationItems} />
      </nav>
    )}
  </main>
);

/** The site's logo from the site settings; the bundled wordmark if there is none */
const SiteLogo: React.FC<{ image?: SanityImageObject | null; priority?: boolean }> = ({
  image,
  priority,
}) =>
  image?.asset ? (
    <ResponsiveImage
      priority={priority}
      image={image}
      alt="Gi Effektivt."
      layout="responsive"
      sizes="260px"
    />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logo.src} alt="Gi Effektivt." />
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
  const openTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(openTimer.current), []);
  const open = () => {
    if (opened) return;
    setOpened(true);
    // Let the envelope open before moving on to the greeting. Focus moves there too: the
    // envelope button that had it is disabled now
    openTimer.current = window.setTimeout(
      () => {
        const greeting = greetingRef.current;
        if (!greeting) return;
        greeting.scrollIntoView({ behavior: noMotion ? "auto" : "smooth" });
        greeting.focus({ preventScroll: true });
      },
      noMotion ? 0 : 1100,
    );
  };

  return (
    <>
      <section className={`${styles.slide} ${styles.hero}`} data-opened={opened}>
        <span className="detailheader">Til {gift.recipientName}</span>
        <h1 className={`${styles.display} ${styles.heroTitle}`}>Du har fått en gave</h1>
        <p className={`${styles.lead} ${styles.heroFrom}`}>fra {gift.senderName}</p>

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
          <Slide className={styles.greeting} innerRef={greetingRef} focusable>
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

          <Impact units={gift.units} unit={unit} impact={impact} />

          {story.map((chapter, i) => (
            <StoryChapter
              key={chapter._key}
              chapter={chapter}
              // Alternate black and white; the map (black countries) always sits on white
              dark={i % 2 === 1 && mapCountries(chapter.map?.countries).length === 0}
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
                        priority
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

          <Closing product={product} />
        </>
      )}
    </>
  );
};

/** A map's country codes: trimmed, lower case as the map's ids, without blanks and duplicates (Sanity data) */
const mapCountries = (countries?: string[] | null): string[] =>
  Array.from(
    new Set(
      (countries ?? [])
        .filter((c): c is string => typeof c === "string")
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean),
    ),
  );

/** A bar's value from Sanity: a finite number, never below 0 */
export const barValue = (n?: number | null): number =>
  typeof n === "number" && Number.isFinite(n) ? Math.max(0, n) : 0;

/** One full-screen slide that fades in when it is reached */
const Slide: React.FC<{
  className?: string;
  dark?: boolean;
  innerRef?: React.MutableRefObject<HTMLElement | null>;
  /** Can take focus from script (not by tabbing), e.g. the greeting after opening */
  focusable?: boolean;
  children: React.ReactNode | ((visible: boolean) => React.ReactNode);
}> = ({ className, dark, innerRef, focusable, children }) => {
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
      tabIndex={focusable ? -1 : undefined}
    >
      {typeof children === "function" ? children(visible) : children}
    </section>
  );
};

const Impact: React.FC<{
  units: number;
  unit: string;
  impact: string;
}> = ({ units, unit, impact }) => {
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
              {/* One square per unit needs no key; only say it when a square stands for several */}
              {perSquare > 1 && (
                <span className={styles.statLabel}>
                  1 rute = {perSquare} {unit}
                </span>
              )}
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
  const hasWaffle = Number.isFinite(chapter.waffle?.share);
  // Stable between renders: StoryMap restarts its timers when the list changes
  const mapCodes = chapter.map?.countries;
  const countries = useMemo(() => mapCountries(mapCodes), [mapCodes]);
  const visual = !hasImage && (hasWaffle || countries.length > 0);
  const statBeside = !hasImage && !visual && !hasChart && !!chapter.stat?.value;
  // A small chart (no big numbers of its own) sits beside the text the same way
  const chartBeside = !hasImage && hasChart && !chapter.chart?.callouts?.length;

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
        const title = chapter.heading && (
          <h2 className={styles.chapterTitle}>{keepHyphenated(chapter.heading)}</h2>
        );
        const body = chapter.text && <p className={styles.chapterBody}>{chapter.text}</p>;
        const stat = chapter.stat?.value && (
          <Stat
            value={chapter.stat.value}
            label={chapter.stat.label}
            start={visible}
            large={statBeside}
          />
        );

        if (chartBeside) {
          return (
            <div className={styles.split}>
              <div>
                {title}
                {body}
              </div>
              <div>
                {stat}
                <BarChart chart={chapter.chart!} start={visible} />
              </div>
            </div>
          );
        }

        if (visual || statBeside) {
          return (
            <div className={styles.split}>
              {visual ? (
                <div className={styles.chapterVisual}>
                  {hasWaffle && <Waffle data={chapter.waffle!} start={visible} />}
                  {countries.length > 0 && (
                    <StoryMap
                      countries={countries}
                      caption={chapter.map?.caption}
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
                {/* Loaded at once (they render when the envelope opens), so each picture is
                    ready when its slide snaps into view instead of flashing in */}
                <ResponsiveImage
                  priority
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
  const decimals = parts?.[3] ?? 0;
  const count = useCountUp(parts?.[1] ?? 0, start, 1400, decimals);
  return (
    <div className={`${styles.stat} ${large ? styles.statLarge : ""}`} data-visible={start}>
      <span className={styles.statValue} aria-label={value}>
        {parts ? (
          <>
            {parts[0]}
            {/* The number keeps its unit: "Over / 400 000", never "Rundt 70 / kr" */}
            <span className={styles.statNumber}>
              {formatNumber(count, decimals)}
              {parts[2]}
            </span>
          </>
        ) : (
          value
        )}
      </span>
      <span className={styles.statRule} aria-hidden />
      {label && <span className={styles.statLabel}>{label}</span>}
    </div>
  );
};

/**
 * Bars that grow from the axis one after another; highlighted bars are filled. A bar's `extra`
 * stacks on top, outlined and hatched (what would have been), and grows with it. Callouts (big
 * numbers) count up beside the chart once the bars are done.
 */
const BarChart: React.FC<{ chart: ChartData; start: boolean }> = ({ chart, start }) =>
  chart.horizontal ? (
    <HorizontalBars chart={chart} start={start} />
  ) : (
    <ColumnChart chart={chart} start={start} />
  );

/** A few bars lying down, each growing from the left with its value counting up at its end */
const HorizontalBars: React.FC<{ chart: ChartData; start: boolean }> = ({ chart, start }) => {
  const bars = (chart.bars ?? []).filter((b) => Number.isFinite(b.value));
  const max = Math.max(...bars.map((b) => barValue(b.value)), 1);
  return (
    <figure className={styles.barChart} data-visible={start}>
      {chart.title && <figcaption className={styles.chartTitle}>{chart.title}</figcaption>}
      <div className={styles.hbars} role="img" aria-label={chart.title ?? undefined}>
        {bars.map((bar, i) => (
          <div key={bar._key} className={styles.hbarRow}>
            <span className={styles.hbarLabel}>{bar.label}</span>
            <div className={styles.hbarTrack}>
              <span
                className={styles.hbar}
                data-highlight={bar.highlight ?? false}
                style={{
                  width: `${(barValue(bar.value) / max) * 100}%`,
                  transitionDelay: `${200 + i * 250}ms`,
                }}
              />
              <HBarValue value={barValue(bar.value)} start={start} />
            </div>
          </div>
        ))}
      </div>
      {chart.caption && (
        <div className={styles.legend}>
          <span className={styles.source}>{chart.caption}</span>
        </div>
      )}
    </figure>
  );
};

const HBarValue: React.FC<{ value: number; start: boolean }> = ({ value, start }) => {
  const count = useCountUp(value, start, 1100);
  return <span className={styles.hbarValue}>{formatNumber(count)} %</span>;
};

const ColumnChart: React.FC<{ chart: ChartData; start: boolean }> = ({ chart, start }) => {
  const bars = (chart.bars ?? []).filter((b) => Number.isFinite(b.value));
  const max = Math.max(...bars.map((b) => barValue(b.value) + barValue(b.extra)), 1);
  const stacked = bars.some((b) => barValue(b.extra) > 0);
  const step = Math.min(70, 1200 / Math.max(bars.length, 1));
  const barsDone = 150 + bars.length * step + 900;
  const callouts = (chart.callouts ?? []).filter((c) => c.value);
  const ticks = chart.axis ? axisTicks(max) : [];
  const calloutsStart = useDelayed(start, barsDone);
  return (
    <figure
      className={`${styles.barChart} ${callouts.length ? styles.withCallouts : ""}`}
      data-visible={start}
    >
      {chart.title && <figcaption className={styles.chartTitle}>{chart.title}</figcaption>}
      {/* What the bars mean comes first, larger, before they grow */}
      {(chart.highlight_label || chart.extra_label) && (
        <div className={styles.legendTop}>
          {chart.highlight_label && (
            <span>
              <span className={styles.legendSwatch} aria-hidden /> {chart.highlight_label}
            </span>
          )}
          {chart.extra_label && (
            <span>
              <span className={styles.legendSwatchHatched} aria-hidden /> {chart.extra_label}
            </span>
          )}
        </div>
      )}
      <div className={styles.chartBody}>
        <div
          className={`${styles.bars} ${ticks.length ? styles.withAxis : ""}`}
          role="img"
          aria-label={chart.title ?? undefined}
        >
          {ticks.map((t) => (
            <span key={t} className={styles.tick} style={{ bottom: `${(t / max) * 100}%` }}>
              <span>{formatShort(t)}</span>
            </span>
          ))}
          {bars.map((bar, i) => (
            <div key={bar._key} className={styles.barColumn}>
              <div className={styles.barTrack}>
                {/* One stack per bar, grown from the axis as a whole: the bar and what is
                    stacked on it rise together */}
                <div
                  className={styles.barStack}
                  style={{
                    height: `${((barValue(bar.value) + barValue(bar.extra)) / max) * 100}%`,
                    transitionDelay: `${150 + i * step}ms`,
                  }}
                >
                  {barValue(bar.extra) > 0 && (
                    <span className={styles.barExtra} style={{ flexGrow: barValue(bar.extra) }} />
                  )}
                  <span
                    className={styles.bar}
                    data-highlight={bar.highlight ?? stacked}
                    style={{ flexGrow: barValue(bar.value) }}
                  />
                </div>
              </div>
              <span className={styles.barLabel}>{bar.label}</span>
            </div>
          ))}
        </div>
        {callouts.length > 0 && (
          <div className={styles.callouts}>
            {callouts.map((c) => (
              <Stat key={c._key} value={c.value!} label={c.label} start={calloutsStart} />
            ))}
          </div>
        )}
      </div>
      {chart.caption && (
        <div className={styles.legend}>
          <span className={styles.source}>{chart.caption}</span>
        </div>
      )}
    </figure>
  );
};

/** Round values for a y-axis up to `max`: steps of 1, 2, 2.5 or 5 times a power of ten */
export const axisTicks = (max: number, count = 4): number[] => {
  if (!Number.isFinite(max) || max <= 0) return [];
  const raw = max / count;
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  // Multiplied, not added up, so 0.1 steps don't drift (0.30000000000000004)
  for (let i = 1; i * step <= max * (1 + 1e-9); i++) ticks.push(Number((i * step).toPrecision(12)));
  return ticks;
};

/** Short numbers for an axis, as on the results page: "1,5 mill", "500 000" */
export const formatShort = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toLocaleString("nb-NO", { maximumFractionDigits: 1 })} mill`
    : formatNumber(n);

/** `start`, but only after `delayMs` (immediately with reduced motion) */
function useDelayed(start: boolean, delayMs: number) {
  const noMotion = useNoMotion();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!start || noMotion) return;
    const t = window.setTimeout(() => setDone(true), delayMs);
    return () => window.clearTimeout(t);
  }, [start, noMotion, delayMs]);
  return start && (done || noMotion);
}

/** Next steps: a monthly donation to Smart fordeling (the donation widget), or read about the organization */
const Closing: React.FC<{ product: GiftPageProduct | null }> = ({ product }) => {
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
                // No prefilled distribution: the site's default, Smart fordeling, given monthly
                setWidgetContext({
                  open: true,
                  prefilled: null,
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
