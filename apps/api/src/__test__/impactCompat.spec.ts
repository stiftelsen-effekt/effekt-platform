import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import sinon from "sinon";
import request from "supertest";
import * as impactData from "../custom_modules/impact/data";
import * as legacyRates from "../custom_modules/impact/compat/legacyRates";
import {
  buildLegacyRates,
  convertUsd,
  seriesRate,
} from "../custom_modules/impact/compat/legacyRates";
import {
  evaluationOrder,
  legacyResponse,
  QueryParams,
} from "../custom_modules/impact/compat/legacyResponse";
import { pyFloat, pythonFloatRepr, pythonJson } from "../custom_modules/impact/compat/pythonJson";
import { createImpactCompatRouter } from "../routes/impactCompat";
import { frozenImpactData, recordedRates } from "./data/impact-compat/fixtures";

describe("impact compat: Python JSON", () => {
  it("writes floats as Python's repr", () => {
    const cases: [number, string][] = [
      [1, "1.0"],
      [5.85, "5.85"],
      [0.5, "0.5"],
      [0.0001, "0.0001"],
      [0.00001, "1e-05"],
      [0.000012345, "1.2345e-05"],
      [1e15, "1000000000000000.0"],
      [1e16, "1e+16"],
      [1.5e16, "1.5e+16"],
      [11515752.270325078, "11515752.270325078"],
      [-2.5, "-2.5"],
      [0, "0.0"],
      [123456789.125, "123456789.125"],
    ];
    for (const [x, repr] of cases) expect(pythonFloatRepr(x), String(x)).toBe(repr);
  });

  it("escapes as json.dumps(ensure_ascii=True) and uses Python's separators", () => {
    expect(
      pythonJson({ a: 'Spebarn vært — "x"\r\n\t\u007f😀', b: [1, pyFloat(2), null], c: {} }),
    ).toBe(
      '{"a": "Spebarn v\\u00e6rt \\u2014 \\"x\\"\\r\\n\\t\\u007f\\ud83d\\ude00", "b": [1, 2.0, null], "c": {}}',
    );
  });
});

describe("impact compat: legacy currency conversion", () => {
  // Units per USD as Exchange_rates stores them; EUR is 1 / (USD per EUR)
  const rows = [
    { date: "2024-03-01", currency: "EUR", perUsd: (1 / 1.0844).toFixed(8) },
    { date: "2024-03-04", currency: "EUR", perUsd: (1 / 1.0848).toFixed(8) },
    { date: "2024-03-01", currency: "NOK", perUsd: (11.4135 / 1.0844).toFixed(8) },
    { date: "2024-03-04", currency: "NOK", perUsd: (11.4475 / 1.0848).toFixed(8) },
    { date: "2024-03-01", currency: "JPY", perUsd: (162.65 / 1.0844).toFixed(8) },
  ];
  const rates = buildLegacyRates(rows);

  it("recovers the ECB's rates per EUR exactly", () => {
    expect(rates.usd.perEur).toEqual([1.0844, 1.0848]);
    expect(rates.series.get("NOK")!.perEur).toEqual([11.4135, 11.4475]);
    expect(rates.series.get("JPY")!.perEur).toEqual([162.65]);
  });

  it("interpolates days without a rate and clamps outside the series", () => {
    const nok = rates.series.get("NOK")!;
    // Saturday: one day after Friday, two before Monday
    expect(seriesRate(nok, "2024-03-02")).toBe((11.4135 * 2 + 11.4475 * 1) / 3);
    expect(seriesRate(nok, "2024-03-03")).toBe((11.4135 * 1 + 11.4475 * 2) / 3);
    expect(seriesRate(nok, "2020-01-01")).toBe(11.4135);
    expect(seriesRate(nok, "2030-01-01")).toBe(11.4475);
  });

  it("converts as amount / rate(USD) * rate(currency)", () => {
    expect(convertUsd(rates, 5.85, "NOK", "2024-03-01")).toBe((5.85 / 1.0844) * 11.4135);
    expect(convertUsd(rates, 5.85, "EUR", "2024-03-01")).toBe((5.85 / 1.0844) * 1.0);
    expect(convertUsd(rates, 5.85, "USD", "2024-03-01")).toBe((5.85 / 1.0844) * 1.0844);
    expect(convertUsd(rates, 5.85, "SEK", "2024-03-01")).toBeNull();
  });
});

