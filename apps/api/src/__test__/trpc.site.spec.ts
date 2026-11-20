import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import express, { type Request, type Response } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import { DAO } from "../custom_modules/DAO";
import * as exchangeRates from "../custom_modules/exchangeRates";
import * as impactData from "../custom_modules/impact/data";
import { buildImpactData, type ImpactRows } from "../custom_modules/impact/data";
import { mountTrpc } from "../trpc/express";
import { appRouter } from "../trpc/router";
import {
  siteDailyDonationsOutput,
  siteFundraiserOutput,
  siteMonthlyOutputsOutput,
  siteOrganizationsOutput,
  siteReferralSumsOutput,
  siteResultsHeadlineOutput,
} from "../trpc/shared/site";
import { createCallerFactory } from "../trpc/trpc";

const createCaller = createCallerFactory(appRouter);
const anonymous = () =>
  createCaller({ req: {} as Request, res: {} as Response, auth: undefined }).site;

const expectTrpcError = async (promise: Promise<unknown>, code: string, message?: string) => {
  try {
    await promise;
    expect.unreachable(`expected ${code}`);
  } catch (err: any) {
    expect(err.code).toBe(code);
    if (message) expect(err.message).toBe(message);
  }
};

/** An app with the REST routes the website called before */
const restApp = () => {
  const app = express();
  app.use("/results", require("../routes/results").resultsRouter);
  app.use("/ltv", require("../routes/ltv").ltvRouter);
  app.use("/fundraisers", require("../routes/fundraisers").fundraisersRouter);
  app.use("/organizations", require("../routes/organizations").organizationsRouter);
  return app;
};

/** REST's JSON for a value: what the website saw before (Dates become ISO strings) */
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value));

const referralSumsRow = () => ({
  Year: 2024,
  Num_Donors: 2542,
  Total_sum: 23840195,
  Num_Donors_ref: 1240,
  Total_sum_ref: 15870457,
  Num_Donors_EA_ref: 296,
  Total_sum_EA_ref: 5796237,
  Median_yearly_ds_EA_ref: 5500,
  Avg_yearly_ds_EA_ref: 19582,
  Max_yearly_ds_EA_ref: 949264,
  Num_Donors_ac_ref: 383,
  Total_sum_ac_ref: 6483109,
  Num_Donors_some_ref: 127,
  Total_sum_some_ref: 1259014,
  Num_Donors_pod_ref: 224,
  Total_sum_pod_ref: 2288570,
  Num_Donors_tvr_ref: 33,
  Total_sum_tvr_ref: 585447,
  Num_Donors_news_ref: 53,
  Total_sum_news_ref: 834655,
  Num_Donors_web_ref: 180,
  Total_sum_web_ref: 2293224,
  Num_Donors_oth_ref: 189,
  Total_sum_oth_ref: 4126074,
  Inserted: new Date("2026-10-28T08:00:29.000Z"),
  Updated: new Date("2026-10-28T08:00:29.000Z"),
});

/** Monthly sums per organisation, as EffektAnalysisDB.v_Monthly_donations_per_org has them */
const monthlySums = [
  { Org: "AMF", DonationMonth: "2024-01", TotalDonations: "10000" },
  { Org: "AMF", DonationMonth: "2024-02", TotalDonations: "5000" },
  { Org: "Sight", DonationMonth: "2024-02", TotalDonations: "2000" },
  { Org: "TCF", DonationMonth: "2024-02", TotalDonations: "3000" },
];

