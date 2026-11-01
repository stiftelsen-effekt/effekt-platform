import { describe, it, expect } from "vitest";
import { legacyResponse, QueryParams } from "../custom_modules/impact/compat/legacyResponse";
import { frozenImpactData, LEGACY, recordedRates } from "./data/impact-compat/fixtures";
import { pythonJson } from "../custom_modules/impact/compat/pythonJson";
import { COMPAT_MATRIX } from "../custom_modules/impact/compat/matrix";

/**
 * Golden tests for the legacy impact API's endpoints (docs/impact-api-migration.md, phase 5):
 * every request of the compatibility matrix, answered from the rows of the phase 1 data
 * migration (the data as frozen in the legacy API, not the live tables, which ops and later
 * migrations change on purpose) and the recorded Exchange_rates rows, must give the exact bytes
 * the legacy API answered on 2026-11-01 (scripts/impact-compat-golden.ts records them).
 */

describe("impact compat REST: golden answers from the legacy API", () => {
  const data = frozenImpactData();
  const { rates, currencies } = recordedRates();

  it("has an answer recorded for every request of the matrix", () => {
    expect(LEGACY.map((r) => `${r.endpoint}?${r.query}`)).toEqual(
      COMPAT_MATRIX.map((c) => `${c.endpoint}?${c.query}`),
    );
  });

  it.each(LEGACY.map((r) => [`${r.endpoint}?${r.query}`, r] as const))("%s", (_name, recorded) => {
    const answer = legacyResponse(
      recorded.endpoint,
      QueryParams.fromQueryString(recorded.query),
      data,
      rates,
      currencies,
      "2026-11-01",
    );
    expect(answer.status).toBe(200);
    expect(pythonJson(answer.body)).toBe(recorded.body);
  });
});
