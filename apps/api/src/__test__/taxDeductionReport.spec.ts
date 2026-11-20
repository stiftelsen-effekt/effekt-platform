import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import * as fs from "fs";
import * as path from "path";
import type { Request, Response } from "express";
import { DateTime } from "luxon";
import { DAO } from "../custom_modules/DAO";
import type { DonorWithoutTaxUnitRow, TaxUnitYearSum } from "../custom_modules/DAO_modules/tax";
import type { TaxUnitNoticeRow } from "../custom_modules/DAO_modules/taxunitnotices";
import {
  ANONYMOUS_DONOR_ID,
  classifyDonorsWithoutTaxUnit,
  noticeRecipients,
  sendMissingTaxUnitNotices,
} from "../custom_modules/missingTaxUnitNotices";
import * as mail from "../custom_modules/mail";
import { donationHelpers } from "../custom_modules/donationHelpers";
import { checkNorwegianId, maskIdNumbers } from "../custom_modules/norwegianId";
import { osloYearRange } from "../custom_modules/osloDays";
import { LAST_UTC_TAX_YEAR, taxYearRange } from "../custom_modules/DAO_modules/tax";
import {
  createXMLReportToTaxAuthorities,
  compareDonors,
  connectGiftsProblem,
  getTaxReportOverview,
  groupTaxUnitsBySsn,
} from "../custom_modules/tax";
import { appRouter } from "../trpc/router";
import { createCallerFactory } from "../trpc/trpc";

/**
 * Synthetic numbers only: the national IDs are Tenor test numbers (month + 80), which pass the
 * mod 11 check but never belong to a real person; the organization numbers are made up.
 */
const PERSON_A = "01018512366";
const PERSON_B = "15029045604";
const PERSON_C = "31129930090";
const ORGANIZATION = "923456783";
/** PERSON_A with the last check digit changed */
const PERSON_BAD_CHECK = "01018512367";

const xsd = fs.readFileSync(
  path.join(__dirname, "data", "tax", "gavefrivilligorganisasjon_v2_0.xsd"),
  "utf8",
);
const contact = {
  name: "Test Testesen",
  email: "test@example.org",
  phoneNumber: "+4799999999",
  smsNumber: "+4799999999",
};

const unit = (
  taxUnitId: number,
  donorId: number,
  ssn: string | null,
  donationsSum: string,
): TaxUnitYearSum => ({ taxUnitId, donorId, ssn, name: `Unit ${taxUnitId}`, donationsSum });

const withoutUnit = (row: Partial<DonorWithoutTaxUnitRow> & { donorId: number }) => ({
  email: `donor${row.donorId}@example.org`,
  name: `Donor ${row.donorId}`,
  trashed: false,
  donationsSum: "1000.00",
  fundraiserSum: "0.00",
  donations: 1,
  taxUnits: 0,
  ...row,
});

const csv = (rows: [string, string, string, string][]) =>
  Buffer.from(["Name,ssn,Sum,Gieffektivt", ...rows.map((row) => row.join(","))].join("\n"), "utf8");

const createCaller = createCallerFactory(appRouter);
const callerWith = (permissions?: string[]) =>
  createCaller({
    req: {} as Request,
    res: {} as Response,
    auth: permissions ? { permissions, email: "admin@example.org" } : undefined,
  });

const ADMIN = "admin@example.org";
const file = (id: number, submitted: Date | null) => ({
  id,
  year: 2025,
  units: 3,
  sum: "31500.00",
  giverportalSum: "0.00",
  leftOut: 0,
  createdBy: ADMIN,
  created: new Date("2026-01-15T09:00:00Z"),
  submitted,
  submittedBy: submitted ? ADMIN : null,
});
const notice = (
  donorId: number,
  status: TaxUnitNoticeRow["status"],
  updated = new Date("2026-10-01T09:00:00Z"),
): TaxUnitNoticeRow => ({
  donorId,
  status,
  updatedBy: ADMIN,
  updated,
  reminders: 0,
  lastReminded: null,
  lastRemindedBy: null,
});

// Tax_report_exclusions: none unless a test says otherwise
// Tax_reports: no files unless a test says otherwise
beforeEach(() => {
  vi.spyOn(DAO.taxreportexclusions, "getForYear").mockResolvedValue([]);
  vi.spyOn(DAO.taxreports, "getForYear").mockResolvedValue([]);
  vi.spyOn(DAO.taxreports, "record").mockResolvedValue(77);
});
afterEach(() => vi.restoreAllMocks());

describe("Norwegian ID check (mod 11)", () => {
  it("accepts valid national IDs and organization numbers", () => {
    for (const id of [PERSON_A, PERSON_B, PERSON_C]) {
      expect(checkNorwegianId(id), id).toStrictEqual({ kind: "person", problem: null });
    }
    expect(checkNorwegianId(ORGANIZATION)).toStrictEqual({
      kind: "organization",
      problem: null,
    });
  });

  it("rejects a wrong check digit", () => {
    expect(checkNorwegianId(PERSON_BAD_CHECK).problem).toBe("checkDigit");
    // First check digit wrong, second recomputed would not save it
    expect(checkNorwegianId("01018512376").problem).toBe("checkDigit");
    expect(checkNorwegianId("923456784")).toStrictEqual({
      kind: "organization",
      problem: "checkDigit",
    });
  });

  it("rejects numbers whose first check digit would be 10", () => {
    // 91234567: remainder 1, so no valid check digit exists for any ninth digit
    for (let last = 0; last <= 9; last++) {
      expect(checkNorwegianId(`91234567${last}`).problem).toBe("checkDigit");
    }
  });

  it("reports wrong length, non-digits and missing numbers", () => {
    expect(checkNorwegianId("1234567890")).toStrictEqual({ kind: null, problem: "length" });
    expect(checkNorwegianId("0101851236A").problem).toBe("notDigits");
    expect(checkNorwegianId("").problem).toBe("missing");
    expect(checkNorwegianId(null).problem).toBe("missing");
  });

  it("masks number-like digit runs in messages", () => {
    expect(maskIdNumbers(`Value '${PERSON_A}' is not accepted, row 12`)).toBe(
      "Value '•••' is not accepted, row 12",
    );
  });
});

