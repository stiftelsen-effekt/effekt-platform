import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import express from "express";
import request from "supertest";
import { DAO } from "../custom_modules/DAO";
import { donationHelpers } from "../custom_modules/donationHelpers";
import paymentMethods from "../enums/paymentMethods";
import methods from "../enums/methods";
import donationsRouter from "../routes/donations";

describe("donations", () => {
  describe("routes", () => {
    let server: express.Express;

    beforeEach(() => {
      server = express();
      server.use(express.json());
      server.use(express.urlencoded({ extended: true }));
      server.use("/donations", donationsRouter);
    });

    describe("POST /donations/register", () => {
      let donorsGetIDByEmailStub: MockInstance;
      let donorsGetByIDStub: MockInstance;
      let donorsAddStub: MockInstance;
      let addTaxUnitStub: MockInstance;
      let taxGetByDonorIdAndSsnStub: MockInstance;
      let createKIDStub: MockInstance;
      let distributionsGetStandardDistributionByCauseAreaIDStub: MockInstance;
      let distributionsGetKIDBySplitStub: MockInstance;
      let addReferralCodeStub: MockInstance;

      function withDonor(
        donor: Partial<Awaited<ReturnType<typeof DAO.donors.getByID>>> | null,
      ): void {
        donorsGetIDByEmailStub.mockResolvedValue(donor ? donor.id : null);
        donorsGetByIDStub.mockResolvedValue(donor);
      }

      function withCauseAreaStandardDistribution(
        distribution: Awaited<
          ReturnType<typeof DAO.distributions.getStandardDistributionByCauseAreaID>
        >,
      ): void {
        distributionsGetStandardDistributionByCauseAreaIDStub.mockReturnValue(distribution);
      }

      function withCreatedKID(KID: string) {
        createKIDStub.mockResolvedValue(KID);
      }

      function withDistributionsKID(KID?: string) {
        distributionsGetKIDBySplitStub.mockResolvedValue(KID);
      }

      function withTaxUnit(
        taxUnit: Partial<Awaited<ReturnType<typeof DAO.tax.getByDonorIdAndSsn>>> | null,
      ) {
        taxGetByDonorIdAndSsnStub.mockResolvedValue(taxUnit);
      }

      beforeEach(() => {
        donorsGetIDByEmailStub = vi
          .spyOn(DAO.donors, "getIDbyEmail")
          .mockReturnValue(undefined as any);
        donorsGetByIDStub = vi.spyOn(DAO.donors, "getByID").mockReturnValue(undefined as any);
        donorsAddStub = vi.spyOn(DAO.donors, "add").mockReturnValue(undefined as any);
        addTaxUnitStub = vi.spyOn(DAO.tax, "addTaxUnit").mockReturnValue(undefined as any);
        distributionsGetStandardDistributionByCauseAreaIDStub = vi
          .spyOn(DAO.distributions, "getStandardDistributionByCauseAreaID")
          .mockReturnValue(undefined as any);
        createKIDStub = vi.spyOn(donationHelpers, "createKID").mockReturnValue(undefined as any);
        distributionsGetKIDBySplitStub = vi
          .spyOn(DAO.distributions, "getKIDbySplit")
          .mockReturnValue(undefined as any);
        vi.spyOn(DAO.distributions, "add").mockReturnValue(undefined as any);
        vi.spyOn(DAO.initialpaymentmethod, "addPaymentIntent").mockReturnValue(undefined as any);
        taxGetByDonorIdAndSsnStub = vi
          .spyOn(DAO.tax, "getByDonorIdAndSsn")
          .mockReturnValue(undefined as any);
        addReferralCodeStub = vi
          .spyOn(DAO.donationReferralCodes, "add")
          .mockReturnValue(undefined as any);

        withDonor(null);
        withCauseAreaStandardDistribution([]);
        withDistributionsKID();
      });

      it("should add a new donor if donor does not exist", async () => {
        const body = {
          distributionCauseAreas: [
            {
              id: 1,
              standardSplit: false,
              percentageShare: 100,
              organizations: [
                {
                  id: 1,
                  percentageShare: 100,
                },
              ],
            },
          ],
          donor: {
            email: "test@example.com",
            name: "Test Testsson",
            newsletter: true,
          },
          method: methods.BANK,
          amount: 100,
          recurring: false,
        };
        const response = await request(server).post("/donations/register").send(body).expect(200);

        expect(donorsAddStub).toHaveBeenCalledOnce();
        expect(donorsAddStub.mock.calls[0][0]).toStrictEqual({
          email: body.donor.email,
          full_name: body.donor.name,
          newsletter: body.donor.newsletter,
        });

        expect(response.body).toStrictEqual({
          content: {
            hasAnsweredReferral: false,
            registrationToken: null,
            paymentProviderUrl: "",
          },
          status: 200,
        });
      });

      it("should add tax unit to added donor", async () => {
        const donorId = 123;
        donorsAddStub.mockResolvedValue(donorId);

        const body = {
          distributionCauseAreas: [
            {
              id: 1,
              standardSplit: false,
              percentageShare: 100,
              organizations: [
                {
                  id: 1,
                  percentageShare: 100,
                },
              ],
            },
          ],
          donor: {
            name: "Test Testsson",
            email: "test@testeson.no",
            ssn: "15019010063",
          },
          method: methods.BANK,
          amount: 100,
          recurring: false,
        };
        await request(server).post("/donations/register").send(body).expect(200);

        expect(addTaxUnitStub).toHaveBeenCalledOnce();
        expect(addTaxUnitStub.mock.calls[0][0]).toBe(donorId);
        expect(addTaxUnitStub.mock.calls[0][1]).toBe(body.donor.ssn);
        expect(addTaxUnitStub.mock.calls[0][2]).toBe(body.donor.name);
      });

      it("should not add tax unit if donor already has one", async () => {
        withTaxUnit({});
        withDonor({ id: 123 });

        const body = {
          distributionCauseAreas: [
            {
              id: 1,
              standardSplit: false,
              percentageShare: 100,
              organizations: [
                {
                  id: 1,
                  percentageShare: 100,
                },
              ],
            },
          ],
          donor: {
            name: "Test Testsson",
            email: "test@testesen.no",
            ssn: "15019010063",
          },
          method: methods.BANK,
          amount: 100,
          recurring: false,
        };
        await request(server).post("/donations/register").send(body).expect(200);

        expect(addTaxUnitStub).not.toHaveBeenCalled();
      });

      it("should return 400 for the discontinued Swish and AutoGiro methods", async () => {
        for (const method of [paymentMethods.swish, paymentMethods.autoGiro]) {
          await request(server)
            .post("/donations/register")
            .send({
              distributionCauseAreas: [],
              method,
              amount: 100,
              recurring: false,
              donor: { email: "test@testesen.no", name: "Test Testesen", newsletter: false },
            })
            .expect(400);
        }
        expect(createKIDStub).not.toHaveBeenCalled();
      });

      it("should return 400 if missing body", async () => {
        await request(server).post("/donations/register").send(undefined).expect(400);
      });

      it("should store a referral code against the KID", async () => {
        const KID = "87397824";
        withCreatedKID(KID);

        const body = {
          distributionCauseAreas: [
            {
              id: 1,
              standardSplit: false,
              percentageShare: 100,
              organizations: [
                {
                  id: 1,
                  percentageShare: 100,
                },
              ],
            },
          ],
          donor: {
            email: "test@example.com",
            name: "Test Testsson",
            newsletter: false,
          },
          method: methods.BANK,
          amount: 100,
          recurring: false,
          referralCode: "  match-2026  ",
        };

        await request(server).post("/donations/register").send(body).expect(200);

        expect(addReferralCodeStub).toHaveBeenCalledOnce();
        expect(addReferralCodeStub.mock.calls[0]).toStrictEqual([KID, "match-2026"]);
      });

      it("should not store a referral code when it is missing", async () => {
        withCreatedKID("87397824");

        const body = {
          distributionCauseAreas: [
            {
              id: 1,
              standardSplit: false,
              percentageShare: 100,
              organizations: [
                {
                  id: 1,
                  percentageShare: 100,
                },
              ],
            },
          ],
          donor: {
            email: "test@example.com",
            name: "Test Testsson",
            newsletter: false,
          },
          method: methods.BANK,
          amount: 100,
          recurring: false,
        };

        await request(server).post("/donations/register").send(body).expect(200);

        expect(addReferralCodeStub).not.toHaveBeenCalled();
      });

      it("should return 400 if the referral code is too long", async () => {
        await request(server)
          .post("/donations/register")
          .send({
            distributionCauseAreas: [
              {
                id: 1,
                standardSplit: false,
                percentageShare: 100,
                organizations: [{ id: 1, percentageShare: 100 }],
              },
            ],
            donor: {
              email: "test@example.com",
              name: "Test Testsson",
              newsletter: false,
            },
            method: methods.BANK,
            amount: 100,
            recurring: false,
            referralCode: "x".repeat(129),
          })
          .expect(400);
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
