import { describe, expect, it } from "vitest";
import { dkDeductionSummary, formatDKTaxId } from "./dkTaxDeductions";

describe("dkDeductionSummary", () => {
  it("keeps only years with donations and sums them", () => {
    const summary = dkDeductionSummary({
      taxDeductions: [
        { year: 2026, sumDonations: 18000, deduction: 18000, benefit: 4554 },
        { year: 2025, sumDonations: 0, deduction: 0, benefit: 0 },
        { year: 2024, sumDonations: 16000, deduction: 16000, benefit: 4048 },
      ],
    } as never);

    expect(summary.years.map((year) => year.year)).toEqual([2026, 2024]);
    expect(summary.totals).toEqual({ sumDonations: 34000, deduction: 34000, benefit: 8602 });
  });

  it("returns no years and zero totals when the unit has no deductions", () => {
    expect(dkDeductionSummary({ taxDeductions: undefined } as never)).toEqual({
      years: [],
      totals: { sumDonations: 0, deduction: 0, benefit: 0 },
    });
  });
});

describe("formatDKTaxId", () => {
  it("formats a CPR number", () => {
    expect(formatDKTaxId("0101901234")).toBe("010190-1234");
  });

  it("formats a CVR number", () => {
    expect(formatDKTaxId("12345678")).toBe("1234 5678");
  });

  it("leaves anything else unchanged", () => {
    expect(formatDKTaxId("010190-1234")).toBe("010190-1234");
  });
});
