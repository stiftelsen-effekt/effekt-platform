import { randomInt } from "node:crypto";

/**
 * Pure helpers for gift cards: phone numbers, recipient codes and the SMS text. No database or
 * network.
 */

/**
 * The recipient's code: 10 lower case consonants (no vowels, so it never spells a word, and no l,
 * which looks like 1 and I), e.g. "kxbmtrwpzd". 19^10 is about 6·10^12 (42 bits), so codes can't
 * be guessed. Lower case only: the column's collation ignores case.
 */
const CODE_ALPHABET = "bcdfghjkmnpqrstvwxz";
export const GIFTCARD_CODE_LENGTH = 10;
export const GIFTCARD_CODE_PATTERN = /^[bcdfghjkmnpqrstvwxz]{10}$/;

export function generateGiftcardCode(): string {
  let code = "";
  for (let i = 0; i < GIFTCARD_CODE_LENGTH; i++)
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/**
 * The recipient's link without "https://" (phones make it clickable, and it is 8 characters
 * shorter): gieffektivt.no/gave/<code>. Other schemes (http://localhost in development) are kept.
 */
export function giftcardLink(frontendUrl: string | undefined, code: string): string {
  const base = (frontendUrl || "https://gieffektivt.no")
    .replace(/\/+$/, "")
    .replace(/^https:\/\//, "");
  return `${base}/gave/${code}`;
}

/**
 * A Norwegian mobile number (8 digits starting with 4 or 9, optionally +47/0047 first, spaces
 * allowed) as E.164 (+4791234567), or null. Only Norwegian mobiles get SMS for now.
 */
export function normalizeNorwegianMobile(input: string): string | null {
  const compact = input.replace(/[\s\-().]/g, "");
  const match = /^(?:\+47|0047)?([49]\d{7})$/.exec(compact);
  return match ? `+47${match[1]}` : null;
}

export type GiftcardSmsValues = {
  recipientName: string;
  senderName: string;
  message: string | null;
  units: number;
  unitSingular: string;
  unitPlural: string;
  /** The recipient's page (giftcardLink) */
  link: string;
};

/**
 * Placeholders a product's Sms_template may use. A line whose only content is {message} is
 * left out when there is no greeting.
 */
export const GIFTCARD_SMS_PLACEHOLDERS = [
  "{recipientName}",
  "{senderName}",
  "{message}",
  "{units}",
  "{unit}",
  "{link}",
] as const;

export function renderGiftcardSms(template: string, values: GiftcardSmsValues): string {
  const message = values.message?.trim() || "";
  const replacements: Record<string, string> = {
    "{recipientName}": values.recipientName.trim(),
    "{senderName}": values.senderName.trim(),
    "{message}": message,
    "{units}": String(values.units),
    "{unit}": values.units === 1 ? values.unitSingular : values.unitPlural,
    "{link}": values.link,
  };
  const lines = template
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !(line.trim() === "{message}" && message === ""));
  return lines
    .join("\n")
    .replace(/\{(recipientName|senderName|message|units|unit|link)\}/g, (p) => replacements[p])
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
