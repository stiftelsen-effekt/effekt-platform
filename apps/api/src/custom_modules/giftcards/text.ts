/**
 * Pure helpers for gift cards: phone numbers and the SMS text. No database or network.
 */

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
] as const;

export function renderGiftcardSms(template: string, values: GiftcardSmsValues): string {
  const message = values.message?.trim() || "";
  const replacements: Record<string, string> = {
    "{recipientName}": values.recipientName.trim(),
    "{senderName}": values.senderName.trim(),
    "{message}": message,
    "{units}": String(values.units),
    "{unit}": values.units === 1 ? values.unitSingular : values.unitPlural,
  };
  const lines = template
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !(line.trim() === "{message}" && message === ""));
  return lines
    .join("\n")
    .replace(/\{(recipientName|senderName|message|units|unit)\}/g, (p) => replacements[p])
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