/** The impact tables for the sums above: AMF and Sightsavers evaluations, one TCF grant */
const impactRows = (): ImpactRows => ({
  charities: [
    { ID: 1, name: "Against Malaria Foundation", abbreviation: "AMF", Organization_ID: 1 },
    { ID: 7, name: "Sightsavers", abbreviation: "SS", Organization_ID: 6 },
    { ID: 3, name: "Helen Keller International", abbreviation: "HKI", Organization_ID: 10 },
  ],
  interventions: [
    { ID: 2, short_description: "Bednets", long_description: "" },
    { ID: 4, short_description: "Surgeries", long_description: "" },
    { ID: 3, short_description: "Vitamin A supplements", long_description: "" },
  ],
  texts: [
    { Intervention_ID: 2, language: "no", short_description: "Myggnett", long_description: "" },
    { Intervention_ID: 4, language: "no", short_description: "Operasjoner", long_description: "" },
    { Intervention_ID: 3, language: "no", short_description: "Vitamin A", long_description: "" },
  ],
  evaluations: [
    [1, 1, 2, 200],
    [2, 7, 4, 5000],
  ].map(([ID, Charity_ID, Intervention_ID, cents_per_output]) => ({
    ID,
    Charity_ID,
    Intervention_ID,
    valid_from: "2023-01-01",
    cents_per_output,
    cents_per_output_lower_bound: 0,
    cents_per_output_upper_bound: null,
    source_name: "",
    source_url: "",
    comment: "",
  })),
  grants: [{ ID: 1, fund: "TCF", valid_from: "2023-06-01", legacy_id: 1 }],
  allotments: [
    [1, 1, 2, 60000, 300],
    [2, 3, 3, 40000, 400],
  ].map(([ID, Charity_ID, Intervention_ID, sum_in_cents, number_outputs_purchased]) => ({
    ID,
    Grant_ID: 1,
    Charity_ID,
    Intervention_ID,
    sum_in_cents,
    number_outputs_purchased,
    number_outputs_purchased_lower_bound: 0,
    number_outputs_purchased_upper_bound: null,
    source_name: "",
    source_url: "",
    comment: "",
  })),
  organizations: [
    { ID: 1, abbriv: "AMF", full_name: "Against Malaria Foundation" },
    { ID: 6, abbriv: "Sight", full_name: "Sightsavers" },
    { ID: 10, abbriv: "HKI", full_name: "Helen Keller International" },
    { ID: 12, abbriv: "TCF", full_name: "GiveWell Top Charities Fund" },
  ],
});

const stubMonthlyOutputs = () => {
  vi.spyOn(DAO.results, "getMonthlyDonationsPerOrg").mockResolvedValue(monthlySums);
  vi.spyOn(impactData, "getImpactData").mockResolvedValue(buildImpactData(impactRows()));
  // 10 NOK per USD
  vi.spyOn(exchangeRates, "loadUsdRates").mockResolvedValue({
    currency: "NOK",
    dates: ["2023-01-02"],
    perUsd: [10],
  });
};

