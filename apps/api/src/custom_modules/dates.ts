/**
 * Small date helpers shared by receipts, report parsers and route validation. Formatting uses the
 * process time zone, like `new Date().getDate()` does.
 */
import moment from "moment";

/** "DD.MM.YYYY" in the process time zone, as on receipts */
export const formatNorwegianDate = (date: Date): string => moment(date).format("DD.MM.YYYY");

/** "HH:mm - DD.MM.YYYY" in the process time zone */
export const formatNorwegianTimestamp = (date: Date): string =>
  moment(date).format("HH:mm - DD.MM.YYYY");

/** "YYYY-MM-DD" in the process time zone */
export const formatIsoDay = (date: Date): string => moment(date).format("YYYY-MM-DD");

/** Whether a request value is an ISO 8601 date or date-time string */
export const isIso8601 = (value: unknown): boolean =>
  moment(value as any, moment.ISO_8601, true).isValid();

/** Whether a value is exactly a DD.MM.YYYY date, like bank exports use */
export const isNorwegianDate = (value: unknown): boolean =>
  moment.utc(value as any, "DD.MM.YYYY", true).isValid();

/**
 * Parses a DD.MM.YYYY date (bank and legacy Vipps exports) to midnight UTC. Lenient: leading
 * whitespace, one- or two-digit day and month, any separator and trailing text (like a time) are
 * accepted. The result may be invalid; check isValid.
 */
export const parseNorwegianDate = (value: unknown) => moment.utc(value as any, "DD.MM.YYYY");
