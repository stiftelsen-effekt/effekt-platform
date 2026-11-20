import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { getDueDates } from "../custom_modules/avtalegiro";
import { getDeletionDeadline, getEffectiveDueDate } from "../custom_modules/avtalegiro/charges";
import { generateCsv } from "../custom_modules/csvexport";
import { osloDayEnd, osloDayStart } from "../custom_modules/osloDays";
import { toIso } from "../custom_modules/reviewQueue";

const writer = require("../custom_modules/avtalegiro/filewriterutil");

/**
 * Pins how the API's date logic behaves, so a luxon upgrade can't change charge dates, claim
 * dates, due months, tax years or Oslo time handling unnoticed. The cases are DST changes
 * (29 March and 25 October 2026), month ends, leap days and year ends. Every input names its zone,
 * so the results don't depend on the machine's time zone.
 */
const OSLO = "Europe/Oslo";
const oslo = (iso: string) => DateTime.fromISO(iso, { zone: OSLO });
const utc = (iso: string) => DateTime.fromISO(iso, { zone: "utc" });

describe("luxon characterization", () => {
  describe("parsing", () => {
    it("parses ISO dates and date-times in a zone", () => {
      expect(oslo("2026-03-29").toISO()).toBe("2026-03-29T00:00:00.000+01:00");
      expect(oslo("2026-03-29T02:30").toISO()).toBe("2026-03-29T03:30:00.000+02:00");
      // 02:30 happens twice on 25 October; the later (winter time) one is taken
      expect(oslo("2026-10-25T02:30").toISO()).toBe("2026-10-25T02:30:00.000+01:00");
      expect(oslo("2026-10-25T01:30:00Z").toISO()).toBe("2026-10-25T02:30:00.000+01:00");
      expect(oslo("2026-12-31T23:30:00+00:00").toISO()).toBe("2027-01-01T00:30:00.000+01:00");
    });

    it("marks impossible or malformed ISO input invalid rather than throwing", () => {
      for (const input of [
        "2026-02-29",
        "2026-02-30",
        "2026-13-01",
        "",
        "31.12.2026",
        "2026-1-1",
      ]) {
        const dt = oslo(input);
        expect(dt.isValid, input).toBe(false);
        expect(dt.toISO(), input).toBe(null);
        expect(dt.toISODate(), input).toBe(null);
      }
      expect(oslo("2024-02-29").isValid).toBe(true);
      expect(oslo("2026-02-30").invalidReason).toBe("unit out of range");
    });

    it("parses SQL and fixed formats", () => {
      expect(DateTime.fromSQL("2026-10-25 02:30:00", { zone: OSLO }).toISO()).toBe(
        "2026-10-25T02:30:00.000+01:00",
      );
      expect(DateTime.fromSQL("2026-10-25", { zone: OSLO }).toISO()).toBe(
        "2026-10-25T00:00:00.000+02:00",
      );
      expect(DateTime.fromFormat("31.12.2026", "dd.MM.yyyy", { zone: OSLO }).toISODate()).toBe(
        "2026-12-31",
      );
      expect(DateTime.fromFormat("29.02.2026", "dd.MM.yyyy").isValid).toBe(false);
      expect(DateTime.fromFormat("20240229", "yyyyMMdd", { zone: OSLO }).toISODate()).toBe(
        "2024-02-29",
      );
      expect(DateTime.fromFormat("2024-02-29", "yyyyMMdd").isValid).toBe(false);
    });

    it("treats an unknown zone name as an invalid date", () => {
      const dt = DateTime.fromSQL("2026-10-24 14:05:00", { zone: "no-NB" });
      expect(dt.isValid).toBe(false);
      expect(dt.invalidReason).toBe("unsupported zone");
    });

    it("builds local dates from positional parts, marking impossible days invalid", () => {
      expect(DateTime.local(2026, 1, 31).isValid).toBe(true);
      expect(DateTime.local(2026, 2, 31).isValid).toBe(false);
      expect(DateTime.local(2026, 2, 0).isValid).toBe(false);
      expect(DateTime.local(2026, 2, 31).plus({ month: 1 }).isValid).toBe(false);
    });
  });

  describe("arithmetic", () => {
    it("adds months by clamping to the month end", () => {
      expect(oslo("2026-01-31").plus({ months: 1 }).toISODate()).toBe("2026-02-28");
      expect(oslo("2024-01-31").plus({ month: 1 }).toISODate()).toBe("2024-02-29");
      expect(oslo("2024-02-29").minus({ years: 1 }).toISODate()).toBe("2023-02-28");
      expect(oslo("2026-12-31").plus({ days: 1 }).toISODate()).toBe("2027-01-01");
    });

    it("keeps the wall clock when adding days across DST changes", () => {
      expect(oslo("2026-03-28T12:00").plus({ days: 1 }).toISO()).toBe(
        "2026-03-29T12:00:00.000+02:00",
      );
      expect(oslo("2026-10-24T12:00").plus({ days: 1 }).toISO()).toBe(
        "2026-10-25T12:00:00.000+01:00",
      );
      expect(oslo("2026-03-28T12:00").plus({ hours: 24 }).toISO()).toBe(
        "2026-03-29T13:00:00.000+02:00",
      );
    });

    it("starts and ends days, months and years in the zone", () => {
      expect(oslo("2026-03-29T15:00").startOf("day").toISO()).toBe("2026-03-29T00:00:00.000+01:00");
      expect(oslo("2026-10-25T15:00").endOf("day").toISO()).toBe("2026-10-25T23:59:59.999+01:00");
      expect(oslo("2026-10-31T23:59").startOf("month").toISO()).toBe(
        "2026-10-01T00:00:00.000+02:00",
      );
      expect(oslo("2026-06-15").minus({ years: 1 }).startOf("year").toISO()).toBe(
        "2025-01-01T00:00:00.000+01:00",
      );
      expect(utc("2026-12-31T23:30:00").setZone(OSLO).startOf("year").toISODate()).toBe(
        "2027-01-01",
      );
      expect(oslo("2024-02-10").endOf("month").toISODate()).toBe("2024-02-29");
    });

    it("diffs days across DST changes and months across month ends", () => {
      expect(oslo("2026-03-30").diff(oslo("2026-03-29"), "days").days).toBe(1);
      expect(oslo("2026-10-26").diff(oslo("2026-10-25"), "days").days).toBe(1);
      expect(oslo("2026-10-26").diff(oslo("2026-10-25"), "hours").hours).toBe(25);
      expect(
        Math.abs(oslo("2026-03-01").diff(oslo("2026-01-31"), "months").months - 1.0323),
      ).toBeLessThanOrEqual(0.0001);
      expect(oslo("2026-02-28").diff(oslo("2026-01-31"), "months").months).toBe(1);
      expect(oslo("2026-10-31").diff(oslo("2025-10-31"), "months").months).toBe(12);
      expect(oslo("2026-04-30").diff(oslo("2025-10-31"), "months").months).toBe(6);
      expect(
        Math.abs(oslo("2026-10-15").diff(oslo("2026-04-15T12:00"), "months").months - 5.9833),
      ).toBeLessThanOrEqual(0.0001);
      expect(oslo("2025-02-28").diff(oslo("2024-02-29"), "months").months).toBe(12);
    });

    it("picks the earliest of several dates", () => {
      expect(DateTime.min(oslo("2026-11-20"), oslo("2026-10-20"))!.toISODate()).toBe("2026-10-20");
    });
  });

  describe("formatting", () => {
    it("formats the tokens the API uses", () => {
      const dt = oslo("2026-03-09T07:05:03");
      expect(dt.toFormat("ddLLyy")).toBe("090326");
      expect(dt.toFormat("dd.MM.yyyy")).toBe("09.03.2026");
      expect(dt.toFormat("yyyy-MM")).toBe("2026-03");
      expect(dt.toFormat("yyyy-MM-dd HH:mm:ss")).toBe("2026-03-09 07:05:03");
      expect(dt.toFormat("dd.MM")).toBe("09.03");
      expect(dt.setLocale("en-US").toFormat("LLL dd yyyy")).toBe("Mar 09 2026");
      expect(dt.setLocale("nb").toFormat("MMMM yyyy").toLowerCase()).toBe("mars 2026");
      expect(oslo("2026-05-01").setLocale("nb").toFormat("MMMM yyyy")).toBe("mai 2026");
    });

    it("writes ISO strings and JS dates", () => {
      expect(oslo("2026-10-25T02:30").toISODate()).toBe("2026-10-25");
      expect(oslo("2026-03-29").toJSDate().toISOString()).toBe("2026-03-28T23:00:00.000Z");
      expect(DateTime.fromJSDate(new Date("2026-10-25T01:30:00Z"), { zone: "utc" }).toISO()).toBe(
        "2026-10-25T01:30:00.000Z",
      );
      expect(utc("2026-10-25T01:30:00").toMillis()).toBe(Date.UTC(2026, 9, 25, 1, 30));
      expect(utc("2026-10-25T01:30:00").setZone(OSLO).toISO()).toBe(
        "2026-10-25T02:30:00.000+01:00",
      );
    });
  });

  describe("API date logic", () => {
    it("turns Oslo days into instants across DST, month and year ends", () => {
      expect(osloDayStart("2026-03-29").toISOString()).toBe("2026-03-28T23:00:00.000Z");
      expect(osloDayEnd("2026-03-29").toISOString()).toBe("2026-03-29T22:00:00.000Z");
      expect(osloDayStart("2026-10-25").toISOString()).toBe("2026-10-24T22:00:00.000Z");
      expect(osloDayEnd("2026-10-25").toISOString()).toBe("2026-10-25T23:00:00.000Z");
      expect(osloDayEnd("2026-12-31").toISOString()).toBe("2026-12-31T23:00:00.000Z");
      expect(osloDayEnd("2024-02-29").toISOString()).toBe("2024-02-29T23:00:00.000Z");
    });

    it("moves due dates past weekends and holidays and sets deletion deadlines", () => {
      expect(getEffectiveDueDate(oslo("2026-10-25")).toISO()).toBe("2026-10-26T00:00:00.000+01:00");
      expect(getEffectiveDueDate(oslo("2026-12-25")).toISODate()).toBe("2026-12-28");
      expect(getEffectiveDueDate(oslo("2027-01-01")).toISODate()).toBe("2027-01-04");
      expect(getDeletionDeadline(oslo("2026-03-30")).toISO()).toBe("2026-03-27T14:00:00.000+01:00");
      expect(getDeletionDeadline(oslo("2026-10-26")).toISO()).toBe("2026-10-23T14:00:00.000+02:00");
      expect(getDeletionDeadline(oslo("2027-01-01")).toISO()).toBe("2026-12-31T14:00:00.000+01:00");
      // A UTC due date keeps its Oslo calendar day
      expect(getEffectiveDueDate(utc("2026-02-28T23:30:00")).toISODate()).toBe("2026-03-02");
    });

    it("finds claim due dates four banking days ahead around month and year ends", () => {
      const due = (iso: string) => getDueDates(oslo(`${iso}T12:00`)).map((d) => d.toISODate());
      expect(due("2026-10-23")).toStrictEqual(["2026-10-29"]);
      expect(due("2026-10-26")).toStrictEqual(["2026-10-30"]);
      expect(due("2026-10-27")).toStrictEqual(["2026-11-02", "2026-11-01", "2026-10-31"]);
      expect(due("2026-12-21")).toStrictEqual([
        "2026-12-28",
        "2026-12-27",
        "2026-12-26",
        "2026-12-25",
      ]);
      expect(due("2026-12-28")).toStrictEqual([
        "2027-01-04",
        "2027-01-03",
        "2027-01-02",
        "2027-01-01",
      ]);
      expect(due("2024-02-26")).toStrictEqual(["2024-03-01"]);
      expect(due("2026-10-24")).toStrictEqual([]);
    });

    it("finds claim due dates for the Oslo day, whatever the zone of the run time", () => {
      const due = (dt: DateTime) => getDueDates(dt).map((d) => d.toISODate());
      // 00:30 on Monday 26 October in Oslo is still Sunday in UTC (the day DST ends)
      expect(due(utc("2026-10-25T23:30:00"))).toStrictEqual(["2026-10-30"]);
      // 00:30 on Saturday 24 October in Oslo is still Friday in UTC
      expect(due(utc("2026-10-23T22:30:00"))).toStrictEqual([]);
      // 01:30 on Monday 30 March in Oslo, the day after DST starts, is still Sunday in UTC
      expect(due(utc("2026-03-29T23:30:00"))).toStrictEqual(["2026-04-08"]);
      // 00:30 on 2 January 2027 in Oslo (a Saturday) is New Year's Day in UTC
      expect(due(utc("2027-01-01T23:30:00"))).toStrictEqual([]);
      // 23:30 on Tuesday 27 October in Oslo, after the change to winter time
      expect(due(oslo("2026-10-27T23:30"))).toStrictEqual(due(oslo("2026-10-27T10:00")));
      // The scheduled runs (10:00 to 13:00 Oslo) give the same dates as a UTC time of that instant
      for (const iso of ["2026-03-30T10:00", "2026-10-26T13:00", "2026-12-28T10:00"]) {
        expect(due(oslo(iso).toUTC()), iso).toStrictEqual(due(oslo(iso)));
      }
      const [first] = getDueDates(utc("2026-10-25T23:30:00"));
      expect(first.zoneName).toBe(OSLO);
    });

    it("writes AvtaleGiro dates as ddLLyy", () => {
      const line = writer.firstAndSecondLine(
        { amount: 10000, KID: "000000000000001" },
        { name: "Test" },
        "02",
        1,
        oslo("2027-01-04"),
      );
      expect(line.slice(15, 21)).toBe("040127");
    });

    it("formats CSV dates and SQL timestamp strings in Oslo time", () => {
      const csv = generateCsv(
        [
          {
            at: new Date("2026-10-25T01:30:00Z"),
            day: "2026-10-25",
            sql: "2026-10-25 02:30:00",
          },
        ],
        ["at", "day", "sql"],
      );
      expect(csv).toBe("at,day,sql\n2026-10-25 02:30:00,2026-10-25,2026-10-25 02:30:00");

      const strings = generateCsv(
        [
          {
            fraction: "2026-10-24 14:05:00.123456",
            minutes: "2026-10-24 14:05",
            offset: "2026-10-24 12:05:00 +00:00",
            month: "2026-10",
            impossible: "2026-02-30",
            text: "2026-10-24 at the office",
          },
        ],
        ["fraction", "minutes", "offset", "month", "impossible", "text"],
      );
      expect(strings.split("\n")[1]).toBe(
        "2026-10-24 14:05:00,2026-10-24 14:05:00,2026-10-24 14:05:00,2026-10,2026-02-30,2026-10-24 at the office",
      );
    });

    it("writes review queue dates as ISO", () => {
      expect(toIso(utc("2026-10-25T01:30:00"))).toBe("2026-10-25T01:30:00.000Z");
      expect(toIso(new Date("2026-10-25T01:30:00Z"))).toBe("2026-10-25T01:30:00.000Z");
    });
  });
});
