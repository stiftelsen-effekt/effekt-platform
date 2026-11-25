import React, { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/router";
import { useMainLocale } from "../../../../context/MainLocaleContext";
import {
  isProcedureAvailable,
  publicTrpcFor,
  type RouterOutputs,
} from "../../../../lib/trpc/client";
import { giftcardCertificateHref } from "../../../../util/giftcardPaths";
import { fillGiftcardText, formatKroner, formatOsloDateTime } from "./giftcardForm";
import { giftcardSessionKey, type GiftcardReceiptDocument, type GiftcardSession } from "./types";
import styles from "./GiftcardWidget.module.scss";

export type GiftcardStatus = RouterOutputs["giftcard"]["status"];

/**
 * A purchase's details: number of units and price, when the SMS goes and to whom (or the
 * certificate link), and what happens next, from the product's "purchase details" texts.
 */
export const GiftcardPurchaseDetails: React.FC<{
  product: GiftcardReceiptDocument | null;
  status: GiftcardStatus;
  showCertificateLink?: boolean;
}> = ({ product, status, showCertificateLink = true }) => {
  const texts = product?.thank_you;
  const summary = product?.summary_step;
  const slug = product?.slug?.current;
  const sendAt = status.sendAt ? formatOsloDateTime(status.sendAt) : "";

  const body =
    status.status === "pending"
      ? texts?.pending_text
      : status.delivery === "sms"
        ? fillGiftcardText(texts?.sms_text, { dato: sendAt, mottaker: status.recipientName })
        : texts?.pdf_text;

  return (
    <div className={styles.receipt} data-cy="giftcard-receipt">
      <dl className={styles.summary}>
        <div>
          <dt>{summary?.units_label || product?.title}</dt>
          <dd>{status.units}</dd>
        </div>
        <div>
          <dt>{summary?.price_label || "Pris"}</dt>
          <dd>{formatKroner(status.amount)}</dd>
        </div>
        {status.delivery === "sms" ? (
          <div>
            <dt>{summary?.send_label || "Sendes"}</dt>
            <dd>{sendAt}</dd>
          </div>
        ) : (
          <div>
            <dt>{summary?.format_label || "Gavetype"}</dt>
            <dd>{summary?.pdf_format_value || "Gavebevis"}</dd>
          </div>
        )}
      </dl>
      {body && <p data-cy="giftcard-receipt-text">{body}</p>}
      {showCertificateLink && slug && product?.has_certificate && status.delivery === "pdf" && (
        <p>
          <a
            href={giftcardCertificateHref(slug)}
            className={styles.link}
            data-cy="giftcard-certificate-link"
          >
            {texts?.certificate_link_text || "Last ned gavebeviset"} ↓
          </a>
        </p>
      )}
    </div>
  );
};

const noSubscription = () => () => {};
const STATUS_RETRIES = 5;
const STATUS_RETRY_MS = 3000;
const readSession = (kid: string | null): string | null => {
  if (!kid) return null;
  try {
    return sessionStorage.getItem(giftcardSessionKey(kid));
  } catch {
    return null;
  }
};

/**
 * The `giftcardreceipt` block, for the thank-you page after Vipps (?kid=… from the API's
 * redirect). It needs the registration token the purchase block kept in sessionStorage, so it
 * shows nothing in another browser or once the token has expired: the page's own blocks thank.
 */
export const GiftcardReceiptBlock: React.FC<{
  products: GiftcardReceiptDocument[];
  showCertificateLink?: boolean | null;
}> = ({ products, showCertificateLink }) => {
  const router = useRouter();
  const mainLocale = useMainLocale();
  const [status, setStatus] = useState<GiftcardStatus | null>(null);

  const kid = router.isReady && typeof router.query.kid === "string" ? router.query.kid : null;
  const rawSession = useSyncExternalStore(
    noSubscription,
    () => readSession(kid),
    () => null,
  );
  const session = useMemo<GiftcardSession | null>(() => {
    try {
      return rawSession ? JSON.parse(rawSession) : null;
    } catch {
      return null;
    }
  }, [rawSession]);

  useEffect(() => {
    if (!kid || !session?.registrationToken) return;
    if (!isProcedureAvailable(mainLocale, "giftcard.status")) return;
    const registrationToken = session.registrationToken;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Vipps's callback can arrive after the buyer is back: ask again a few times while pending
    const load = (attempt: number) =>
      publicTrpcFor(mainLocale)
        .giftcard.status.query({ KID: kid, registrationToken })
        .then((s) => {
          if (cancelled) return;
          setStatus(s);
          if (s.status === "pending" && attempt < STATUS_RETRIES) {
            timer = setTimeout(() => load(attempt + 1), STATUS_RETRY_MS);
          }
        })
        .catch((err) => console.warn("Could not load the gift card status", err));
    load(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [kid, session?.registrationToken, mainLocale]);

  if (!status) return null;
  const product = products.find((p) => p.slug?.current === status.product) ?? null;
  return (
    <GiftcardPurchaseDetails
      product={product}
      status={status}
      showCertificateLink={showCertificateLink !== false}
    />
  );
};
