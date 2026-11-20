import type { GiftcardGift } from "@effekt/api/giftcard";

/**
 * Demo gift cards for showing the recipient page (/gave/<code>) on Vercel previews and locally,
 * where the API has no gift cards to look up. The names and greetings are made up. Production
 * never serves them: only the API's paid gift cards are shown there.
 */
const DEMO_GIFTS: Record<string, GiftcardGift> = {
  // Malaria medicine (Malaria Consortium)
  dmgvmdsnrb: {
    product: "malaria",
    units: 3,
    unitSingular: "barn",
    unitPlural: "barn",
    recipientName: "Kari",
    senderName: "Ola",
    message:
      "God jul, Kari! I år ville jeg gi deg noe som varer litt lenger enn sokker. Takk for at du alltid stiller opp ❤️",
    givenAt: "2026-12-24T15:00:00.000Z",
  },
  // Mosquito nets (Against Malaria Foundation)
  dmgvmggntt: {
    product: "myggnett",
    units: 5,
    unitSingular: "myggnett",
    unitPlural: "myggnett",
    recipientName: "Ingrid",
    senderName: "Mormor",
    message: "God jul, vennen! Fem myggnett, ett for hver av dere barnebarn ❤️",
    givenAt: "2026-12-24T15:00:00.000Z",
  },
  // Vitamin A (Helen Keller Intl)
  dmgvvtmnbr: {
    product: "a-vitamin",
    units: 10,
    unitSingular: "barn",
    unitPlural: "barn",
    recipientName: "Jonas",
    senderName: "Sofie",
    message: "Til verdens beste bror. Denne gaven ser lenger enn deg 😄 God jul!",
    givenAt: "2026-12-24T15:00:00.000Z",
  },
  // Vaccines (New Incentives)
  dmgvvksnbr: {
    product: "vaksine",
    units: 2,
    unitSingular: "barn",
    unitPlural: "barn",
    recipientName: "Marte",
    senderName: "Teamet på jobben",
    message: "Takk for et fantastisk år! Hilsen alle oss på kontoret 🎄",
    givenAt: "2026-12-24T15:00:00.000Z",
  },
};

export const DEMO_GIFT_CODES = Object.keys(DEMO_GIFTS);

/**
 * The demo gift card with this code on Vercel previews and in local development, else null.
 * `vercelEnv` is VERCEL_ENV ("production", "preview", "development", or unset off Vercel) and
 * `nodeEnv` NODE_ENV. Allow-listed rather than "not production", so a production build run outside
 * Vercel (VERCEL_ENV unset) never serves them either.
 */
export const getDemoGift = (
  code: string,
  vercelEnv: string | undefined,
  nodeEnv: string | undefined,
): GiftcardGift | null => {
  const demosAllowed =
    vercelEnv === "preview" ||
    vercelEnv === "development" ||
    (vercelEnv === undefined && nodeEnv !== "production");
  return demosAllowed && Object.hasOwn(DEMO_GIFTS, code) ? DEMO_GIFTS[code] : null;
};
