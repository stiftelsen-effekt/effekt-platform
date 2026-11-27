import { describe, expect, it } from "vitest";
import {
  PledgeForm,
  buildPledgeRequest,
  emptyPledgeForm,
  fillPledgeText,
  parsePercentage,
  trialEndDate,
  validatePledgeForm,
} from "./pledgeRequest";

const settings = { clubName: "giv-effektivt" };

const filled = (overrides: Partial<PledgeForm> = {}): PledgeForm => ({
  ...emptyPledgeForm("2026-11-24"),
  employmentStatus: "employed",
  email: "test.person@example.org",
  firstName: "Test",
  lastName: "Person",
  acceptedTerms: true,
  ...overrides,
});

describe("parsePercentage", () => {
  it("reads a whole percentage", () => {
    expect(parsePercentage(" 10 ")).toBe(10);
  });

  it("is null for empty, decimals or non-numbers, as GWWC's form takes whole percentages", () => {
    expect(parsePercentage("")).toBeNull();
    expect(parsePercentage("12,5")).toBeNull();
    expect(parsePercentage("2.5")).toBeNull();
    expect(parsePercentage("ten")).toBeNull();
    expect(parsePercentage("-5")).toBeNull();
  });
});

describe("validatePledgeForm", () => {
  it("accepts a complete form", () => {
    expect(validatePledgeForm(filled())).toEqual({});
  });

  it("asks for everything the person has to fill in", () => {
    expect(validatePledgeForm(emptyPledgeForm("2026-11-24"))).toEqual({
      employmentStatus: "employment_required",
      email: "email_invalid",
      firstName: "first_name_required",
      lastName: "last_name_required",
      acceptedTerms: "terms_required",
    });
  });

  it("holds the 10% Pledge to at least 10% of income", () => {
    expect(validatePledgeForm(filled({ incomePercentage: "9" }))).toEqual({
      incomePercentage: "income_invalid",
    });
  });

  it("lets the Trial Pledge go from 1% to 99% of income", () => {
    const trial = { pledgeType: "trial_pledge" as const };
    expect(validatePledgeForm(filled({ ...trial, incomePercentage: "1" }))).toEqual({});
    expect(validatePledgeForm(filled({ ...trial, incomePercentage: "99" }))).toEqual({});
    for (const incomePercentage of ["0", "100"]) {
      expect(validatePledgeForm(filled({ ...trial, incomePercentage }))).toEqual({
        incomePercentage: "income_invalid",
      });
    }
  });

  it("checks an optional wealth % only when given", () => {
    expect(validatePledgeForm(filled({ wealthPercentage: "3" }))).toEqual({});
    expect(validatePledgeForm(filled({ wealthPercentage: "0" }))).toEqual({
      wealthPercentage: "wealth_invalid",
    });
  });
});

describe("trialEndDate", () => {
  it("ends the day before the same date the given months later", () => {
    expect(trialEndDate("2026-11-24", 12)).toBe("2027-11-23");
    expect(trialEndDate("2026-01-31", 6)).toBe("2026-07-30");
  });
});

describe("buildPledgeRequest", () => {
  it("builds GWWC's request for a 10% Pledge", () => {
    expect(buildPledgeRequest(filled({ motivation: "  " }), settings, "2026-11-24")).toEqual({
      person: { first_name: "Test", last_name: "Person", email: "test.person@example.org" },
      pledge: {
        club_name: "giv-effektivt",
        pledge_type: "ten_percent_pledge",
        pledge_start_date: "2026-11-24",
        pledge_end_date: null,
        pledge_sign_date: "2026-11-24",
        income_percentage: 10,
        wealth_percentage: null,
        motivation: null,
        share_motivation: false,
        financial_situation: { employment_status: "employed" },
        email_verified: true,
      },
    });
  });

  it("adds the Trial Pledge's end date, wealth and motivation", () => {
    const { pledge } = buildPledgeRequest(
      filled({
        pledgeType: "trial_pledge",
        incomePercentage: "3",
        wealthPercentage: "2",
        startDate: "2027-01-01",
        durationMonths: 24,
        motivation: "To help",
        shareMotivation: true,
      }),
      settings,
      "2026-11-24",
    );
    expect(pledge).toMatchObject({
      pledge_type: "trial_pledge",
      pledge_start_date: "2027-01-01",
      pledge_end_date: "2028-12-31",
      income_percentage: 3,
      wealth_percentage: 2,
      motivation: "To help",
      share_motivation: true,
    });
  });
});

describe("fillPledgeText", () => {
  it("fills the placeholders", () => {
    expect(
      fillPledgeText("{income}% from {start_date} to {end_date}", {
        income: "10",
        startDate: "1. januar 2027",
        endDate: "31. december 2027",
      }),
    ).toBe("10% from 1. januar 2027 to 31. december 2027");
  });
});
