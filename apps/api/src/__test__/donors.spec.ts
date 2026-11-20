import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import express from "express";
import { InvalidTokenError } from "express-oauth2-jwt-bearer";
import request from "supertest";
import * as authMiddleware from "../custom_modules/authorization/authMiddleware";
import { DAO } from "../custom_modules/DAO";
import * as auth0 from "../custom_modules/auth0";
import { getYearlyTaxReports } from "../custom_modules/taxReports";
import { RequestLocale } from "../middleware/locale";

let donorUpdateStub: MockInstance;
let agreementStub: MockInstance;
let donorStub: MockInstance;

const jack = {
  id: 237,
  name: "Jack Torrance",
  email: "jack@overlookhotel.com",
  newsletter: true,
  trash: false,
  registered: "1921-07-04T23:00:00.000Z",
};

const donationsStub = [
  {
    id: 217,
    donor: "Jack Torance",
    donorId: 237,
    email: "jack@overlookhotel.com",
    sum: "100.00",
    transactionCost: "2.00",
    method: "Bank",
    KID: "00009912345678",
    registered: "2018-03-29T23:00:00.000Z",
    $$ref: "#/components/schemas/Donation/example",
  },
  {
    id: 456,
    donor: "Jack Torance",
    donorId: 237,
    email: "jack@overlookhotel.com",
    sum: "399.00",
    transactionCost: "2.00",
    method: "Bank",
    KID: "000094567886",
    registered: "2020-08-05T19:00:00.000Z",
    $$ref: "#/components/schemas/Donation/example",
  },
];

const mockAgreements = [
  {
    id: 1,
    KID: "002556289731589",
    claimDate: 10,
    amount: 50000,
    notice: true,
    active: true,
  },
  {
    id: 2,
    KID: "000638723319577",
    claimDate: 10,
    amount: 340000,
    notice: false,
    active: true,
  },
  {
    id: 3,
    KID: "000675978627833",
    claimDate: 10,
    amount: 5000000,
    notice: true,
    active: true,
  },
];

const mockAgreementsVipps = [
  {
    ID: "29",
    donorID: 237,
    KID: "986532",
    sum: 500,
    status: "active",
    monthly_charge_day: 5,
    agreement_url_code: "vipps/hello",
    paused_until_date: "04.05.22",
    force_charge_date: "false",
  },
  {
    ID: "58",
    donorID: 237,
    KID: "8764723",
    sum: 4000,
    status: "active",
    monthly_charge_day: 2,
    agreement_url_code: "vipps/test",
    paused_until_date: "07.02.22",
    force_charge_date: "true",
  },
];

