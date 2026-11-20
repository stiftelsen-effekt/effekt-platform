/**
 * Gift card paths outside Sanity's pages. The gift card pages are generic pages with the
 * `giftcardwidget` block (and /gavekort-mottatt, where the API sends buyers back from Vipps, one
 * with the `giftcardreceipt` block). /gavekort/<slug>/gavebevis redirects to the product's self-fill
 * certificate PDF; the receipt e-mails link there.
 */
export const GIFTCARD_PATH = "gavekort";
export const GIFTCARD_CERTIFICATE_SEGMENT = "gavebevis";

export const giftcardCertificateHref = (slug: string) =>
  `/${GIFTCARD_PATH}/${slug}/${GIFTCARD_CERTIFICATE_SEGMENT}`;

/** The product slug of a /gavekort/<slug>/gavebevis path, or null */
export const parseGiftcardCertificatePath = (path: string[]): string | null =>
  path.length === 3 &&
  path[0] === GIFTCARD_PATH &&
  path[2] === GIFTCARD_CERTIFICATE_SEGMENT &&
  /^[a-z0-9-]{1,64}$/.test(path[1])
    ? path[1]
    : null;

/** The recipient's page: /gave/<code>, the link in the gift card SMS */
export const GIFT_PATH = "gave";

/** A recipient code as the API makes them (giftcards/text.ts): 10 lower case consonants */
export const isGiftCode = (code: string) => /^[bcdfghjkmnpqrstvwxz]{10}$/.test(code);
