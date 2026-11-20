import { describe, expect, it } from "vitest";
import {
  formatIsoDay,
  formatNorwegianDate,
  formatNorwegianTimestamp,
  isIso8601,
  isNorwegianDate,
  parseNorwegianDate,
} from "../custom_modules/dates";
import { parseReport as parseVippsReport } from "../custom_modules/parsers/vipps";
import { parseRow as parseBankRow, validateReport } from "../custom_modules/parsers/bank";

/**
 * Characterization tests written against the moment implementation, kept when moving to luxon, so
 * the formats used on receipts, Vipps charges and report imports stay the same.
 */
describe("date formatting (process time zone)", () => {
  // Local wall-clock times, so the expectations hold in any TZ
  const cases: [Date, string, string, string][] = [
    [new Date(2026, 0, 5, 7, 3), "05.01.2026", "07:03 - 05.01.2026", "2026-01-05"],
    [new Date(2026, 11, 31, 23, 59, 59), "31.12.2026", "23:59 - 31.12.2026", "2026-12-31"],
    [new Date(2024, 1, 29, 0, 0), "29.02.2024", "00:00 - 29.02.2024", "2024-02-29"],
    [new Date(1999, 8, 9, 12, 30), "09.09.1999", "12:30 - 09.09.1999", "1999-09-09"],
  ];

  it.each(cases)("formats %s", (date, norwegianDate, timestamp, isoDay) => {
    expect(formatNorwegianDate(date)).toBe(norwegianDate);
    expect(formatNorwegianTimestamp(date)).toBe(timestamp);
    expect(formatIsoDay(date)).toBe(isoDay);
  });
});

describe("isIso8601", () => {
  it.each([
    "2026-01-01",
    "2026-01-01T10:00",
    "2026-01-01T10:00:00.000Z",
    "2026-01-01T10:00:00+01:00",
    "2026-01-01T10:00:00+0100",
    "2026-01-01T10:00:00,5",
    "2026-01-01 10:00",
    "2026-01-01 10:00:00",
    "20260101",
    "2026-01",
    "2026-W01",
    "2026-001",
  ])("accepts %j", (value) => {
    expect(isIso8601(value)).toBe(true);
  });

  it.each([
    "2026-13-01",
    "2026-02-30",
    "2026-01-01T25:00",
    "01.01.2026",
    " 2026-01-01",
    "2026-01-01 ",
    "",
    "not a date",
    undefined,
    null,
    12345,
    {},
  ])("rejects %j", (value) => {
    expect(isIso8601(value)).toBe(false);
  });
});

describe("Norwegian DD.MM.YYYY dates", () => {
  it.each([
    ["02.01.2019", true],
    ["29.02.2024", true],
    ["2.1.2019", false],
    ["02.01.19", false],
    ["29.02.2023", false],
    ["31.04.2026", false],
    ["02.01.2019 10:00", false],
    [" 02.01.2019", false],
    ["2019-01-02", false],
    ["", false],
    [undefined, false],
  ])("isNorwegianDate(%j) is %s", (value, valid) => {
    expect(isNorwegianDate(value)).toBe(valid);
  });

  it.each([
    ["02.01.2019", "2019-01-02T00:00:00.000Z"],
    ["2.1.2019", "2019-01-02T00:00:00.000Z"],
    ["1.12.2026", "2026-12-01T00:00:00.000Z"],
    ["29.02.2024", "2024-02-29T00:00:00.000Z"],
    ["31.12.2026", "2026-12-31T00:00:00.000Z"],
    // Lenient about surrounding text and separators
    [" 02.01.2019", "2019-01-02T00:00:00.000Z"],
    ["\t02.01.2019\n", "2019-01-02T00:00:00.000Z"],
    ["02.01.2019 10:00", "2019-01-02T00:00:00.000Z"],
    ["2.1.2019 23:59", "2019-01-02T00:00:00.000Z"],
    ["02/01/2019", "2019-01-02T00:00:00.000Z"],
    ["02-01-2019", "2019-01-02T00:00:00.000Z"],
    ["02.01.2019.", "2019-01-02T00:00:00.000Z"],
    // Invalid dates serialise as null (and are not valid)
    ["29.02.2023", null],
    ["31.04.2026", null],
    ["00.01.2019", null],
    ["02.00.2019", null],
    ["1.13.2019", null],
    ["2019-01-02", null],
    ["", null],
    ["x", null],
    [undefined, null],
  ])("parseNorwegianDate(%j) is %s", (value, iso) => {
    const parsed = parseNorwegianDate(value);
    expect(JSON.parse(JSON.stringify({ d: parsed })).d).toBe(iso);
    expect(parsed.toJSON()).toBe(iso);
  });
});