describe("donors", () => {
  describe("routes", () => {
    let server: express.Express;

    beforeEach(function () {
      server = express();
      server.use(express.json());
      server.use(express.urlencoded({ extended: true }));

      // This must be stubbed before importing the routes
      vi.spyOn(authMiddleware, "auth").mockReturnValue([]);
      vi.spyOn(authMiddleware, "isAdmin", "get").mockReturnValue([] as any);

      const donorsRouter = require("../routes/donors");
      server.use("/donors", donorsRouter);

      vi.spyOn(authMiddleware, "checkAdminOrTheDonor").mockImplementation((_, req, res, next) => {
        next();
      });
    });

    describe("GET /donors/:id/donations", function () {
      beforeEach(function () {
        donorStub = vi
          .spyOn(DAO.donors, "getByID")
          .mockImplementation(async (id) => (id === "237" ? (jack as any) : undefined));

        vi.spyOn(DAO.donations, "getByDonorId").mockImplementation(async (id) =>
          id === "237" ? (donationsStub as any) : undefined,
        );
      });

      it("Should return 200 OK with the dontions by ID", async function () {
        await request(server).get("/donors/237/donations").expect(200);
      });

      it("Should return the donations", async function () {
        const response = await request(server).get("/donors/237/donations");
        expect(response.body.content).toStrictEqual(donationsStub);
      });
    });

    describe("GET /donors/:id", function () {
      beforeEach(function () {
        donorStub = vi
          .spyOn(DAO.donors, "getByID")
          .mockImplementation(async (id) => (id === "237" ? (jack as any) : undefined));

        donorUpdateStub = vi.spyOn(DAO.donors, "update").mockReturnValue(undefined as any);
      });

      it("Should return 200 OK with the donor by ID", async function () {
        await request(server).get("/donors/237").expect(200);
      });

      it("Should return a donor that matches the provided id", async function () {
        const response = await request(server).get("/donors/237");
        expect(response.body.content).toStrictEqual(jack);
      });
    });

    describe("PUT /donors/:id", () => {
      beforeEach(function () {
        donorStub = vi
          .spyOn(DAO.donors, "getByID")
          .mockImplementation(async (id) => (id === "237" ? (jack as any) : undefined));

        donorUpdateStub = vi.spyOn(DAO.donors, "update").mockReturnValue(undefined as any);
      });

      it("Should return 404 when donor is not found", async function () {
        donorStub.mockImplementation(async (id) =>
          id === "237" ? (jack as any) : id === "123" ? null : undefined,
        );
        const response = await request(server).put("/donors/123");
        expect(response.status).toBe(404);
      });

      it("Should update donor", async function () {
        donorUpdateStub.mockResolvedValue(true);
        const response = await request(server).put("/donors/237").send(jack);
        expect(response.status).toBe(200);
        expect(donorUpdateStub).toHaveBeenCalledTimes(1);
      });

      it("Should return 400 when name is not a string", async function () {
        donorUpdateStub.mockResolvedValue(true);
        const response = await request(server).put("/donors/237").send({
          name: 1010,
        });
        expect(response.status).toBe(400);
        expect(donorUpdateStub).toHaveBeenCalledTimes(0);
      });

      it("Should return 200 when updating name", async function () {
        donorUpdateStub.mockResolvedValue(true);
        const response = await request(server).put("/donors/237").send({
          name: "Jack Torrance",
        });
        expect(response.status).toBe(200);
        expect(donorUpdateStub).toHaveBeenCalledTimes(1);
      });

      it("Should return 400 when newsletter is not a boolean", async function () {
        donorUpdateStub.mockResolvedValue(true);
        const response = await request(server).put("/donors/237").send({
          name: "Jack Torrance",
          newsletter: "Yes",
        });
        expect(response.status).toBe(400);
        expect(donorUpdateStub).toHaveBeenCalledTimes(0);
      });
    });

    describe("PUT /donors/:id/taxunits/:taxunitid", () => {
      let taxGetByIdStub: MockInstance;
      let updateTaxUnitStub: MockInstance;

      beforeEach(function () {
        donorStub = vi
          .spyOn(DAO.donors, "getByID")
          .mockImplementation(async (id) => (id === 237 ? (jack as any) : undefined));
        taxGetByIdStub = vi.spyOn(DAO.tax, "getById").mockReturnValue(undefined as any);
        updateTaxUnitStub = vi.spyOn(DAO.tax, "updateTaxUnit").mockResolvedValue(1);
      });

      const body = { taxUnit: { name: "Jack Torrance", ssn: "999999999" } };

      it("Should update a tax unit owned by the donor", async function () {
        taxGetByIdStub.mockImplementation(async (id) =>
          id === 10 ? { id: 10, donorId: 237, name: "x", ssn: "1" } : undefined,
        );
        const response = await request(server).put("/donors/237/taxunits/10").send(body);
        expect(response.status).toBe(200);
        // Called once, with 10 as the first argument (the update follows)
        expect(updateTaxUnitStub).toHaveBeenCalledOnce();
        expect(updateTaxUnitStub.mock.calls[0].slice(0, 1)).toStrictEqual([10]);
      });

      it("Should return 404 and not update a tax unit owned by another donor", async function () {
        taxGetByIdStub.mockImplementation(async (id) =>
          id === 11 ? { id: 11, donorId: 999, name: "x", ssn: "1" } : undefined,
        );
        const response = await request(server).put("/donors/237/taxunits/11").send(body);
        expect(response.status).toBe(404);
        expect(updateTaxUnitStub).not.toHaveBeenCalled();
      });

      it("Should return 404 when the tax unit does not exist", async function () {
        taxGetByIdStub.mockResolvedValue(null);
        const response = await request(server).put("/donors/237/taxunits/12").send(body);
        expect(response.status).toBe(404);
        expect(updateTaxUnitStub).not.toHaveBeenCalled();
      });
    });

    describe("GET /donors/:id/recurring/avtalegiro", function () {
      beforeEach(function () {
        agreementStub = vi
          .spyOn(DAO.avtalegiroagreements, "getByDonorId")
          .mockReturnValue(undefined as any);
        agreementStub.mockResolvedValue(mockAgreements);
      });

      it("Should return 200 OK", async function () {
        await request(server).get("/donors/237/recurring/avtalegiro").expect(200);
      });

      it("Should return the agreements", async function () {
        const response = await request(server).get("/donors/237/recurring/avtalegiro");
        expect(response.body.content).toStrictEqual(mockAgreements);
      });
    });

    describe("GET /donors/:id/recurring/vipps", function () {
      beforeEach(function () {
        agreementStub = vi
          .spyOn(DAO.vipps, "getAgreementsByDonorId")
          .mockReturnValue(undefined as any);
        agreementStub.mockResolvedValue(mockAgreementsVipps);
      });

      it("Should return 200 OK", async function () {
        await request(server).get("/donors/237/recurring/vipps").expect(200);
      });

      it("Should return the agreements without their url codes", async function () {
        const response = await request(server).get("/donors/237/recurring/vipps");
        expect(response.body.content).toStrictEqual(
          mockAgreementsVipps.map(({ agreement_url_code, ...agreement }) => agreement),
        );
      });
    });

    describe("GET /donors/:id/donations/aggregated", function () {
      let aggregatedByIdStub: MockInstance;

      const mockDonations = [
        {
          ID: 1,
          causeAreaID: 1,
          organization: "Against Malaria Foundation",
          abbriv: "AMF",
          chartColor: null,
          value: "18.000000000000000000",
          year: 2022,
        },
        {
          ID: 2,
          causeAreaID: 1,
          organization: "Røde Kors",
          abbriv: "RK",
          chartColor: null,
          value: "100.000000000000000000",
          year: 2018,
        },
        {
          ID: 45,
          causeAreaID: 1,
          organization: "Realfagbygget",
          abbriv: "A4",
          chartColor: null,
          value: "250.000000000000000000",
          year: 2022,
        },
        {
          ID: 11,
          causeAreaID: 1,
          organization: "SOS Barnebyer",
          abbriv: "SOS",
          chartColor: null,
          value: "250.000000000000000000",
          year: 2022,
        },
        {
          ID: 60,
          causeAreaID: 1,
          organization: "Barnekreftforeningen",
          abbriv: "BKF",
          chartColor: null,
          value: "390.000000000000000000",
          year: 2019,
        },
      ];

      beforeEach(() => {
        aggregatedByIdStub = vi
          .spyOn(DAO.donations, "getYearlyAggregateByDonorId")
          .mockResolvedValue(mockDonations);
      });

      it("Gets all the donations of a donor by ID", async function () {
        aggregatedByIdStub.mockResolvedValue(mockDonations);

        const response = await request(server).get("/donors/2349/donations/aggregated").expect(200);

        let donations = response.body.content;
        expect(donations).toHaveLength(5);
        for (var i = 0; i < donations.length; i++) {
          expect(donations[i].ID).toBeTypeOf("number");
          expect(donations[i].organization).toBeTypeOf("string");
          expect(donations[i].abbriv).toBeTypeOf("string");
          expect(donations[i].value).toBeTypeOf("string");
          expect(donations[i].year).toBeTypeOf("number");
        }
      });

      it("Donor doesn't have donations", async function () {
        aggregatedByIdStub.mockImplementation(async (id) => (id === "2349" ? [] : mockDonations));

        const response = await request(server).get("/donors/2349/donations/aggregated").expect(200);

        expect(response.body.content).toHaveLength(0);
      });

      it("Donor ID doesn't exist", async function () {
        try {
          vi.spyOn(authMiddleware, "checkAdminOrTheDonor").mockImplementation(() => {
            throw new InvalidTokenError("Unexpected 'https://gieffektivt.no/user-id' value");
          });

          await request(server).get("/donors/1/donations/aggregated").expect(401);
        } catch (ex) {
          expect(ex).not.toBeUndefined();
        }
      });
    });

    describe("getYearlyTaxReports (minside.taxReports)", function () {
      const donation = (
        id: number,
        sum: string,
        taxUnitId: number | null,
        metaOwnerId: number,
      ) => ({
        id,
        donor: jack.name,
        donorId: jack.id,
        email: jack.email,
        sum,
        transactionCost: "0",
        timestamp: "2024-06-01T10:00:00.000Z",
        paymentMethod: "Bank",
        KID: "000012345678",
        taxUnitId,
        metaOwnerId,
      });

      beforeEach(function () {
        vi.spyOn(DAO.tax, "getByDonorId").mockResolvedValue([
          {
            id: 10,
            donorId: jack.id,
            name: "Jack Torrance",
            ssn: "12345678910",
            registered: "2020-01-01T00:00:00.000Z",
            archived: null,
            sumDonations: "3000",
            numDonations: 2,
            taxDeductions: [],
          },
        ] as any);

        // Owner 2 (EA Norge) donations are returned by both getByDonorId and getEAFundsDonations
        vi.spyOn(DAO.donations, "getByDonorId").mockResolvedValue([
          donation(1, "1000.00", 10, 3),
          donation(2, "2000.00", 10, 2),
          donation(3, "300.00", null, 3),
          donation(4, "500.00", null, 2),
        ] as any);

        vi.spyOn(DAO.donations, "getEAFundsDonations").mockResolvedValue([
          {
            id: 2,
            donorId: jack.id,
            taxUnitId: 10,
            sum: "2000.00",
            timestamp: "2024-06-01T10:00:00.000Z",
            paymentExternalId: "EAN.1",
          },
          {
            id: 4,
            donorId: jack.id,
            taxUnitId: null,
            sum: "500.00",
            timestamp: "2024-06-01T10:00:00.000Z",
            paymentExternalId: "EAN.2",
          },
        ]);
      });

      it("counts EA Norge donations once, as EAN Giverportal", async function () {
        const reports = await getYearlyTaxReports(237, RequestLocale.NO);

        const report = reports.find((r) => r.year === 2024)!;
        expect(report).not.toBeUndefined();

        expect(report.units).toHaveLength(1);
        expect(report.units[0].sumDonations).toBe(3000);
        expect(report.units[0].channels).toStrictEqual([
          { channel: "Gi Effektivt", sumDonations: 1000 },
          { channel: "EAN Giverportal", sumDonations: 2000 },
        ]);
        expect(report.sumDonations).toBe(3000);

        expect(report.sumDonationsWithoutTaxUnit).toStrictEqual({
          sumDonations: 800,
          channels: [
            { channel: "Gi Effektivt", sumDonations: 300 },
            { channel: "EAN Giverportal", sumDonations: 500 },
          ],
        });
      });
    });

    describe("POST /donors/:originId/merge/:destinationId", function () {
      const origin = {
        id: 100,
        name: "Origin Donor",
        email: "origin@overlookhotel.com",
        newsletter: false,
        trash: false,
        registered: "1921-07-04T23:00:00.000Z",
      };
      const destination = {
        id: 200,
        name: "Destination Donor",
        email: "destination@overlookhotel.com",
        newsletter: false,
        trash: false,
        registered: "1921-07-04T23:00:00.000Z",
      };

      let getByIDStub: MockInstance;
      let mergeStub: MockInstance;
      let repointStub: MockInstance;

      beforeEach(function () {
        getByIDStub = vi
          .spyOn(DAO.donors, "getByID")
          .mockImplementation(async (id) =>
            id === 100 ? (origin as any) : id === 200 ? destination : undefined,
          );
        mergeStub = vi.spyOn(DAO.donors, "mergeDonors").mockResolvedValue(undefined);
        repointStub = vi.spyOn(auth0, "repointAuth0DonorIdOnMerge").mockResolvedValue({
          updated: [],
          skipped: [],
        });
      });

      it("re-points Auth0 before merging the donors", async function () {
        const response = await request(server).post("/donors/100/merge/200").expect(200);

        expect(response.body.content).toBe(true);
        expect(repointStub).toHaveBeenCalledExactlyOnceWith(100, 200, origin.email);
        expect(mergeStub).toHaveBeenCalledExactlyOnceWith(100, 200);
        expect(repointStub).toHaveBeenCalledBefore(mergeStub);
      });

      it("still merges when Auth0 re-pointing fails", async function () {
        vi.spyOn(console, "error").mockReturnValue(undefined);
        repointStub.mockRejectedValue(new Error("Auth0 unavailable"));

        const response = await request(server).post("/donors/100/merge/200").expect(200);

        expect(response.body.content).toBe(true);
        expect(mergeStub).toHaveBeenCalledOnce();
      });

      it("returns 400 when merging a donor into itself", async function () {
        await request(server).post("/donors/100/merge/100").expect(400);

        expect(mergeStub).not.toHaveBeenCalled();
        expect(repointStub).not.toHaveBeenCalled();
      });

      it("returns 404 when a donor is missing", async function () {
        getByIDStub.mockImplementation(async (id) =>
          id === 100 ? (origin as any) : id === 200 ? null : undefined,
        );

        await request(server).post("/donors/100/merge/200").expect(404);

        expect(mergeStub).not.toHaveBeenCalled();
        expect(repointStub).not.toHaveBeenCalled();
      });
    });
  });

  afterEach(function () {
    vi.restoreAllMocks();
  });
});