describe("tRPC site router", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("resultsHeadline", () => {
    it("returns the headline figures, like GET /results/headline", async () => {
      vi.spyOn(DAO.results, "getHeadlineFigures").mockResolvedValue({
        totalDonationsToRecommendedOrgs: "171484246.36" as any,
        numberOfDonors: 12259,
        lastUpdated: new Date("2026-10-30T05:00:47.000Z") as any,
      });
      const trpc = await anonymous().resultsHeadline();
      expect(trpc).toStrictEqual({
        totalDonationsToRecommendedOrgs: "171484246.36",
        numberOfDonors: 12259,
        lastUpdated: "2026-10-30T05:00:47.000Z",
      });
      const rest = await request(restApp()).get("/results/headline").expect(200);
      expect(trpc).toStrictEqual(rest.body.content);
    });

    it("returns null without figures, like REST", async () => {
      vi.spyOn(DAO.results, "getHeadlineFigures").mockResolvedValue(null);
      expect(await anonymous().resultsHeadline()).toBe(null);
    });

    it("answers null when the analysis database can't be read (the Swedish API)", async () => {
      vi.spyOn(console, "error").mockReturnValue(undefined);
      const warn = vi.spyOn(console, "warn").mockReturnValue(undefined);
      const denied = Object.assign(
        new Error(
          "SELECT command denied to user 'geeffektivt_api'@'x' for table 'Only_rec_orgs_Donations'",
        ),
        { code: "ER_TABLEACCESS_DENIED_ERROR", errno: 1142 },
      );
      vi.spyOn(DAO, "query").mockRejectedValue(denied);
      expect(await anonymous().resultsHeadline()).toBe(null);
      expect(warn).toHaveBeenCalledOnce();
    });

    it("still fails on other database errors", async () => {
      vi.spyOn(console, "error").mockReturnValue(undefined);
      vi.spyOn(DAO, "query").mockRejectedValue(
        Object.assign(new Error("gone"), { code: "ECONNREFUSED" }),
      );
      await expectTrpcError(anonymous().resultsHeadline(), "INTERNAL_SERVER_ERROR");
    });

    it("accepts the Danish backend's headline", () => {
      const dk = {
        totalDonationsToRecommendedOrgs: 13888785,
        numberOfDonors: 1697,
        lastUpdated: "2026-10-30T20:13:15.243Z",
      };
      expect(siteResultsHeadlineOutput.parse(dk)).toStrictEqual(dk);
    });
  });

  describe("without access to the analysis database (the Swedish API)", () => {
    const denyAnalysisDb = () => {
      vi.spyOn(console, "error").mockReturnValue(undefined);
      vi.spyOn(console, "warn").mockReturnValue(undefined);
      vi.spyOn(DAO, "query").mockRejectedValue(
        Object.assign(
          new Error("SELECT command denied to user 'geeffektivt_api'@'x' for table 'OP_ref_data'"),
          { code: "ER_TABLEACCESS_DENIED_ERROR", errno: 1142 },
        ),
      );
    };

    for (const [procedure, path] of [
      ["dailyDonations", "/results/donations/daily"],
      ["referralSums", "/results/referrals/sums"],
      ["monthlyOutputs", "/results/donations/monthly/outputs"],
    ] as const) {
      it(`answers ${procedure} and GET ${path} with no rows`, async () => {
        denyAnalysisDb();
        expect(await anonymous()[procedure]()).toStrictEqual([]);
        const rest = await request(restApp()).get(path).expect(200);
        expect(rest.body.content).toStrictEqual([]);
      });
    }

    it("still fails on other database errors", async () => {
      vi.spyOn(console, "error").mockReturnValue(undefined);
      vi.spyOn(DAO, "query").mockRejectedValue(
        Object.assign(new Error("gone"), { code: "ECONNREFUSED" }),
      );
      await expectTrpcError(anonymous().referralSums(), "INTERNAL_SERVER_ERROR");
      await request(restApp()).get("/results/referrals/sums").expect(500);
    });
  });

  describe("dailyDonations", () => {
    it("returns the sum per day as REST does", async () => {
      const rows = [
        { date: new Date("2016-04-25T00:00:00.000Z"), sum: "375.00" },
        { date: new Date("2016-05-03T00:00:00.000Z"), sum: "25.00" },
      ];
      vi.spyOn(DAO.results, "getDailyDonations").mockResolvedValue(rows);
      const trpc = await anonymous().dailyDonations();
      expect(trpc).toStrictEqual(asJson(rows));
      const rest = await request(restApp()).get("/results/donations/daily").expect(200);
      expect(trpc).toStrictEqual(rest.body.content);
    });

    it("accepts the Danish backend's numbers", () => {
      const dk = [{ date: "2022-05-09T00:00:00.000Z", sum: 5 }];
      expect(siteDailyDonationsOutput.parse(dk)).toStrictEqual(dk);
    });

    it("fails on a sum that is not a number", async () => {
      vi.spyOn(DAO.results, "getDailyDonations").mockResolvedValue([
        { date: new Date(), sum: "<b>" },
      ]);
      await expectTrpcError(anonymous().dailyDonations(), "INTERNAL_SERVER_ERROR");
    });
  });

  describe("referralSums", () => {
    it("returns the yearly referral figures as REST does", async () => {
      vi.spyOn(DAO.results, "getReferralSums").mockResolvedValue([referralSumsRow()]);
      const trpc = await anonymous().referralSums();
      const rest = await request(restApp()).get("/results/referrals/sums").expect(200);
      expect(trpc).toStrictEqual(rest.body.content);
    });

    it("drops columns the page doesn't chart", async () => {
      vi.spyOn(DAO.results, "getReferralSums").mockResolvedValue([
        { ...referralSumsRow(), Secret: 1 },
      ]);
      expect((await anonymous().referralSums())[0]).not.toHaveProperty("Secret");
    });

    it("accepts the Danish backend's (empty) answer", () => {
      expect(siteReferralSumsOutput.parse([])).toStrictEqual([]);
    });
  });

  describe("monthlyOutputs", () => {
    it("computes the same outputs as GET /results/donations/monthly/outputs", async () => {
      stubMonthlyOutputs();
      const trpc = await anonymous().monthlyOutputs();
      const rest = await request(restApp()).get("/results/donations/monthly/outputs").expect(200);
      expect(trpc).toStrictEqual(rest.body.content);
      expect(trpc.map((output) => output.output)).toStrictEqual([
        "Myggnett",
        "Operasjoner",
        "Vitamin A",
      ]);
      const nets = trpc[0];
      // 10000 + 5000 NOK direct at 10 NOK/USD and 200 cents per net, plus 60 % of 3000 NOK via TCF
      expect(nets.total.organizations[0].amf.direct).toStrictEqual({
        sum: 15000,
        numberOfOutputs: 750,
      });
      expect(
        Math.abs(nets.total.organizations[0].amf.smartDistribution.sum - 1800),
      ).toBeLessThanOrEqual(1e-9);
    });

    it("accepts the Danish backend's outputs", () => {
      const dk = [
        {
          output: "Vaccinationsprogrammer",
          total: {
            period: "Total",
            numberOfOutputs: 29566.6,
            organizations: [
              {
                "New Incentives": {
                  direct: { sum: 958085, numberOfOutputs: 8950.8 },
                  smartDistribution: { sum: 2717692, numberOfOutputs: 20608.4 },
                },
              },
            ],
          },
          monthly: [],
        },
      ];
      expect(siteMonthlyOutputsOutput.parse(dk)).toStrictEqual(dk);
    });
  });

  describe("ltvEstimate", () => {
    it("returns the estimates with the median agreement sums, like GET /ltv/recentestimate", async () => {
      vi.spyOn(DAO.results, "getRecentLTV").mockResolvedValue([
        { Label: "AvtaleGiro", Expected_LTV: 86263 },
        { Label: "Vipps", Expected_LTV: 47640 },
      ]);
      vi.spyOn(DAO.avtalegiroagreements, "getAgreementReport").mockResolvedValue({
        medianAgreementSum: "500.00",
      } as any);
      vi.spyOn(DAO.vipps, "getAgreementReport").mockResolvedValue({
        medianAgreementSum: "400",
      } as any);

      const trpc = await anonymous().ltvEstimate();
      expect(trpc).toStrictEqual([
        { label: "AvtaleGiro", expectedLtv: 86263, median: 500 },
        { label: "Vipps", expectedLtv: 47640, median: 400 },
      ]);
      const rest = await request(restApp()).get("/ltv/recentestimate").expect(200);
      expect(trpc).toStrictEqual(rest.body.content);
    });

    it("gives no median when a report is missing", async () => {
      vi.spyOn(DAO.results, "getRecentLTV").mockResolvedValue([
        { Label: "Vipps", Expected_LTV: 1 },
      ]);
      vi.spyOn(DAO.avtalegiroagreements, "getAgreementReport").mockResolvedValue(false);
      vi.spyOn(DAO.vipps, "getAgreementReport").mockResolvedValue(false);
      expect(await anonymous().ltvEstimate()).toStrictEqual([
        { label: "Vipps", expectedLtv: 1, median: null },
      ]);
    });
  });

  describe("fundraiser", () => {
    const fundraiser = () => ({
      totalSum: 1500,
      donationCount: 2,
      transactions: [
        {
          id: 2,
          name: "Kari",
          message: "Lykke til!",
          amount: 1000,
          date: new Date("2025-12-01T10:00:00.000Z"),
          recurring: true,
        },
        {
          id: 1,
          name: null,
          message: null,
          amount: 500,
          date: new Date("2025-11-30T09:00:00Z"),
          recurring: false,
        },
      ],
    });

    it("returns the totals and gifts, like GET /fundraisers/:id", async () => {
      const getFundraiserByID = vi
        .spyOn(DAO.fundraisers, "getFundraiserByID")
        .mockResolvedValue(fundraiser());
      const trpc = await anonymous().fundraiser({ id: 11 });
      expect(getFundraiserByID.mock.calls[0]).toStrictEqual([11]);
      const rest = await request(restApp()).get("/fundraisers/11").expect(200);
      expect(trpc).toStrictEqual(rest.body.content);
      expect(trpc.transactions[0].date).toBe("2025-12-01T10:00:00.000Z");
    });

    it("takes the id as a string of digits too, as Sanity stores some", async () => {
      const getFundraiserByID = vi
        .spyOn(DAO.fundraisers, "getFundraiserByID")
        .mockResolvedValue(fundraiser());
      await anonymous().fundraiser({ id: "37" });
      expect(getFundraiserByID.mock.calls[0]).toStrictEqual([37]);
    });

    it("accepts the Danish backend's fundraiser (UUID transaction ids)", () => {
      const dk = {
        totalSum: 4250,
        donationCount: 1,
        transactions: [
          {
            id: "0b8a6f3e-1d2c-4b5a-9e8f-7a6b5c4d3e2f",
            name: null,
            message: null,
            amount: 4250,
            date: "2025-12-10T11:12:08.523Z",
          },
        ],
      };
      expect(siteFundraiserOutput.parse(dk)).toStrictEqual(dk);
    });

    it("answers NOT_FOUND for an unknown fundraiser", async () => {
      vi.spyOn(DAO.fundraisers, "getFundraiserByID").mockResolvedValue(null);
      await expectTrpcError(
        anonymous().fundraiser({ id: 11 }),
        "NOT_FOUND",
        "Fundraiser not found",
      );
    });

    for (const id of [0, -1, 1.5, 2147483648, "", "1e3", "12abc", " 12", { $gt: 0 }, null]) {
      it(`refuses the id ${JSON.stringify(id)} without querying`, async () => {
        const getFundraiserByID = vi
          .spyOn(DAO.fundraisers, "getFundraiserByID")
          .mockResolvedValue(null);
        await expectTrpcError(anonymous().fundraiser({ id } as any), "BAD_REQUEST");
        expect(getFundraiserByID).not.toHaveBeenCalled();
      });
    }

    it("refuses extra input fields", async () => {
      await expectTrpcError(anonymous().fundraiser({ id: 1, secret: "x" } as any), "BAD_REQUEST");
    });
  });

  describe("over HTTP", () => {
    let app: express.Express;

    beforeEach(() => {
      app = express();
      mountTrpc(app);
    });

    it("answers anonymous GETs", async () => {
      vi.spyOn(DAO.results, "getHeadlineFigures").mockResolvedValue(null);
      const res = await request(app).get("/trpc/site.resultsHeadline").expect(200);
      expect(res.body.result.data).toBe(null);
    });

    it("answers 400 to a bad fundraiser id and 404 to an unknown one", async () => {
      const getFundraiserByID = vi
        .spyOn(DAO.fundraisers, "getFundraiserByID")
        .mockResolvedValue(null);
      await request(app)
        .get(`/trpc/site.fundraiser?input=${encodeURIComponent('{"id":"1 OR 1=1"}')}`)
        .expect(400);
      expect(getFundraiserByID).not.toHaveBeenCalled();
      await request(app)
        .get(`/trpc/site.fundraiser?input=${encodeURIComponent('{"id":11}')}`)
        .expect(404);
    });

    it("masks database errors", async () => {
      vi.spyOn(console, "error").mockReturnValue(undefined);
      vi.spyOn(DAO.results, "getDailyDonations").mockRejectedValue(
        new Error("ER_ACCESS_DENIED for user x"),
      );
      const res = await request(app).get("/trpc/site.dailyDonations").expect(500);
      expect(JSON.stringify(res.body)).not.toContain("ER_ACCESS_DENIED");
    });
  });

  describe("organizations", () => {
    const rows = [
      {
        id: 1,
        name: "Against Malaria Foundation",
        widgetDisplayName: null,
        widgetContext: null,
        abbreviation: "AMF",
        shortDescription: "Myggnett",
        longDescription: "",
        standardShare: 0,
        informationUrl: "https://gieffektivt.no/amf",
        isActive: true,
        ordering: 1,
        causeAreaId: 1,
        chartColor: null,
      },
      {
        id: 7,
        name: "Deworm the World",
        widgetDisplayName: null,
        widgetContext: null,
        abbreviation: "DtW",
        shortDescription: null,
        longDescription: null,
        standardShare: 0,
        informationUrl: null,
        isActive: false,
        ordering: 9,
        causeAreaId: 1,
        chartColor: null,
      },
    ];

    it("returns every organization, inactive ones included, like GET /organizations/all", async () => {
      vi.spyOn(DAO.organizations, "getAll").mockResolvedValue(rows as any);
      const trpc = await anonymous().organizations();
      const rest = await request(restApp()).get("/organizations/all").expect(200);
      // REST also sends chartColor, which Min Side doesn't read
      expect(trpc).toStrictEqual(
        rest.body.content.map(({ chartColor, ...org }: { chartColor: unknown }) => org),
      );
      expect(trpc.map((org) => org.isActive)).toStrictEqual([true, false]);
    });

    it("accepts the Danish backend's organizations", () => {
      // giveffektivt/donation-platform app/organizations/all (buildOrganizations in norway-shim)
      const dk = [
        {
          id: -1,
          name: "Smart fordeling",
          widgetDisplayName: null,
          widgetContext: null,
          shortDescription: "Din donation fordeles efter Giv Effektivts anbefalinger",
          longDescription: "Din donation fordeles efter Giv Effektivts anbefalinger",
          informationUrl: "/smart-fordeling",
          standardShare: 100,
          isActive: true,
          ordering: 1,
          causeAreaId: -1,
        },
      ];
      expect(siteOrganizationsOutput.parse(dk)).toStrictEqual(dk);
    });
  });

  it("keeps the shared schemas free of backend imports (apps/web bundles them)", () => {
    const source = readFileSync(join(__dirname, "../trpc/shared/site.ts"), "utf8");
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(imports).toStrictEqual(["zod"]);
  });
});