describe("report parser dates", () => {
  it("bank rows get midnight UTC of the DD.MM.YYYY date", () => {
    const row = ["17.06.2026", "Gave", "", "250,15", "", "1264", "57967549"];
    expect(JSON.stringify(parseBankRow(row).date)).toBe('"2026-06-17T00:00:00.000Z"');
    expect(validateReport(`Dato;Tekst;-;Sum;-;Ref;KID\n${row.join(";")}\n`)).toBe(null);
    expect(
      validateReport("Dato;Tekst;-;Sum;-;Ref;KID\n2026-06-17;Gave;;250;;1264;57967549\n"),
    ).toBe("row 2 has no date in the first column (DD.MM.YYYY)");
  });

  it("Vipps details rows use the booking date, else the day of the time, at midnight UTC", () => {
    const header =
      "Salgssted;Tidspunkt;Bokføringsdato;Type;Beløp;Kundens navn;Melding;PSP-referanse";
    const csv = [
      header,
      "Gi Effektivt.;2026-06-17 23:45:10;2026-06-18;Salg;100;Ada Lovelace;;1",
      "Gi Effektivt.;2026-06-17 23:45:10;19.06.2026;Salg;100;Ada Lovelace;;2",
      "Gi Effektivt.;2026-06-16 23:45:10;;Salg;100;Ada Lovelace;;3",
      "Gi Effektivt.;2026-06-15T08:00:00;2026-6-15;Salg;100;Ada Lovelace;;4",
      "Gi Effektivt.;2026-06-14 08:00;;Salg;100;Ada Lovelace;;5",
      "Gi Effektivt.;;17.6.2026;Salg;100;Ada Lovelace;;6",
    ].join("\n");

    const report = parseVippsReport(Buffer.from(csv));
    expect(report.transactions.map((t) => [t.transactionID, JSON.stringify(t.date)])).toEqual([
      ["1", '"2026-06-18T00:00:00.000Z"'],
      ["2", '"2026-06-19T00:00:00.000Z"'],
      ["3", '"2026-06-16T00:00:00.000Z"'],
      ["4", '"2026-06-15T00:00:00.000Z"'],
    ]);
    expect(report.minDate.toISOString()).toBe("2026-06-15T00:00:00.000Z");
    expect(report.maxDate.toISOString()).toBe("2026-06-19T00:00:00.000Z");
  });

  it("legacy Vipps rows get midnight UTC of the sales date", () => {
    const row = (date: string, id: string) =>
      [
        date,
        "Gi Effektivt.",
        "",
        "",
        id,
        "",
        "100",
        "0",
        "100",
        "Salg",
        "",
        "",
        "",
        "",
        "Ada",
        "Lovelace",
        "Hei",
      ].join(";");
    const csv = [row("17.06.2026", "1"), row("2.1.2019", "2")].join("\n");

    const report = parseVippsReport(Buffer.from(csv));
    expect(report.transactions.map((t) => JSON.stringify(t.date))).toEqual([
      '"2026-06-17T00:00:00.000Z"',
      '"2019-01-02T00:00:00.000Z"',
    ]);
  });
});
