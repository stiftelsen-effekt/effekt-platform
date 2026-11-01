import { describe, expect, it } from "vitest";
import {
  coverageState,
  formatMonthRange,
  formatMonths,
  formatUsdCents,
  osloCurrentMonth,
} from "./model";
import { grantSlices } from "./split";

describe("impact model", () => {
  it("formats USD cents with Norwegian digits", () => {
    expect(formatUsdCents(585)).toBe("5,85 USD");
    expect(formatUsdCents(1_250_000_000, { decimals: 0 })).toBe("12\u00a0500\u00a0000 USD");
    expect(formatUsdCents(null)).toBe("–");
  });

  it("names the months an estimate covers", () => {
    expect(formatMonthRange("2023-01-01", null)).toBe("From Jan 2023");
    expect(formatMonthRange("2021-01-01", "2022-12-01")).toBe("Jan 2021 – Dec 2022");
    expect(formatMonthRange("2025-01-01", "2025-01-01")).toBe("Jan 2025");
    expect(formatMonths(1)).toBe("1 month");
    expect(formatMonths(47)).toBe("47 months");
  });

  it("tells current, superseded and upcoming apart", () => {
    expect(coverageState({ validFrom: "2023-01-01", current: true }, "2026-11-01")).toBe("current");
    expect(coverageState({ validFrom: "2021-01-01", current: false }, "2026-11-01")).toBe(
      "superseded",
    );
    expect(coverageState({ validFrom: "2027-01-01", current: false }, "2026-11-01")).toBe(
      "upcoming",
    );
  });

  it("takes the current month in Oslo", () => {
    // 23:30 UTC on 31 October is already November in Oslo
    expect(osloCurrentMonth(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11-01");
  });

  it("adds up a charity's allotments into one slice, largest first", () => {
    const slices = grantSlices(
      [
        { charityId: 10, charityName: "Malaria Consortium", organizationId: null, share: 0.1 },
        { charityId: 1, charityName: "AMF", organizationId: 12, share: 0.6 },
        { charityId: 10, charityName: "Malaria Consortium", organizationId: null, share: 0.3 },
      ],
      new Map([[12, "chart-2"]]),
    );
    expect(slices.map((s) => [s.name, Math.round(s.share)])).toEqual([
      ["AMF", 60],
      ["Malaria Consortium", 40],
    ]);
    expect(slices[0]!.color).toBe("chart-2");
    expect(slices[1]!.id).toBe(-10);
  });
});