describe("Gift year range", () => {
  it("starts and ends the year at midnight in Oslo, not UTC", () => {
    const range = osloYearRange(2025);
    expect(range.from.toISOString()).toBe("2024-12-31T23:00:00.000Z");
    expect(range.before.toISOString()).toBe("2025-12-31T23:00:00.000Z");
  });

  it("keeps UTC years for the years already reported that way, so they come out as filed", () => {
    const range = taxYearRange(LAST_UTC_TAX_YEAR);
    expect(range.from.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    expect(range.before.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("starts the first Oslo year where the last UTC year ended, so no gift is reported twice", () => {
    const first = taxYearRange(LAST_UTC_TAX_YEAR + 1);
    expect(first.from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(first.before.toISOString()).toBe("2026-12-31T23:00:00.000Z");
    const next = taxYearRange(LAST_UTC_TAX_YEAR + 2);
    expect(next.from.toISOString()).toBe("2026-12-31T23:00:00.000Z");
    expect(next.before.toISOString()).toBe("2027-12-31T23:00:00.000Z");
    // A gift at 00:30 in Oslo on 1 January 2026 was reported for 2025, and only there
    const gift = new Date("2025-12-31T23:30:00Z");
    const inYear = (y: number) => {
      const r = taxYearRange(y);
      return gift >= r.from && gift < r.before;
    };
    expect([2024, 2025, 2026, 2027].filter(inYear)).toStrictEqual([2025]);
  });

  afterEach(() => vi.restoreAllMocks());

  it("limits the tax unit sums to the gift year in SQL", async () => {
    const query = vi.spyOn(DAO, "query").mockResolvedValue([[], []] as any);
    await DAO.tax.getTaxXMLReportUnits(2027);
    const sql: string = query.mock.calls[0][0];
    expect(sql).toContain("D.timestamp_confirmed >= '2026-12-31 23:00:00.000'");
    expect(sql).toContain("D.timestamp_confirmed < '2027-12-31 23:00:00.000'");
    expect(sql).not.toMatch(/YEAR\s*\(/);
  });

  it("uses the same bounds for the totals and the donors without tax unit (and the notice)", async () => {
    const query = vi
      .spyOn(DAO, "query")
      .mockResolvedValue([[{ total: 0, withoutTaxUnit: 0 }], []] as any);
    await DAO.tax.getDonationTotalsInYear(2026);
    await DAO.tax.getDonorsWithoutTaxUnitInYear(2026, 500);
    for (const call of query.getCalls()) {
      expect(call.args[0]).toContain("D.timestamp_confirmed >= '2026-01-01 00:00:00.000'");
      expect(call.args[0]).toContain("D.timestamp_confirmed < '2026-12-31 23:00:00.000'");
    }
    expect(query.mock.lastCall![1]).toStrictEqual([500]);
  });
});

describe("Who gets the missing tax unit notice", () => {
  const classified = classifyDonorsWithoutTaxUnit(
    [
      withoutUnit({ donorId: 1 }),
      withoutUnit({ donorId: 2, trashed: true }),
      withoutUnit({ donorId: ANONYMOUS_DONOR_ID }),
      withoutUnit({ donorId: 4, email: null }),
      withoutUnit({ donorId: 5, email: "  " }),
      withoutUnit({ donorId: 6, email: "ukjent-6@gieffektivt.no" }),
      withoutUnit({ donorId: 7, email: "kjoper@auksjon.example.org" }),
      withoutUnit({ donorId: 8, taxUnits: 1 }),
      // Mostly or only fundraiser gifts: a tax unit they register covers those too
      withoutUnit({ donorId: 9, donationsSum: "1000.00", fundraiserSum: "1000.00" }),
      withoutUnit({ donorId: 10, donationsSum: "1000.00", fundraiserSum: "500.00" }),
      withoutUnit({ donorId: 11, email: "DONOR1@example.org", donationsSum: "600.00" }),
      withoutUnit({ donorId: 12, donationsSum: "499.99" }),
    ],
    500,
  );

  it("leaves out deleted, anonymous, address-less, internal and tax unit donors, not fundraiser givers", () => {
    expect(classified.map((donor) => [donor.donorId, donor.exclusion])).toStrictEqual([
      [1, null],
      [2, "trashed"],
      [ANONYMOUS_DONOR_ID, "anonymous"],
      [4, "noEmail"],
      [5, "noEmail"],
      [6, "internalEmail"],
      [7, "internalEmail"],
      [8, "hasTaxUnit"],
      [9, null],
      [10, null],
      [11, null],
    ]);
    // Fundraiser gifts count in full; below minSum is not listed at all
    expect(classified.find((donor) => donor.donorId === 9)!.noticeSum).toBe("1000.00");
    expect(classified.find((donor) => donor.donorId === 10)!.noticeSum).toBe("1000.00");
  });

  it("sends one notice per address, largest first, without excluded addresses", () => {
    expect(noticeRecipients(classified).map((r) => [r.email, r.donationsSum])).toStrictEqual([
      ["donor1@example.org", 1600],
      ["donor9@example.org", 1000],
      ["donor10@example.org", 1000],
    ]);
    expect(noticeRecipients(classified, ["Donor10@example.org"])).toHaveLength(2);
    expect(noticeRecipients(classified)[0].donorIds).toStrictEqual([1, 11]);
  });

  it("moves donors left out by hand to Left out and sent donors to Sent", () => {
    const withStatus = classifyDonorsWithoutTaxUnit(
      [
        withoutUnit({ donorId: 1 }),
        withoutUnit({ donorId: 2 }),
        withoutUnit({ donorId: 3 }),
        // Left out by the rules and by hand: the rule's reason shows
        withoutUnit({ donorId: 4, taxUnits: 1 }),
        // Sent wins over the rules (e.g. the donor got the notice before being trashed)
        withoutUnit({ donorId: 5, trashed: true }),
      ],
      500,
      [notice(2, "excluded"), notice(3, "sent"), notice(4, "excluded"), notice(5, "sent")],
    );
    expect(
      withStatus.map((donor) => [donor.donorId, donor.status, donor.exclusion, donor.statusBy]),
    ).toStrictEqual([
      [1, "notice", null, null],
      [2, "excluded", "leftOut", ADMIN],
      [3, "sent", null, ADMIN],
      [4, "excluded", "hasTaxUnit", null],
      [5, "sent", null, ADMIN],
    ]);
    expect(noticeRecipients(withStatus).map((r) => r.donorIds)).toStrictEqual([[1]]);
  });
});

describe("Tax_unit_notices SQL", () => {
  afterEach(() => vi.restoreAllMocks());

  it("never turns a sent donor back into left out or into the notice", async () => {
    const query = vi.spyOn(DAO, "query").mockResolvedValue([{ affectedRows: 1 }, []] as any);
    await DAO.taxunitnotices.exclude(2025, [1, 2], ADMIN);
    expect(query.mock.calls[0][0]).toMatch(/INSERT IGNORE/);
    expect(query.mock.calls[0][1]).toStrictEqual([
      [
        [1, 2025, "excluded", ADMIN],
        [2, 2025, "excluded", ADMIN],
      ],
    ]);
    await DAO.taxunitnotices.include(2025, [1]);
    expect(query.mock.calls[1][0]).toContain("Status = 'excluded'");
    await DAO.taxunitnotices.markSent(2025, [1], ADMIN);
    expect(query.mock.calls[2][0]).toContain("ON DUPLICATE KEY UPDATE Status = 'sent'");
  });

  it("records a reminder only on donors who were sent the notice", async () => {
    const query = vi.spyOn(DAO, "query").mockResolvedValue([{ affectedRows: 1 }, []] as any);
    await DAO.taxunitnotices.markReminded(2025, [1], ADMIN);
    expect(query.mock.calls[0][0]).toContain("Reminders = Reminders + 1");
    expect(query.mock.calls[0][0]).toContain("Status = 'sent'");
    expect(query.mock.calls[0][1]).toStrictEqual([ADMIN, 2025, [1]]);
  });

  it("does nothing for an empty list", async () => {
    const query = vi.spyOn(DAO, "query").mockReturnValue(undefined as any);
    expect(await DAO.taxunitnotices.exclude(2025, [], ADMIN)).toBe(0);
    expect(await DAO.taxunitnotices.include(2025, [])).toBe(0);
    await DAO.taxunitnotices.markSent(2025, [], ADMIN);
    expect(query).toHaveBeenCalledTimes(0);
  });
});

describe("Grouping tax units by number", () => {
  it("sums tax units sharing a national ID on several donors, to the øre", () => {
    const grouped = groupTaxUnitsBySsn([
      unit(1, 10, PERSON_A, "300.10"),
      unit(2, 11, PERSON_A, "200.20"),
      unit(3, 12, PERSON_B, "800.00"),
      unit(4, 10, ` ${PERSON_A.slice(0, 6)} ${PERSON_A.slice(6)} `, "0.70"),
    ]);
    expect(grouped).toHaveLength(2);
    const a = grouped.find((group) => group.ssn === PERSON_A)!;
    expect(a.sum.toFixed(2)).toBe("501.00");
    expect(a.donorIds).toStrictEqual([10, 11]);
    expect(a.taxUnitIds).toStrictEqual([1, 2, 4]);
    expect(a.name).toBe("Unit 4");
  });

  it("keeps tax units without a number apart", () => {
    const grouped = groupTaxUnitsBySsn([unit(1, 10, null, "600"), unit(2, 11, "", "700")]);
    expect(grouped).toHaveLength(2);
  });
});

describe("Tax report overview", () => {
  beforeEach(() => {
    vi.spyOn(DAO.tax, "getTaxXMLReportUnits").mockResolvedValue([
      unit(1, 10, PERSON_A, "300.10"),
      unit(2, 11, PERSON_A, "200.00"),
      unit(3, 12, PERSON_B, "30000.00"),
      unit(4, 12, ORGANIZATION, "499.99"),
      unit(5, 13, PERSON_BAD_CHECK, "1000.00"),
      unit(6, 14, "1234567890", "100.00"),
    ]);
    vi.spyOn(DAO.tax, "getDonationTotalsInYear").mockResolvedValue({
      total: "33100.39",
      withoutTaxUnit: "1000.30",
      donations: 40,
    });
    vi.spyOn(DAO.tax, "getDonorsWithoutTaxUnitInYear").mockResolvedValue([
      withoutUnit({ donorId: 20, donationsSum: "1000.30", donations: 3 }),
    ]);
    vi.spyOn(DAO.taxunitnotices, "getForYear").mockResolvedValue([]);
    vi.spyOn(DAO.tax, "getUnconnectedGiftsInYear").mockResolvedValue([
      {
        donorId: 15,
        name: "Donor 15",
        email: "donor15@example.org",
        donationsSum: "750.00",
        donations: 2,
        kids: 1,
        taxUnits: [{ id: 7, name: "Unit 7", ssn: PERSON_C }],
      },
    ]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("adds up to all donations in the year, to the øre", async () => {
    const overview = await getTaxReportOverview(2025, 500);
    expect(overview.totals).toStrictEqual({
      all: "33100.39",
      reported: "31500.10",
      belowMinimum: "599.99",
      leftOut: "0.00",
      withoutTaxUnit: "1000.30",
      difference: "0.00",
    });
    expect(overview.counts).toEqual(
      expect.objectContaining({
        reportedUnits: 3,
        persons: 3,
        organizations: 0,
        belowMinimumUnits: 2,
        aboveMaximum: 1,
      }),
    );
  });

  it("lists donors without tax unit with name and notice status, and counts sent donors since registered", async () => {
    vi.mocked(DAO.tax.getDonorsWithoutTaxUnitInYear).mockResolvedValue([
      withoutUnit({ donorId: 20, donationsSum: "600.00" }),
      withoutUnit({ donorId: 21, donationsSum: "400.30" }),
    ]);
    vi.mocked(DAO.taxunitnotices.getForYear).mockResolvedValue([
      notice(21, "sent"),
      // Sent, and no longer without a tax unit
      notice(22, "sent"),
      notice(23, "excluded"),
    ]);
    const overview = await getTaxReportOverview(2025, 400);
    expect(overview.withoutTaxUnit.map((row) => [row.donorId, row.name, row.status])).toStrictEqual(
      [
        [20, "Donor 20", "notice"],
        [21, "Donor 21", "sent"],
      ],
    );
    expect(overview.sentNoLongerWithout).toBe(1);
    // With the email address, to judge who should get the notice
    expect(overview.withoutTaxUnit[0].email).toBe("donor20@example.org");
  });

  it("says when the year's limits are not in the code", async () => {
    expect((await getTaxReportOverview(2025, 500)).limitsInCode).toBe(true);
    const future = await getTaxReportOverview(2099, 500);
    expect(future.limitsInCode).toBe(false);
    expect(future.maximumDeduction).toBe(25000);
  });

  it("shows a difference when the parts don't add up", async () => {
    vi.mocked(DAO.tax.getDonationTotalsInYear).mockResolvedValue({
      total: "33100.40",
      withoutTaxUnit: "1000.30",
      donations: 40,
    });
    expect((await getTaxReportOverview(2025, 500)).totals.difference).toBe("0.01");
  });

  it("counts units left out by an admin apart, still adding up, and lists them with the reason", async () => {
    vi.mocked(DAO.taxreportexclusions.getForYear).mockResolvedValue([
      // Leaving PERSON_A out recorded both its units (excludeUnit)
      { taxUnitId: 1, reason: "Altinn: unknown number", createdBy: ADMIN, created: new Date() },
      { taxUnitId: 2, reason: "Altinn: unknown number", createdBy: ADMIN, created: new Date() },
      { taxUnitId: 5, reason: "Can't reach the donor", createdBy: ADMIN, created: new Date() },
    ]);
    const overview = await getTaxReportOverview(2025, 500);
    expect(overview.totals).toEqual(
      expect.objectContaining({
        reported: "30000.00",
        leftOut: "1500.10",
        difference: "0.00",
      }),
    );
    expect(overview.counts).toEqual(expect.objectContaining({ reportedUnits: 1, leftOutUnits: 2 }));
    expect(
      overview.leftOut.map((unit) => [unit.taxUnitIds, unit.reason, unit.aboveMinimum]),
    ).toStrictEqual([
      [[5], "Can't reach the donor", true],
      [[1, 2], "Altinn: unknown number", true],
    ]);
    // A left-out unit with an invalid number no longer blocks the file
    expect(overview.invalidNumbers[0]).toEqual(
      expect.objectContaining({ reported: false, leftOut: true }),
    );
    expect(JSON.stringify(overview)).not.toContain(PERSON_A);
  });

  it("lists no changes until a file is marked as sent", async () => {
    vi.mocked(DAO.taxreports.getForYear).mockResolvedValue([file(3, null)]);
    const overview = await getTaxReportOverview(2025, 500);
    expect(overview.files).toHaveLength(1);
    expect(overview.changes).toBe(null);
  });

  it("lists units whose amount in the report changed since the sent file, in whole kroner", async () => {
    vi.mocked(DAO.taxreports.getForYear).mockResolvedValue([file(4, null), file(3, new Date())]);
    const amounts = vi.spyOn(DAO.taxreports, "getUnitAmounts").mockResolvedValue(
      new Map([
        // PERSON_A: 300.10 + 200.00 now; filed 300.10 + 100.00
        [1, "300.10"],
        [2, "100.00"],
        // PERSON_B: unchanged
        [3, "30000.00"],
        // Unit 5 (invalid number) is reported now too, unchanged
        [5, "1000.00"],
        // In the file, no gifts in the year now
        [40, "800.00"],
      ]),
    );
    vi.spyOn(DAO.tax, "getById").mockResolvedValue(null);
    const overview = await getTaxReportOverview(2025, 500);
    expect(amounts.mock.calls[0]).toStrictEqual([3]);
    expect(overview.changes?.basis.id).toBe(3);
    expect(
      overview.changes?.rows.map((row) => [row.taxUnitIds, row.filed, row.now, row.difference]),
    ).toStrictEqual([
      [[40], "800.00", "0.00", "-800.00"],
      [[1, 2], "400.00", "500.00", "100.00"],
    ]);
    expect(JSON.stringify(overview.changes)).not.toContain(PERSON_A);
  });

  it("lists gifts not on the donor's own tax unit, with the units masked", async () => {
    const overview = await getTaxReportOverview(2025, 500);
    expect(overview.unconnected).toStrictEqual([
      {
        donorId: 15,
        name: "Donor 15",
        email: "donor15@example.org",
        donationsSum: "750.00",
        donations: 2,
        kids: 1,
        taxUnits: [{ id: 7, name: "Unit 7", maskedNumber: `${PERSON_C.slice(0, 4)}•••••••` }],
      },
    ]);
    expect(JSON.stringify(overview)).not.toContain(PERSON_C);
  });

  it("lists duplicates and invalid numbers by donor, without the numbers", async () => {
    const overview = await getTaxReportOverview(2025, 500);
    expect(overview.duplicates).toStrictEqual([
      { reason: "sameNumber", donorIds: [10, 11], taxUnitIds: [1, 2], sum: "500.10" },
      { reason: "severalUnits", donorIds: [12], taxUnitIds: [3, 4], sum: "30499.99" },
    ]);
    expect(overview.invalidNumbers).toStrictEqual([
      {
        donorIds: [13],
        taxUnitIds: [5],
        name: "Unit 5",
        maskedNumber: `${PERSON_BAD_CHECK.slice(0, 4)}•••••••`,
        problem: "Invalid check digit (national ID)",
        sum: "1000.00",
        reported: true,
        leftOut: false,
      },
      {
        donorIds: [14],
        taxUnitIds: [6],
        name: "Unit 6",
        maskedNumber: "1234••••••",
        problem: "Wrong length (10 characters, expected 11 or 9)",
        sum: "100.00",
        reported: false,
        leftOut: false,
      },
    ]);
    const json = JSON.stringify(overview);
    for (const id of [PERSON_A, PERSON_B, ORGANIZATION, PERSON_BAD_CHECK, "1234567890"]) {
      expect(json).not.toContain(id);
    }
  });
});

describe("Skatteetaten XML report", () => {
  afterEach(() => vi.restoreAllMocks());
  const fetchXsd = async () => xsd;

  it("reports one entry per national ID with the summed amount", async () => {
    vi.spyOn(DAO.tax, "getTaxXMLReportUnits").mockResolvedValue([
      unit(1, 10, PERSON_A, "300.40"),
      unit(2, 11, PERSON_A, "300.40"),
      unit(3, 12, ORGANIZATION, "499.00"),
    ]);
    const result = await createXMLReportToTaxAuthorities(
      2025,
      500,
      csv([
        ["Org AS", ORGANIZATION, "100", "TRUE"],
        ["Only EA", PERSON_C, '"1,000.50"', "FALSE"],
      ]),
      contact,
      fetchXsd,
    );
    if (!result.ok) expect.unreachable(JSON.stringify(result.errors));
    expect(result.xml.match(/<oppgave>/g)).toHaveLength(3);
    expect(result.xml).toContain(["<foedselsnummer>", PERSON_A, "</foedselsnummer>"].join(""));
    expect(result.xml).toContain("<beloep>601</beloep>");
    expect(result.xml).toContain("<beloep>599</beloep>");
    expect(result.xml).toContain("<beloep>1001</beloep>");
    expect(result.xml).toContain("<antallOppgaver>3</antallOppgaver>");
    expect(result.xml).toContain("<sumBeloep>2201</sumBeloep>");
    expect(result).toEqual(
      expect.objectContaining({
        units: 3,
        sum: "2201.00",
        giverportalSum: "1100.50",
        leftOut: 0,
      }),
    );
    // Our units in the file with their own amounts, for Tax_reports
    expect(result.ourUnits).toStrictEqual([
      { taxUnitId: 1, amount: "300.40" },
      { taxUnitId: 2, amount: "300.40" },
      { taxUnitId: 3, amount: "499.00" },
    ]);
  });

  it("leaves units out of the file by number, EA Giverportal's row too", async () => {
    vi.spyOn(DAO.tax, "getTaxXMLReportUnits").mockResolvedValue([
      unit(1, 10, PERSON_A, "600"),
      unit(2, 12, PERSON_BAD_CHECK, "800"),
      unit(3, 13, ORGANIZATION, "700"),
    ]);
    vi.mocked(DAO.taxreportexclusions.getForYear).mockResolvedValue([
      { taxUnitId: 1, reason: "Altinn", createdBy: ADMIN, created: new Date() },
      { taxUnitId: 2, reason: "Bad number", createdBy: ADMIN, created: new Date() },
    ]);
    const result = await createXMLReportToTaxAuthorities(
      2025,
      500,
      // TRUE for a number we left out would otherwise be an error
      csv([["Left out", PERSON_A, "100", "TRUE"]]),
      contact,
      fetchXsd,
    );
    if (!result.ok) expect.unreachable(JSON.stringify(result.errors));
    expect(result.xml).not.toContain(PERSON_A);
    expect(result.xml).not.toContain(PERSON_BAD_CHECK);
    expect(result).toEqual(
      expect.objectContaining({ units: 1, sum: "700.00", giverportalSum: "0.00", leftOut: 2 }),
    );
  });

  it("keeps a number in the file when a unit with it isn't left out", async () => {
    // Unit 1 was left out; unit 4 got the same number later (a corrected number, another donor)
    vi.spyOn(DAO.tax, "getTaxXMLReportUnits").mockResolvedValue([
      unit(1, 10, PERSON_A, "600"),
      unit(4, 14, PERSON_A, "400"),
    ]);
    vi.mocked(DAO.taxreportexclusions.getForYear).mockResolvedValue([
      { taxUnitId: 1, reason: "Altinn", createdBy: ADMIN, created: new Date() },
    ]);
    const result = await createXMLReportToTaxAuthorities(
      2025,
      500,
      csv([["EA person", PERSON_A, "100", "TRUE"]]),
      contact,
      fetchXsd,
    );
    if (!result.ok) expect.unreachable(JSON.stringify(result.errors));
    expect(result.xml).toContain(PERSON_A);
    expect(result).toEqual(
      expect.objectContaining({ units: 1, leftOut: 0, giverportalSum: "100.00" }),
    );
  });

  it("returns invalid numbers as errors instead of skipping them, without the number", async () => {
    vi.spyOn(DAO.tax, "getTaxXMLReportUnits").mockResolvedValue([
      unit(1, 10, PERSON_BAD_CHECK, "800"),
      unit(2, 11, "1234567890", "900"),
    ]);
    const result = await createXMLReportToTaxAuthorities(
      2025,
      500,
      csv([["EA person", "01018512376", "600", "FALSE"]]),
      contact,
      fetchXsd,
    );
    if (result.ok) expect.unreachable("expected errors");
    expect(result.errors.map((error) => [error.kind, error.donorIds])).toStrictEqual([
      ["invalidNumber", undefined],
      ["invalidNumber", [11]],
      ["invalidNumber", [10]],
    ]);
    const json = JSON.stringify(result.errors);
    for (const id of [PERSON_BAD_CHECK, "1234567890", "01018512376"]) {
      expect(json).not.toContain(id);
    }
  });

  it("returns mismatches with EA Giverportal as errors", async () => {
    vi.spyOn(DAO.tax, "getTaxXMLReportUnits").mockResolvedValue([unit(1, 10, PERSON_A, "800")]);
    const result = await createXMLReportToTaxAuthorities(
      2025,
      500,
      csv([
        ["A", PERSON_A, "100", "FALSE"],
        ["B", PERSON_B, "100", "TRUE"],
      ]),
      contact,
      fetchXsd,
    );
    if (result.ok) expect.unreachable("expected errors");
    expect(result.errors.map((error) => error.kind)).toStrictEqual(["giverportal", "giverportal"]);
    expect(result.errors[0].donorIds).toStrictEqual([10]);
  });

  it("stops on schema errors and when the schema can't be fetched", async () => {
    vi.spyOn(DAO.tax, "getTaxXMLReportUnits").mockResolvedValue([unit(1, 10, PERSON_A, "800")]);
    // Skatteetaten allows 20 characters
    const longName = { ...contact, phoneNumber: "+47 999 99 999 / 999 99 999" };
    const invalid = await createXMLReportToTaxAuthorities(2025, 500, csv([]), longName, fetchXsd);
    if (invalid.ok) expect.unreachable("expected schema errors");
    expect(invalid.errors[0].kind).toBe("xsd");

    const offline = await createXMLReportToTaxAuthorities(2025, 500, csv([]), contact, () =>
      Promise.reject(new Error("offline")),
    );
    if (offline.ok) expect.unreachable("expected an error");
    expect(offline.errors[0].message).toContain("Could not fetch");
  });

  it("returns CSV problems as errors without the number", async () => {
    vi.spyOn(DAO.tax, "getTaxXMLReportUnits").mockResolvedValue([]);
    const result = await createXMLReportToTaxAuthorities(
      2025,
      500,
      csv([["A", "0101851236", "100", "TRUE"]]),
      contact,
      fetchXsd,
    );
    if (result.ok) expect.unreachable("expected an error");
    expect(result.errors[0].kind).toBe("csv");
    expect(result.errors[0].message).not.toContain("0101851236");
  });
});

describe("tRPC reports.tax", () => {
  let markSent: MockInstance;
  beforeEach(() => {
    vi.spyOn(DAO.taxunitnotices, "getForYear").mockResolvedValue([]);
    markSent = vi.spyOn(DAO.taxunitnotices, "markSent").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("is for admins only", async () => {
    try {
      await callerWith().reports.tax.overview({ year: 2025, minSum: 500 });
      expect.unreachable("expected UNAUTHORIZED");
    } catch (err: any) {
      expect(err.code).toBe("UNAUTHORIZED");
    }
  });

  it("returns errors from the XML builder instead of a file", async () => {
    vi.spyOn(DAO.tax, "getTaxXMLReportUnits").mockResolvedValue([
      unit(1, 10, PERSON_BAD_CHECK, "800"),
    ]);
    const formData = new FormData();
    formData.append("report", new File([csv([])], "giverportal.csv", { type: "text/csv" }));
    for (const [key, value] of Object.entries({ ...contact, year: "2025", minSum: "500" })) {
      formData.append(key, value);
    }
    const result = await callerWith(["admin"]).reports.tax.skatteetaten(formData);
    expect(result.file).toBe(null);
    expect(result.errors).toHaveLength(1);
    // Only files actually made are recorded
    expect(vi.mocked(DAO.taxreports.record)).toHaveBeenCalledTimes(0);
  });

  it("marks a file as sent, saying who, and lists the years with a sent file", async () => {
    const mark = vi.spyOn(DAO.taxreports, "markSubmitted").mockResolvedValue(true);
    vi.spyOn(DAO.taxreports, "getSubmittedYears").mockResolvedValue([
      { year: 2025, submitted: new Date("2026-01-19T10:00:00Z") },
    ]);
    const caller = callerWith(["admin"]).reports.tax;
    expect(await caller.markSubmitted({ reportId: 3 })).toStrictEqual({ changed: true });
    expect(mark.mock.calls[0]).toStrictEqual([3, ADMIN]);
    expect(await caller.submittedYears()).toStrictEqual([
      { year: 2025, submitted: new Date("2026-01-19T10:00:00Z") },
    ]);
  });

  it("sends the missing tax unit notice in test mode to the test address", async () => {
    vi.spyOn(DAO.tax, "getDonorsWithoutTaxUnitInYear").mockResolvedValue([
      withoutUnit({ donorId: 1, email: "a@example.org", donationsSum: "900.00" }),
      withoutUnit({ donorId: 2, email: "b@example.org", donationsSum: "800.00" }),
    ]);
    const send = vi.spyOn(mail, "sendMissingTaxUnitNotice").mockResolvedValue(true);
    const result = await callerWith(["admin"]).reports.tax.missingTaxUnitNotice({
      year: 2025,
      minSum: 500,
      testEmail: "test@example.org",
      testLimit: 1,
    });
    expect(result).toStrictEqual({
      round: "notice",
      total: 1,
      success: 1,
      failed: 0,
      testMode: true,
      donorsMarkedSent: 0,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][2]).toBe("test@example.org");
    // A test moves nobody to Sent
    expect(markSent).toHaveBeenCalledTimes(0);
  });

  const twoDonors = () =>
    vi
      .spyOn(DAO.tax, "getDonorsWithoutTaxUnitInYear")
      .mockResolvedValue([
        withoutUnit({ donorId: 1, email: "a@example.org", donationsSum: "900.00" }),
        withoutUnit({ donorId: 2, email: "b@example.org", donationsSum: "800.00" }),
      ]);

  it("refuses to email the donors without the year repeated in confirmYear", async () => {
    twoDonors();
    const send = vi.spyOn(mail, "sendMissingTaxUnitNotice").mockResolvedValue(true);
    for (const input of [
      { year: 2025, minSum: 500 },
      { year: 2025, minSum: 500, confirmYear: 2024 },
    ]) {
      try {
        await callerWith(["admin"]).reports.tax.missingTaxUnitNotice(input);
        expect.unreachable("expected BAD_REQUEST");
      } catch (err: any) {
        expect(err.code).toBe("BAD_REQUEST");
      }
    }
    expect(send).toHaveBeenCalledTimes(0);
  });

  it("refuses testLimit without testEmail, which would email real donors", async () => {
    twoDonors();
    const send = vi.spyOn(mail, "sendMissingTaxUnitNotice").mockResolvedValue(true);
    try {
      await callerWith(["admin"]).reports.tax.missingTaxUnitNotice({
        year: 2025,
        minSum: 500,
        testLimit: 1,
      });
      expect.unreachable("expected BAD_REQUEST");
    } catch (err: any) {
      expect(err.code).toBe("BAD_REQUEST");
    }
    expect(send).toHaveBeenCalledTimes(0);
  });

  it("emails the donors themselves when the year is confirmed, and says it isn't a test", async () => {
    twoDonors();
    const send = vi.spyOn(mail, "sendMissingTaxUnitNotice").mockResolvedValue(true);
    const result = await callerWith(["admin"]).reports.tax.missingTaxUnitNotice({
      year: 2025,
      minSum: 500,
      confirmYear: 2025,
    });
    expect(result).toStrictEqual({
      round: "notice",
      total: 2,
      success: 2,
      failed: 0,
      testMode: false,
      donorsMarkedSent: 2,
    });
    expect(send.getCalls().map((call) => call.args[2])).to.have.members([
      "a@example.org",
      "b@example.org",
    ]);
    expect(markSent).toHaveBeenCalledTimes(1);
    expect(markSent.mock.calls[0]).toStrictEqual([2025, [1, 2], ADMIN]);
  });

  it("records only the donors the email reached, and skips those left out or sent before", async () => {
    vi.spyOn(DAO.tax, "getDonorsWithoutTaxUnitInYear").mockResolvedValue([
      withoutUnit({ donorId: 1, email: "a@example.org", donationsSum: "900.00" }),
      withoutUnit({ donorId: 2, email: "b@example.org", donationsSum: "800.00" }),
      withoutUnit({ donorId: 3, email: "c@example.org", donationsSum: "700.00" }),
      withoutUnit({ donorId: 4, email: "d@example.org", donationsSum: "600.00" }),
      // Same address as donor 1: one email, both recorded
      withoutUnit({ donorId: 5, email: "A@example.org", donationsSum: "550.00" }),
    ]);
    vi.mocked(DAO.taxunitnotices.getForYear).mockResolvedValue([
      notice(3, "excluded"),
      notice(4, "sent"),
    ]);
    const send = vi.spyOn(mail, "sendMissingTaxUnitNotice").mockReturnValue(undefined as any);
    send.withArgs(sinon.match({ email: "a@example.org" })).resolves(true);
    send.withArgs(sinon.match({ email: "b@example.org" })).resolves(false);
    const result = await callerWith(["admin"]).reports.tax.missingTaxUnitNotice({
      year: 2025,
      minSum: 500,
      confirmYear: 2025,
    });
    expect(send.getCalls().map((call) => call.args[2])).to.have.members([
      "a@example.org",
      "b@example.org",
    ]);
    expect(result).toEqual(
      expect.objectContaining({ total: 2, success: 1, failed: 1, donorsMarkedSent: 2 }),
    );
    expect(markSent.mock.calls[0]).toStrictEqual([2025, [1, 5], ADMIN]);
  });

  it("moves donors to Left out and back, saying who did it", async () => {
    const exclude = vi.spyOn(DAO.taxunitnotices, "exclude").mockResolvedValue(2);
    const include = vi.spyOn(DAO.taxunitnotices, "include").mockResolvedValue(1);
    const caller = callerWith(["admin"]).reports.tax;
    expect(
      await caller.noticeStatus({ year: 2025, donorIds: [1, 2], status: "excluded" }),
    ).toStrictEqual({ changed: 2 });
    expect(exclude.mock.calls[0]).toStrictEqual([2025, [1, 2], ADMIN]);
    expect(
      await caller.noticeStatus({ year: 2025, donorIds: [1], status: "notice" }),
    ).toStrictEqual({ changed: 1 });
    expect(include.mock.calls[0]).toStrictEqual([2025, [1]]);
  });

  it("refuses an unconfirmed send in the sending code too (the REST route uses it)", async () => {
    twoDonors();
    const send = vi.spyOn(mail, "sendMissingTaxUnitNotice").mockResolvedValue(true);
    let error: Error | undefined;
    try {
      await sendMissingTaxUnitNotices({ year: 2025, minSum: 500 });
    } catch (err: any) {
      error = err;
    }
    expect(error?.message).toMatch(/confirmYear/);
    expect(send).toHaveBeenCalledTimes(0);
  });
});

describe("Sending to chosen donors, reminders and the preview", () => {
  let markSent: MockInstance;
  let markReminded: MockInstance;
  beforeEach(() => {
    vi.spyOn(DAO.tax, "getDonorsWithoutTaxUnitInYear").mockResolvedValue([
      withoutUnit({ donorId: 1, email: "a@example.org", donationsSum: "900.00" }),
      withoutUnit({ donorId: 2, email: "b@example.org", donationsSum: "800.00" }),
      withoutUnit({ donorId: 3, email: "c@example.org", donationsSum: "700.00" }),
      // Sent, and has since been deleted: no reminder
      withoutUnit({ donorId: 4, email: "d@example.org", donationsSum: "600.00", trashed: true }),
    ]);
    vi.spyOn(DAO.taxunitnotices, "getForYear").mockResolvedValue([
      notice(3, "sent"),
      notice(4, "sent"),
    ]);
    markSent = vi.spyOn(DAO.taxunitnotices, "markSent").mockResolvedValue(undefined);
    markReminded = vi.spyOn(DAO.taxunitnotices, "markReminded").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("sends the notice only to the ticked donors of Gets the notice", async () => {
    const send = vi.spyOn(mail, "sendMissingTaxUnitNotice").mockResolvedValue(true);
    const result = await callerWith(["admin"]).reports.tax.missingTaxUnitNotice({
      year: 2025,
      minSum: 500,
      confirmYear: 2025,
      // 3 is in Sent: the notice round doesn't send to it again
      donorIds: [2, 3],
    });
    expect(send.getCalls().map((call) => call.args[2])).toStrictEqual(["b@example.org"]);
    expect(result).toEqual(
      expect.objectContaining({ round: "notice", total: 1, donorsMarkedSent: 1 }),
    );
    expect(markSent.mock.calls[0]).toStrictEqual([2025, [2], ADMIN]);
  });

  it("reminds the donors in Sent the rules still allow, and records the reminder", async () => {
    const send = vi.spyOn(mail, "sendMissingTaxUnitNotice").mockResolvedValue(true);
    const result = await callerWith(["admin"]).reports.tax.missingTaxUnitNotice({
      year: 2025,
      minSum: 500,
      confirmYear: 2025,
      round: "reminder",
    });
    expect(send.getCalls().map((call) => [call.args[2], call.args[3]])).toStrictEqual([
      ["c@example.org", { reminder: true }],
    ]);
    expect(result).toEqual(
      expect.objectContaining({ round: "reminder", total: 1, donorsMarkedSent: 1 }),
    );
    expect(markReminded.mock.calls[0]).toStrictEqual([2025, [3], ADMIN]);
    expect(markSent).toHaveBeenCalledTimes(0);
  });

  it("doesn't remind donors sent the notice or reminded in the last week", async () => {
    const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    vi.mocked(DAO.taxunitnotices.getForYear).mockResolvedValue([
      // Reminded two days ago, and sent the notice yesterday: neither gets one now
      { ...notice(1, "sent", daysAgo(30)), reminders: 1, lastReminded: daysAgo(2) },
      notice(2, "sent", daysAgo(1)),
      // Reminded eight days ago: due again
      { ...notice(3, "sent", daysAgo(30)), reminders: 1, lastReminded: daysAgo(8) },
    ]);
    const send = vi.spyOn(mail, "sendMissingTaxUnitNotice").mockResolvedValue(true);
    const result = await callerWith(["admin"]).reports.tax.missingTaxUnitNotice({
      year: 2025,
      minSum: 500,
      confirmYear: 2025,
      round: "reminder",
      donorIds: [1, 2, 3],
    });
    expect(send.getCalls().map((call) => call.args[2])).toStrictEqual(["c@example.org"]);
    expect(result).toEqual(expect.objectContaining({ total: 1 }));
    expect(markReminded.mock.calls[0]).toStrictEqual([2025, [3], ADMIN]);
  });

  it("a reminder needs the year confirmed like the notice", async () => {
    const send = vi.spyOn(mail, "sendMissingTaxUnitNotice").mockResolvedValue(true);
    try {
      await callerWith(["admin"]).reports.tax.missingTaxUnitNotice({
        year: 2025,
        minSum: 500,
        round: "reminder",
      });
      expect.unreachable("expected BAD_REQUEST");
    } catch (err: any) {
      expect(err.code).toBe("BAD_REQUEST");
    }
    expect(send).toHaveBeenCalledTimes(0);
  });

  it("previews the round: how many, and the email for the first recipient, sending nothing", async () => {
    const send = vi.spyOn(mail, "sendMissingTaxUnitNotice").mockResolvedValue(true);
    const build = vi
      .spyOn(mail, "buildMissingTaxUnitNotice")
      .mockResolvedValue({ templateId: "template-1", personalization: { name: "Donor" } });
    const preview = await callerWith(["admin"]).reports.tax.noticePreview({
      year: 2025,
      minSum: 500,
      round: "notice",
    });
    expect(preview).toEqual(
      expect.objectContaining({ round: "notice", emails: 2, donors: 2, problem: null }),
    );
    expect(preview.example).toEqual(
      expect.objectContaining({ donorIds: [1], email: "a@example.org" }),
    );
    expect(preview.mail).toStrictEqual({
      templateId: "template-1",
      personalization: { name: "Donor" },
    });
    expect(build.mock.calls[0][2]).toStrictEqual({ reminder: false });
    expect(send).toHaveBeenCalledTimes(0);
    expect(markSent).toHaveBeenCalledTimes(0);

    build.mockResolvedValue(null);
    const reminder = await callerWith(["admin"]).reports.tax.noticePreview({
      year: 2025,
      minSum: 500,
      round: "reminder",
    });
    expect(reminder).toEqual(expect.objectContaining({ emails: 1, mail: null }));
    expect(reminder.problem).toMatch(/limits/);
  });

  it("shows reminders in the overview, and who a reminder would go to", async () => {
    vi.spyOn(DAO.tax, "getTaxXMLReportUnits").mockResolvedValue([]);
    vi.spyOn(DAO.tax, "getDonationTotalsInYear").mockResolvedValue({
      total: "0",
      withoutTaxUnit: "0",
      donations: 0,
    });
    vi.spyOn(DAO.tax, "getUnconnectedGiftsInYear").mockResolvedValue([]);
    vi.mocked(DAO.taxunitnotices.getForYear).mockResolvedValue([
      { ...notice(3, "sent"), reminders: 2, lastReminded: new Date("2026-10-20T09:00:00Z") },
      notice(4, "sent"),
    ]);
    const overview = await getTaxReportOverview(2025, 500);
    const row = (id: number) => overview.withoutTaxUnit.find((donor) => donor.donorId === id)!;
    expect(row(3)).toEqual(expect.objectContaining({ reminders: 2, canRemind: true }));
    expect(row(4)).toEqual(expect.objectContaining({ reminders: 0, canRemind: false }));
    expect(row(1).canRemind).toBe(false);

    // Reminded yesterday: not due again for a week
    vi.mocked(DAO.taxunitnotices.getForYear).mockResolvedValue([
      { ...notice(3, "sent"), reminders: 1, lastReminded: new Date(Date.now() - 86_400_000) },
    ]);
    const later = await getTaxReportOverview(2025, 500);
    expect(later.withoutTaxUnit.find((donor) => donor.donorId === 3)!.canRemind).toBe(false);
  });
});

describe("Leaving tax units out of the report", () => {
  it("saves the reason and who, and puts units back", async () => {
    vi.spyOn(DAO.tax, "getById").mockResolvedValue({
      id: 5,
      donorId: 13,
      name: "Unit 5",
      ssn: PERSON_A,
      archived: null as any,
    });
    // Unit 6 has the same number (another donor): it is recorded too; unit 7 isn't
    vi.spyOn(DAO.tax, "getTaxXMLReportUnits").mockResolvedValue([
      unit(5, 13, PERSON_A, "600"),
      unit(6, 14, PERSON_A.replace(/^(\d{6})/, "$1 "), "100"),
      unit(7, 15, ORGANIZATION, "700"),
    ]);
    const exclude = vi.spyOn(DAO.taxreportexclusions, "exclude").mockResolvedValue(true);
    const include = vi.spyOn(DAO.taxreportexclusions, "include").mockResolvedValue(1);
    const caller = callerWith(["admin"]).reports.tax;
    expect(
      await caller.excludeUnit({ year: 2025, taxUnitId: 5, reason: "  Altinn: unknown  " }),
    ).toStrictEqual({ changed: true });
    expect(exclude.mock.calls[0]).toStrictEqual([2025, [5, 6], "Altinn: unknown", ADMIN]);
    expect(await caller.includeUnits({ year: 2025, taxUnitIds: [5] })).toStrictEqual({
      changed: 1,
    });
    expect(include.mock.calls[0]).toStrictEqual([2025, [5]]);
  });

  it("needs a reason", async () => {
    try {
      await callerWith(["admin"]).reports.tax.excludeUnit({ year: 2025, taxUnitId: 5, reason: "" });
      expect.unreachable("expected BAD_REQUEST");
    } catch (err: any) {
      expect(err.code).toBe("BAD_REQUEST");
    }
  });
});

describe("Connecting gifts to the donor's tax unit", () => {
  afterEach(() => vi.restoreAllMocks());
  // The year being given now: the only years open for connecting are this one and, in January,
  // the last one
  const thisYear = DateTime.now().setZone("Europe/Oslo").year;

  const setUp = () => {
    vi.spyOn(DAO.tax, "getById").mockImplementation(async (id: number) =>
      id === 7
        ? { id: 7, donorId: 15, name: "Unit 7", ssn: PERSON_C, archived: null as any }
        : id === 8
          ? { id: 8, donorId: 15, name: "Old", ssn: PERSON_C, archived: "2024-01-01" as any }
          : { id, donorId: 99, name: "Other", ssn: PERSON_A, archived: null as any },
    );
    vi.spyOn(DAO.tax, "getKIDsWithoutTaxUnitInYear").mockResolvedValue([
      { kid: "111", fundraiser: false, hasEarlier: false, otherDonors: false },
      // An AvtaleGiro KID with gifts from earlier years too: those stay as reported
      { kid: "222", fundraiser: false, hasEarlier: true, otherDonors: false },
      { kid: "333", fundraiser: true, hasEarlier: false, otherDonors: false },
      // Also holds another donor's gifts, which would be reported on this unit: left alone
      { kid: "444", fundraiser: false, hasEarlier: false, otherDonors: true },
      // A fundraiser KID with an earlier gift isn't one gift's own: left alone
      { kid: "555", fundraiser: true, hasEarlier: true, otherDonors: false },
    ]);
    vi.spyOn(DAO.distributions, "getAllByDonor").mockResolvedValue({
      donorID: 15,
      distributions: [{ kid: "222", donorId: 15, taxUnitId: null, causeAreas: [] } as any],
    });
    vi.spyOn(donationHelpers, "createKID").mockResolvedValue("999999999999999");
    return {
      add: vi.spyOn(DAO.distributions, "add").mockResolvedValue(true),
      move: vi.spyOn(DAO.tax, "moveDonationsBefore").mockResolvedValue(4),
      connect: vi.spyOn(DAO.distributions, "addTaxUnitToDistribution").mockResolvedValue(undefined),
    };
  };

  it("puts the year's KIDs on the tax unit and keeps earlier gifts on a copy without it", async () => {
    const { add, move, connect } = setUp();
    const result = await callerWith(["admin"]).reports.tax.connectToTaxUnit({
      year: thisYear,
      donorId: 15,
      taxUnitId: 7,
    });
    expect(result).toStrictEqual({
      kids: 3,
      copiedKids: 1,
      earlierDonationsKept: 4,
      skippedKids: 2,
    });
    expect(add.mock.calls[0][0]).toEqual(
      expect.objectContaining({ kid: "999999999999999", taxUnitId: null }),
    );
    expect(move.mock.calls[0].slice(0, 2)).toStrictEqual(["222", "999999999999999"]);
    // From the start of the gift year
    expect((move.mock.calls[0][2] as Date).toISOString()).toBe(
      taxYearRange(thisYear).from.toISOString(),
    );
    expect(connect.getCalls().map((call) => call.args)).toStrictEqual([
      ["111", 7],
      ["222", 7],
      ["333", 7],
    ]);
  });

  it("refuses another donor's tax unit, and an archived one", async () => {
    const { connect } = setUp();
    for (const taxUnitId of [9, 8]) {
      try {
        await callerWith(["admin"]).reports.tax.connectToTaxUnit({
          year: thisYear,
          donorId: 15,
          taxUnitId,
        });
        expect.unreachable("expected BAD_REQUEST");
      } catch (err: any) {
        expect(err.code).toBe("BAD_REQUEST");
      }
    }
    expect(connect).toHaveBeenCalledTimes(0);
  });

  it("refuses a year that is filed, since the years after it would change too", async () => {
    const { connect } = setUp();
    try {
      await callerWith(["admin"]).reports.tax.connectToTaxUnit({
        year: thisYear - 2,
        donorId: 15,
        taxUnitId: 7,
      });
      expect.unreachable("expected BAD_REQUEST");
    } catch (err: any) {
      expect(err.code).toBe("BAD_REQUEST");
      expect(err.message).toMatch(/filed with Skatteetaten/);
    }
    expect(connect).toHaveBeenCalledTimes(0);
  });

  it("opens this year, and last year until 31 January (Oslo time)", () => {
    const at = (iso: string) => new Date(iso);
    expect(connectGiftsProblem(2026, at("2026-11-13T12:00:00Z"))).toBe(null);
    expect(connectGiftsProblem(2025, at("2026-11-13T12:00:00Z"))).toMatch(/filed/);
    expect(connectGiftsProblem(2027, at("2026-11-13T12:00:00Z"))).toMatch(/hasn't started/);
    expect(connectGiftsProblem(2026, at("2027-01-31T22:30:00Z"))).toBe(null);
    // 00:30 on 1 February in Oslo
    expect(connectGiftsProblem(2026, at("2027-01-31T23:30:00Z"))).toMatch(/filed/);
    // 00:30 on 1 January in Oslo is already the new year
    expect(connectGiftsProblem(2027, at("2026-12-31T23:30:00Z"))).toBe(null);
  });
});

describe("Comparing possible duplicate donors", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns the donors side by side with the numbers masked", async () => {
    vi.spyOn(DAO.tax, "getDonorsForComparison").mockResolvedValue([
      {
        id: 10,
        name: "Donor 10",
        email: "donor10@example.org",
        registered: new Date("2024-01-01T00:00:00Z"),
        trashed: false,
        donations: 3,
        donationsSum: "300.00",
        lastDonation: null,
        kids: 1,
        agreements: 0,
        activeAgreements: 0,
        taxUnits: [{ id: 1, name: "Unit 1", ssn: PERSON_A, archived: false }],
      },
    ]);
    const [donor] = await compareDonors([10, 11]);
    expect(donor.taxUnits).toStrictEqual([
      { id: 1, name: "Unit 1", maskedNumber: `${PERSON_A.slice(0, 4)}•••••••`, archived: false },
    ]);
    expect(JSON.stringify(donor)).not.toContain(PERSON_A);
  });
});
