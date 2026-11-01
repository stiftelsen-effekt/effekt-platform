import { describe, expect, it } from "vitest";
import {
  draftShares,
  estimateValues,
  grantAllotments,
  grantDraft,
  grantValid,
  newAllotment,
  parseCount,
  parseMonthText,
  parseUsd,
  validateEstimate,
  validateGrant,
  type EstimateDraft,
} from "./forms";
import { interventionInput, validateCharity, validateIntervention } from "./record-dialogs";

const draft: EstimateDraft = {
  interventionId: "2",
  month: "01.2026",
  cost: "6,10",
  low: "",
  high: "",
  sourceName: "GiveWell",
  sourceUrl: "https://www.givewell.org/x",
  comment: "",
};

describe("impact forms", () => {
  it("reads months, dollars and counts as people type them", () => {
    expect(parseMonthText("01.2026")).toBe("2026-01-01");
    expect(parseMonthText("1.2026")).toBe("2026-01-01");
    expect(parseMonthText("2026-03")).toBe("2026-03-01");
    expect(parseMonthText("13.2026")).toBe(null);
    expect(parseMonthText("15.01.2026")).toBe(null);
    expect(parseUsd("5,85")).toBe(585);
    expect(parseUsd("1 234.5 USD")).toBe(123450);
    expect(parseUsd("0")).toBe(null);
    expect(parseUsd("5,855")).toBe(null);
    expect(parseCount("1 000 000")).toBe(1_000_000);
    expect(parseCount("1,5")).toBe(null);
  });

  it("validates an estimate like the API: bounds in order, a source for new ones", () => {
    expect(validateEstimate(draft, { requireSource: true })).toEqual({});
    expect(validateEstimate({ ...draft, low: "7" }, { requireSource: true })).toHaveProperty("low");
    expect(validateEstimate({ ...draft, high: "6" }, { requireSource: true })).toHaveProperty(
      "high",
    );
    expect(
      Object.keys(
        validateEstimate({ ...draft, sourceName: "", sourceUrl: "" }, { requireSource: true }),
      ),
    ).toEqual(["sourceName", "sourceUrl"]);
    expect(
      validateEstimate({ ...draft, sourceName: "", sourceUrl: "" }, { requireSource: false }),
    ).toEqual({});
    expect(
      validateEstimate({ ...draft, sourceUrl: "www.x.org" }, { requireSource: false }),
    ).toHaveProperty("sourceUrl");
    expect(estimateValues({ ...draft, high: "7" })).toEqual({
      interventionId: 2,
      validFrom: "2026-01-01",
      centsPerOutput: 610,
      centsPerOutputLowerBound: 0,
      centsPerOutputUpperBound: 700,
      sourceName: "GiveWell",
      sourceUrl: "https://www.givewell.org/x",
      comment: "",
    });
  });

  it("splits a grant by sum and keeps allotment ids", () => {
    const g = grantDraft();
    expect(grantValid(validateGrant(g))).toBe(false);
    const rows = [
      { ...newAllotment(), id: 48, charityId: "10", interventionId: "1", sum: "300", outputs: "3" },
      { ...newAllotment(), charityId: "1", interventionId: "2", sum: "100", outputs: "4" },
    ];
    const filled = { ...g, month: "02.2025", allotments: rows };
    expect(grantValid(validateGrant(filled))).toBe(true);
    expect(draftShares(filled)).toEqual([
      { share: 0.75, centsPerOutput: 10000 },
      { share: 0.25, centsPerOutput: 2500 },
    ]);
    expect(grantAllotments(filled).map((a) => [a.id, a.sumInCents])).toEqual([
      [48, 30000],
      [undefined, 10000],
    ]);
    expect(
      validateGrant({ ...filled, allotments: [{ ...rows[0]!, outputs: "0" }] }).rows[0],
    ).toHaveProperty("outputs");
  });

  it("charity and intervention dialogs", () => {
    expect(
      validateCharity({ name: "X", abbreviation: "a-b", organizationId: null }, true),
    ).toHaveProperty("abbreviation", "1–10 letters or digits, like AMF");
    expect(
      validateCharity({ name: "X", abbreviation: "", organizationId: null }, false).abbreviation,
    ).toBe(undefined);
    const empty = { shortDescription: "", longDescription: "" };
    const form = {
      shortDescription: "Bednets",
      longDescription: "",
      texts: {
        no: { shortDescription: "Myggnett", longDescription: "" },
        sv: empty,
        et: empty,
        dk: { shortDescription: "", longDescription: "Lang" },
      },
    };
    expect(validateIntervention(form)["texts.dk.shortDescription"]).toBeTruthy();
    expect(interventionInput({ ...form, texts: { ...form.texts, dk: empty } })).toEqual({
      shortDescription: "Bednets",
      longDescription: "",
      texts: { no: { shortDescription: "Myggnett", longDescription: "" } },
    });
  });
});
