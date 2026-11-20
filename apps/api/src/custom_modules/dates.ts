/**
 * Small date helpers shared by receipts, report parsers and route validation. Formatting uses the
 * process time zone, like `new Date().getDate()` does.
 */
import { DateTime } from "luxon";

/** "DD.MM.YYYY" in the process time zone, as on receipts */
export const formatNorwegianDate = (date: Date): string =>
  DateTime.fromJSDate(date).toFormat("dd.MM.yyyy");

/** "HH:mm - DD.MM.YYYY" in the process time zone */
export const formatNorwegianTimestamp = (date: Date): string =>
  DateTime.fromJSDate(date).toFormat("HH:mm - dd.MM.yyyy");

/** "YYYY-MM-DD" in the process time zone */
export const formatIsoDay = (date: Date): string =>
  DateTime.fromJSDate(date).toFormat("yyyy-MM-dd");

/**
 * Whether a request value is an ISO 8601 date or date-time string. Like moment's strict ISO_8601
 * parsing (used here before), a space may separate the date and the time.
 */
export const isIso8601 = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  if (DateTime.fromISO(value).isValid) return true;
  return /^\S+ \S+$/.test(value) && DateTime.fromISO(value.replace(" ", "T")).isValid;
};

/** Whether a value is exactly a DD.MM.YYYY date, like bank exports use */
export const isNorwegianDate = (value: unknown): boolean =>
  typeof value === "string" && DateTime.fromFormat(value, "dd.MM.yyyy").isValid;

const LENIENT_NORWEGIAN_DATE = /^\D*(\d{1,2})\D+(\d{1,2})\D+(\d{4})/;

/**
 * Parses a DD.MM.YYYY date (bank and legacy Vipps exports) to midnight UTC. Lenient: leading
 * whitespace, one- or two-digit day and month, any separator and trailing text (like a time) are
 * accepted. The year must have four digits. The result may be invalid; check isValid.
 */
export const parseNorwegianDate = (value: unknown): DateTime => {
  const match = typeof value === "string" ? LENIENT_NORWEGIAN_DATE.exec(value) : null;
  if (!match) return DateTime.invalid("not a DD.MM.YYYY date");
  const [, day, month, year] = match;
  return DateTime.utc(Number(year), Number(month), Number(day));
};
