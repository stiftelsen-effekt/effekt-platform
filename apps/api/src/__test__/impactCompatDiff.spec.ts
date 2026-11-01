import { describe, it, expect, beforeEach, afterEach } from "vitest";
import sinon from "sinon";
import * as impactData from "../custom_modules/impact/data";
import * as legacyRates from "../custom_modules/impact/compat/legacyRates";
import {
  compareAnswers,
  editedAfterFreeze,
  firstDifference,
  runCompatDiff,
  type LegacyFetch,
} from "../custom_modules/impact/compat/diff";
import { frozenImpactData, LEGACY, recordedRates } from "./data/impact-compat/fixtures";

const legacyAnswer = (body: string) => ({ status: 200, body, fromLegacy: true });

describe("impact compat diff: comparing answers", () => {
  const c = {
    endpoint: "evaluations" as const,
    query: "charity_abbreviation=AMF&donation_year=2024",
  };
  const body = (cost: number, id = 71, charity = 1, language = "en") =>
    `{"evaluations": [{"id": ${id}, "converted_cost_per_output": ${cost}, "language": "${language}", ` +
    `"charity": {"id": ${charity}}, "intervention": {"id": 2}}]}`;

  it("is the same only for identical text", () => {
    expect(
      compareAnswers(c, legacyAnswer(body(5.85)), { status: 200, json: body(5.85) }, []).status,
    ).toBe("same");
    const diff = compareAnswers(c, legacyAnswer(body(5.85)), { status: 200, json: body(5.86) }, []);
    expect(diff.status).toBe("unexpected");
    expect(diff.detail).toBe("$.evaluations[0].converted_cost_per_output: 5.86 ≠ 5.85");
  });

  it("expects differences an Impact_changes row explains (admin edits and migrations)", () => {
    const edited = (changes: any[]) =>
      compareAnswers(c, legacyAnswer(body(5.85)), { status: 200, json: body(6.1, 80) }, changes)
        .status;
    // A new estimate for the same charity (e.g. a migration adding 2024 evaluations)
    expect(edited([{ entity: "estimate", entity_id: 80, Charity_ID: 1 }])).toBe("edited");
    // An edit of the legacy estimate itself
    expect(edited([{ entity: "estimate", entity_id: 71, Charity_ID: 1 }])).toBe("edited");
    expect(edited([{ entity: "charity", entity_id: 1, Charity_ID: 1 }])).toBe("edited");
    expect(edited([{ entity: "intervention", entity_id: 2, Charity_ID: null }])).toBe("edited");
    // Another charity's estimate, or a fund grant, does not explain an evaluation
    expect(edited([{ entity: "estimate", entity_id: 5, Charity_ID: 3 }])).toBe("unexpected");
    expect(edited([{ entity: "grant", entity_id: 3, Charity_ID: null }])).toBe("unexpected");
  });

  it("expects grant differences after any fund grant change", () => {
    const grants = '{"max_impact_fund_grants": []}';
    expect(
      editedAfterFreeze(
        "max_impact_fund_grants",
        [JSON.parse(grants)],
        [{ entity: "grant", entity_id: 40, Charity_ID: null }],
      ),
    ).toBe(true);
  });

  it("explains the legacy API's language leak on requests without language", () => {
    const r = compareAnswers(
      c,
      legacyAnswer(body(5.85, 71, 1, "et")),
      { status: 200, json: body(5.85) },
      [],
    );
    expect(r.status).toBe("legacy-language");
  });

  it("reports answers that did not come from the legacy API as unreachable", () => {
    const r = compareAnswers(
      c,
      { status: 200, body: body(5.85), fromLegacy: false },
      { status: 200, json: body(5.85) },
      [],
    );
    expect(r.status).toBe("unreachable");
  });

  it("names the first differing path", () => {
    expect(firstDifference({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe("$.a[1].b: 2 ≠ 3");
    expect(firstDifference([1], [1, 2])).toBe("$: length 1 ≠ 2");
    expect(firstDifference({ a: 1, b: 2 }, { b: 2, a: 1 })).toMatch(/^\$: keys/);
  });
});

describe("impact compat diff: the whole matrix", () => {
  beforeEach(() => {
    const { rates, currencies } = recordedRates();
    sinon.stub(impactData, "getImpactData").resolves(frozenImpactData());
    sinon.stub(legacyRates, "supportedCurrencies").resolves(currencies);
    sinon.stub(legacyRates, "loadLegacyRates").resolves(rates);
  });
  afterEach(() => sinon.restore());

  const recorded: LegacyFetch = async (endpoint, query) => {
    const hit = LEGACY.find((r) => r.endpoint === endpoint && r.query === query);
    return hit ? legacyAnswer(hit.body) : { status: 404, body: "", fromLegacy: true };
  };

  it("finds no differences against the recorded legacy answers", async () => {
    const summary = await runCompatDiff({ fetchLegacy: recorded, changes: [] });
    expect(summary.requests).toBe(LEGACY.length);
    expect(summary.differences).toEqual([]);
    expect(summary.same).toBe(LEGACY.length);
  });

  it("retries once and reports what stays unreachable", async () => {
    let calls = 0;
    const flaky: LegacyFetch = async (endpoint, query) => {
      calls++;
      if (calls === 1) return { status: 500, body: "", fromLegacy: true };
      return recorded(endpoint, query);
    };
    const summary = await runCompatDiff({
      fetchLegacy: flaky,
      changes: [],
      matrix: [{ endpoint: "evaluations", query: LEGACY[0].query }],
      concurrency: 1,
    });
    expect(summary.same).toBe(1);
    const down = await runCompatDiff({
      fetchLegacy: async () => {
        throw new Error("timeout");
      },
      changes: [],
      matrix: [{ endpoint: "evaluations", query: LEGACY[0].query }],
    });
    expect(down.unreachable).toBe(1);
    expect(down.differences[0].detail).toBe("timeout");
  });
});