describe("impact compat: legacy semantics", () => {
  const data = frozenImpactData();
  const { rates, currencies } = recordedRates();
  const answer = (endpoint: "evaluations" | "max_impact_fund_grants", query: string) =>
    legacyResponse(
      endpoint,
      QueryParams.fromQueryString(query),
      data,
      rates,
      currencies,
      "2026-11-01",
    );

  it("answers language=dk in DKK (the legacy API failed without a currency)", () => {
    const body = answer("evaluations", "charity_abbreviation=AMF&donation_year=2024&language=dk")
      .body as any;
    expect(body.evaluations[0].currency).toBe("DKK");
    expect(body.evaluations[0].language).toBe("dk");
  });

  it("answers in English and USD without language or currency", () => {
    const body = answer("evaluations", "charity_abbreviation=AMF&donation_year=2024").body as any;
    expect(body.evaluations[0]).toMatchObject({ currency: "USD", language: "en" });
  });

  it("returns 400 errors for malformed numbers and dates", () => {
    expect(() => answer("evaluations", "donation_year=abc")).toThrow(/donation_year/);
    expect(() =>
      answer("evaluations", "conversion_year=2023&conversion_month=2&conversion_day=30"),
    ).toThrow(/Invalid date/);
  });

  it("answers every charity of a multi-charity request (no shared cache key)", () => {
    const one = answer("evaluations", "charity_abbreviation=AMF&donation_year=2024").body as any;
    const two = answer(
      "evaluations",
      "charity_abbreviation=MC&charity_abbreviation=AMF&donation_year=2024",
    ).body as any;
    expect(one.evaluations).toHaveLength(1);
    expect(two.evaluations.map((e: any) => e.charity.abbreviation)).toEqual(["MC", "AMF"]);
  });

  it("orders like MySQL did: index order for up to four abbreviations", () => {
    expect(evaluationOrder([])).toBe("id");
    expect(evaluationOrder(["AMF", "amf", "MC", "GD", "SCI"])).toBe("index");
    expect(evaluationOrder(["AMF", "MC", "GD", "SCI", "HKI"])).toBe("id");
  });

  it("keeps the legacy grant ID and shape for every grant of a fund", () => {
    const body = answer("max_impact_fund_grants", "language=en").body as any;
    expect(body.max_impact_fund_grants).toHaveLength(25);
    expect(Object.keys(body.max_impact_fund_grants[0])).toEqual([
      "id",
      "allotment_set",
      "language",
      "start_year",
      "start_month",
    ]);
  });
});

describe("impact compat routes", () => {
  let app: express.Express;
  const data = frozenImpactData();
  const { rates, currencies } = recordedRates();

  beforeEach(() => {
    sinon.stub(impactData, "getImpactData").resolves(data);
    sinon.stub(legacyRates, "supportedCurrencies").resolves(currencies);
    sinon.stub(legacyRates, "loadLegacyRates").resolves(rates);
    app = express();
    // What the global CORS middleware sets for an allowed origin; the compat routes replace it
    app.use((_req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "https://gieffektivt.no");
      res.setHeader("Vary", "Origin");
      next();
    });
    app.use(createImpactCompatRouter({ hosts: new Set(["impact.gieffektivt.no"]) }));
    app.use((_req, res) => {
      res.status(404).json({ status: 404, content: "Not found" });
    });
  });
  afterEach(() => sinon.restore());

  it("serves /impact/api/* on any host with CORS * and an hour's cache", async () => {
    const res = await request(app)
      .get(
        "/impact/api/evaluations?charity_abbreviation=AMF&donation_year=2024&donation_month=3&currency=GBP",
      )
      .set("Host", "data.gieffektivt.no")
      .set("Origin", "https://www.1fortheworld.org");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["cache-control"]).toBe("public, max-age=3600");
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.headers.vary).toBeUndefined();
    expect(res.text).toMatch(/^\{"evaluations": \[\{"id": 71, /);
    expect(res.text).toContain('"converted_cost_per_output": 4.630442985295478');
  });

  it("serves /api/* only on the impact host", async () => {
    const path = "/api/max_impact_fund_grants?language=no";
    const onImpact = await request(app).get(path).set("Host", "impact.gieffektivt.no");
    expect(onImpact.status).toBe(200);
    expect(onImpact.text).toMatch(/^\{"max_impact_fund_grants": \[/);
    const onData = await request(app).get(path).set("Host", "data.gieffektivt.no");
    expect(onData.status).toBe(404);
  });

  it("answers errors as the legacy API did (200, not cached for long)", async () => {
    const res = await request(app)
      .get("/api/evaluations?currency=XXX&language=fr")
      .set("Host", "impact.gieffektivt.no");
    expect(res.status).toBe(200);
    expect(res.text).toBe(
      '{"errors": ["Currency XXX not supported", "Language code fr not supported"]}',
    );
    const bad = await request(app)
      .get("/impact/api/evaluations?donation_year=x")
      .set("Host", "impact.gieffektivt.no");
    expect(bad.status).toBe(400);
    expect(bad.headers["cache-control"]).toBe("no-store");
    expect(JSON.parse(bad.text).errors[0]).toMatch(/donation_year/);
  });

  it("answers CORS preflights", async () => {
    const res = await request(app)
      .options("/api/evaluations")
      .set("Host", "impact.gieffektivt.no")
      .set("Origin", "https://kuirikassaoled.ee")
      .set("Access-Control-Request-Method", "GET");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("does not match a trailing slash (the legacy API answered 404)", async () => {
    const res = await request(app).get("/impact/api/evaluations/").set("Host", "x");
    expect(res.status).toBe(404);
  });
});
