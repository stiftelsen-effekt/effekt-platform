import { describe, it, afterEach, beforeEach } from "vitest";
import { expect } from "chai";
import express, { type Request } from "express";
import request from "supertest";
import sinon from "sinon";
import * as impactData from "../custom_modules/impact/data";
import { buildImpactData } from "../custom_modules/impact/data";
import { clearImpactCostsMemo } from "../custom_modules/impact/costs";
import * as exchangeRates from "../custom_modules/exchangeRates";
import { isPublicCachedRead, mountTrpc } from "../trpc/express";
import { appRouter } from "../trpc/router";
import { createCallerFactory } from "../trpc/trpc";

/** site.impactCosts: the intervention widget's cost per output (docs/impact-api-migration.md) */
const createCaller = createCallerFactory(appRouter);
const site = () =>
  createCaller({ req: {} as Request, res: { setHeader: () => {} } as any, auth: undefined }).site;

const evaluation = (ID: number, Charity_ID: number, valid_from: string, cents: number) => ({
  ID,
  Charity_ID,
  Intervention_ID: 2,
  valid_from,
  cents_per_output: cents,
  cents_per_output_lower_bound: 0,
  cents_per_output_upper_bound: null,
  source_name: "",
  source_url: "",
  comment: "",
});

const DATA = buildImpactData({
  charities: [
    { ID: 1, name: "Against Malaria Foundation", abbreviation: "AMF", Organization_ID: 1 },
    { ID: 7, name: "Sightsavers", abbreviation: "SS", Organization_ID: 6 },
    { ID: 15, name: "GiveWell All Grants Fund", abbreviation: "AGF", Organization_ID: 15 },
  ],
  interventions: [{ ID: 2, short_description: "Bednets", long_description: "Nets" }],
  texts: [
    {
      Intervention_ID: 2,
      language: "no",
      short_description: "Myggnett",
      long_description: "Nett",
    },
  ],
  evaluations: [
    evaluation(1, 1, "2022-01-01", 551),
    evaluation(2, 1, "2023-01-01", 585),
    evaluation(3, 7, "2020-01-01", 92),
  ],
  grants: [],
  allotments: [],
  organizations: [],
});

describe("site.impactCosts", () => {
  let rates: sinon.SinonStub;

  beforeEach(() => {
    clearImpactCostsMemo();
    sinon.stub(impactData, "getImpactData").resolves(DATA);
    rates = sinon.stub(exchangeRates, "loadUsdRates").callsFake(async (currency: string) =>
      currency === "USD"
        ? { currency, dates: ["2013-01-01"], perUsd: [1] }
        : {
            currency,
            dates: ["2013-01-02", "2026-10-30"],
            perUsd: Array(2).fill(currency === "NOK" ? 10 : 7),
          },
    );
  });

  afterEach(() => sinon.restore());

  it("gives the latest evaluation's cost in the language's currency", async () => {
    const costs = await site().impactCosts({ abbreviations: ["amf", "SS"], at: "2026-11-01" });
    expect(costs).to.deep.equal([
      {
        abbreviation: "AMF",
        charityId: 1,
        charityName: "Against Malaria Foundation",
        interventionId: 2,
        shortDescription: "Myggnett",
        longDescription: "Nett",
        centsPerOutput: 585,
        costPerOutput: 58.5,
        currency: "NOK",
        validFrom: "2023-01-01",
        exchangeRateDate: "2026-10-30",
      },
      {
        abbreviation: "SS",
        charityId: 7,
        charityName: "Sightsavers",
        interventionId: 2,
        shortDescription: "Myggnett",
        longDescription: "Nett",
        centsPerOutput: 92,
        costPerOutput: 9.2,
        currency: "NOK",
        validFrom: "2020-01-01",
        exchangeRateDate: "2026-10-30",
      },
    ]);
  });

  it("takes the evaluation and rate of `at`, a given currency, and English texts", async () => {
    const [amf] = await site().impactCosts({
      abbreviations: ["AMF"],
      language: "en",
      currency: "dkk",
      at: "2022-06-15",
    });
    expect(amf).to.include({
      centsPerOutput: 551,
      costPerOutput: 38.57,
      currency: "DKK",
      shortDescription: "Bednets",
    });
    expect(rates.lastCall.args).to.deep.equal(["DKK", "2022-06-15", "2022-06-15"]);
    const [dk] = await site().impactCosts({ abbreviations: ["AMF"], language: "dk" });
    expect(dk.currency).to.equal("DKK");
    const [en] = await site().impactCosts({ abbreviations: ["AMF"], language: "en" });
    expect(en).to.include({ currency: "USD", costPerOutput: 5.85 });
  });

  it("leaves out unknown charities and charities without an evaluation", async () => {
    const costs = await site().impactCosts({ abbreviations: ["AGF", "XYZ", "AMF", "amf"] });
    expect(costs.map((c) => c.abbreviation)).to.deep.equal(["AMF"]);
  });

  it("is public and cacheable for an hour over HTTP, and validates its input", async () => {
    const app = express();
    mountTrpc(app);
    const input = encodeURIComponent(JSON.stringify({ abbreviations: ["AMF"] }));
    const res = await request(app).get(`/trpc/site.impactCosts?input=${input}`).expect(200);
    expect(res.headers["cache-control"]).to.equal("public, max-age=3600");
    expect(res.body.result.data[0].abbreviation).to.equal("AMF");

    const bad = encodeURIComponent(JSON.stringify({ abbreviations: ["AMF"], currency: "NO K" }));
    await request(app).get(`/trpc/site.impactCosts?input=${bad}`).expect(400);
    const none = encodeURIComponent(JSON.stringify({ abbreviations: [] }));
    await request(app).get(`/trpc/site.impactCosts?input=${none}`).expect(400);
  });

  it("refuses a batch that includes it, so its cache header never covers another answer", async () => {
    const app = express();
    mountTrpc(app);
    const input = encodeURIComponent(
      JSON.stringify({ 0: { abbreviations: ["AMF"] }, 1: { donorId: 7 } }),
    );
    const res = await request(app)
      .get(`/trpc/site.impactCosts,minside.donations?batch=1&input=${input}`)
      .expect(400);
    expect(res.body.error.message).to.equal("site.impactCosts cannot be batched");
    expect(res.headers["cache-control"]).to.equal(undefined);
  });

  it("answers any origin (server.ts CORS), only for a single call", () => {
    expect(isPublicCachedRead("/trpc/site.impactCosts")).to.equal(true);
    expect(isPublicCachedRead("/trpc/site.impactCosts,minside.donations")).to.equal(false);
    expect(isPublicCachedRead("/trpc/minside.donations")).to.equal(false);
    expect(isPublicCachedRead("/site.impactCosts")).to.equal(false);
  });
});
