import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import express, { type Request, type Response } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import { DAO } from "../custom_modules/DAO";
import { donorImpact } from "../custom_modules/impact/donations";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { mountTrpc } from "../trpc/express";
import { appRouter } from "../trpc/router";
import { createCallerFactory } from "../trpc/trpc";

const config = require("../config");

const createCaller = createCallerFactory(appRouter);

/** A verified token's payload: permissions plus, for a donor, the user id claim */
const callerWith = (payload?: { permissions: string[]; donorId?: number }) =>
  createCaller({
    req: {} as Request,
    res: {} as Response,
    auth: payload
      ? {
          permissions: payload.permissions,
          ...(payload.donorId !== undefined
            ? { [String(config.authUserIdClaim)]: payload.donorId }
            : {}),
        }
      : undefined,
  });

const theDonor = () => callerWith({ permissions: ["read:donations"], donorId: 7 });

type Caller = ReturnType<typeof callerWith>;

const expectTrpcError = async (promise: Promise<unknown>, code: string) => {
  try {
    await promise;
    expect.unreachable(`expected ${code}`);
  } catch (err: any) {
    expect(err.code).toBe(code);
  }
};

const dbDonor = {
  id: 7,
  name: "Jack Torrence",
  email: "jack@overlookhotel.com",
  registered: new Date("2020-01-01T00:00:00.000Z"),
  newsletter: true,
  trash: 0,
};

describe("tRPC minside router", () => {
  let getByID: MockInstance;
  let getDonationImpacts: MockInstance;

  beforeEach(() => {
    getByID = vi.spyOn(DAO.donors, "getByID").mockResolvedValue(dbDonor as any);
    // minside.donations adds impact; without figures (an empty map) the donations stay as they are
    getDonationImpacts = vi.spyOn(donorImpact, "getDonationImpacts").mockResolvedValue(new Map());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("profile", () => {
    it("rejects anonymous callers", async () => {
      await expectTrpcError(callerWith().minside.profile({ donorId: 7 }), "UNAUTHORIZED");
      expect(getByID).not.toHaveBeenCalled();
    });

    it("rejects another donor", async () => {
      await expectTrpcError(theDonor().minside.profile({ donorId: 8 }), "FORBIDDEN");
      expect(getByID).not.toHaveBeenCalled();
    });

    it("rejects the donor without the read:donations permission", async () => {
      await expectTrpcError(
        callerWith({ permissions: ["read:profile"], donorId: 7 }).minside.profile({ donorId: 7 }),
        "FORBIDDEN",
      );
      expect(getByID).not.toHaveBeenCalled();
    });

    it("rejects ids that are not positive integers", async () => {
      for (const donorId of [1.5, 0, -7, "7", "1.2e4"]) {
        await expectTrpcError(theDonor().minside.profile({ donorId } as any), "BAD_REQUEST");
      }
      expect(getByID).not.toHaveBeenCalled();
    });

    it("returns the profile to the donor, with only the declared fields", async () => {
      const profile = await theDonor().minside.profile({ donorId: 7 });
      expect(profile).toStrictEqual({
        id: 7,
        name: "Jack Torrence",
        email: "jack@overlookhotel.com",
        newsletter: true,
        registered: "2020-01-01T00:00:00.000Z",
      });
      expect(getByID).toHaveBeenCalledExactlyOnceWith(7);
    });

    it("returns any donor's profile to an admin", async () => {
      const profile = await callerWith({
        permissions: ["read:donations", "admin"],
      }).minside.profile({ donorId: 7 });
      expect(profile.id).toBe(7);
    });

    it("answers NOT_FOUND for a missing donor", async () => {
      getByID.mockResolvedValue(null);
      await expectTrpcError(theDonor().minside.profile({ donorId: 7 }), "NOT_FOUND");
    });
  });

  describe("read-only Min Side procedures", () => {
    const dbTaxUnit = {
      id: 3,
      donorId: 7,
      name: "Jack Torrence",
      ssn: "12345678901",
      registered: new Date("2021-02-03T04:05:06.000Z"),
      archived: null,
      sumDonations: "1500",
      numDonations: 2,
      taxDeductions: [{ year: 2021, sumDonations: 1500, deduction: 1500, benefit: 330 }],
    };
    const dbAggregate = {
      ID: 12,
      organization: "Against Malaria Foundation",
      abbriv: "AMF",
      causeAreaID: 1,
      chartColor: "chart-1",
      value: "750.000000",
      year: 2023,
    };
    const dbDonation = {
      id: 101,
      donor: "Jack Torrence",
      donorId: 7,
      email: "jack@overlookhotel.com",
      sum: "1000.00",
      transactionCost: "2.00",
      timestamp: new Date("2023-05-06T07:08:09.000Z"),
      paymentMethod: "Bank",
      KID: "000007000000017",
      taxUnitId: 3,
      metaOwnerId: 3,
    };
    const distribution = (kid: string) => ({
      kid,
      donorId: 7,
      taxUnitId: 3,
      fundraiserTransactionId: undefined,
      causeAreas: [
        {
          id: 1,
          name: "Global health",
          percentageShare: "100.000000000000000",
          standardSplit: false,
          organizations: [
            {
              id: 6,
              name: "Against Malaria Foundation",
              widgetDisplayName: undefined,
              percentageShare: "100.000000000000000",
            },
          ],
        },
      ],
    });

    /** Each procedure: the REST route's permission, its DAO stub and what it returns */
    const procedures: {
      name: string;
      permission: string;
      stub: () => MockInstance;
      call: (caller: Caller, input: any) => Promise<unknown>;
      expected: unknown;
    }[] = [
      {
        name: "taxUnits",
        permission: "read:profile",
        stub: () => vi.spyOn(DAO.tax, "getByDonorId").mockResolvedValue([dbTaxUnit] as any),
        call: (caller, input) => caller.minside.taxUnits(input),
        expected: [{ ...dbTaxUnit, registered: "2021-02-03T04:05:06.000Z" }],
      },
      {
        name: "donationsAggregated",
        permission: "read:donations",
        stub: () =>
          vi
            .spyOn(DAO.donations, "getYearlyAggregateByDonorId")
            .mockResolvedValue([dbAggregate] as any),
        call: (caller, input) => caller.minside.donationsAggregated(input),
        // ID, causeAreaID and chartColor are not declared (Min Side doesn't use them)
        expected: [
          {
            organization: "Against Malaria Foundation",
            abbriv: "AMF",
            value: "750.000000",
            year: 2023,
          },
        ],
      },
      {
        name: "donations",
        permission: "read:donations",
        stub: () => vi.spyOn(DAO.donations, "getByDonorId").mockResolvedValue([dbDonation] as any),
        call: (caller, input) => caller.minside.donations(input),
        expected: [{ ...dbDonation, timestamp: "2023-05-06T07:08:09.000Z" }],
      },
      {
        name: "distributions",
        permission: "read:donations",
        stub: () =>
          vi
            .spyOn(DAO.distributions, "getAllByDonor")
            .mockResolvedValue({ donorID: 7, distributions: [distribution("111")] } as any),
        call: (caller, input) => caller.minside.distributions(input),
        // fundraiserTransactionId and widgetDisplayName are not declared
        expected: [
          {
            kid: "111",
            donorId: 7,
            taxUnitId: 3,
            causeAreas: [
              {
                id: 1,
                name: "Global health",
                percentageShare: "100.000000000000000",
                standardSplit: false,
                organizations: [
                  {
                    id: 6,
                    name: "Against Malaria Foundation",
                    percentageShare: "100.000000000000000",
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    describe("donations' impact", () => {
      const amf = {
        recipient: "Against Malaria Foundation",
        unit: "Myggnett",
        organization: "Against Malaria Foundation",
        organizationId: 6,
        amount: 1000,
        count: 12.5,
      };
      const second = { ...dbDonation, id: 102, timestamp: new Date("2023-06-06T07:08:09.000Z") };

      beforeEach(() => {
        vi.spyOn(DAO.donations, "getByDonorId").mockResolvedValue([dbDonation, second] as any);
      });

      it("adds each donation's impact, looked up for the caller's donor only", async () => {
        // A map that also holds another donor's donation (id 999) must not leak into the answer
        getDonationImpacts.mockResolvedValue(
          new Map([
            [101, [amf]],
            [999, [{ ...amf, amount: 5 }]],
          ]),
        );
        const result = await theDonor().minside.donations({ donorId: 7 });
        expect(getDonationImpacts).toHaveBeenCalledExactlyOnceWith({ donorId: 7 });
        expect(result.map((d) => d.id)).toStrictEqual([101, 102]);
        expect(result[0].impact).toStrictEqual([amf]);
        // No figures for 102 (no exchange rate for its day): no impact field, Min Side falls back
        expect(result[1]).not.toHaveProperty("impact");
      });

      it("never looks up another donor's impact", async () => {
        await expectTrpcError(theDonor().minside.donations({ donorId: 8 }), "FORBIDDEN");
        expect(getDonationImpacts).not.toHaveBeenCalled();
      });

      it("looks up the requested donor's impact for an admin", async () => {
        await callerWith({ permissions: ["read:donations", "admin"] }).minside.donations({
          donorId: 8,
        });
        expect(getDonationImpacts).toHaveBeenCalledExactlyOnceWith({ donorId: 8 });
      });

      it("still lists the donations when the impact lookup fails", async () => {
        const error = vi.spyOn(console, "error").mockReturnValue(undefined);
        getDonationImpacts.mockRejectedValue(new Error("Impact tables unavailable"));
        const result = await theDonor().minside.donations({ donorId: 7 });
        expect(result.map((d) => d.id)).toStrictEqual([101, 102]);
        expect(result.some((d) => "impact" in d)).toBe(false);
        expect(error).toHaveBeenCalledOnce();
      });
    });

    for (const procedure of procedures) {
      describe(procedure.name, () => {
        let stub: MockInstance;
        const donor = (donorId = 7) => callerWith({ permissions: [procedure.permission], donorId });

        beforeEach(() => {
          stub = procedure.stub();
        });

        it("rejects anonymous callers", async () => {
          await expectTrpcError(procedure.call(callerWith(), { donorId: 7 }), "UNAUTHORIZED");
          expect(stub).not.toHaveBeenCalled();
        });

        it("rejects another donor", async () => {
          await expectTrpcError(procedure.call(donor(), { donorId: 8 }), "FORBIDDEN");
          expect(stub).not.toHaveBeenCalled();
        });

        it(`rejects the donor without the ${procedure.permission} permission`, async () => {
          const other = procedure.permission === "read:profile" ? "read:donations" : "read:profile";
          await expectTrpcError(
            procedure.call(callerWith({ permissions: [other], donorId: 7 }), { donorId: 7 }),
            "FORBIDDEN",
          );
          expect(stub).not.toHaveBeenCalled();
        });

        it("rejects ids that are not positive integers, and unknown fields", async () => {
          for (const input of [
            { donorId: 1.5 },
            { donorId: 0 },
            { donorId: -7 },
            { donorId: "7" },
            {},
            { donorId: 7, extra: true },
          ]) {
            await expectTrpcError(procedure.call(donor(), input), "BAD_REQUEST");
          }
          expect(stub).not.toHaveBeenCalled();
        });

        it("returns the donor's data with only the declared fields", async () => {
          expect(await procedure.call(donor(), { donorId: 7 })).toStrictEqual(procedure.expected);
          expect(stub).toHaveBeenCalledOnce();
          expect(stub.mock.calls[0][0]).toBe(7);
        });

        it("returns any donor's data to an admin", async () => {
          const result = await procedure.call(
            callerWith({ permissions: [procedure.permission, "admin"] }),
            { donorId: 7 },
          );
          expect(result).toStrictEqual(procedure.expected);
        });

        it("fails as an internal error when the data doesn't match the output schema", async () => {
          stub.mockResolvedValue(
            procedure.name === "distributions"
              ? { donorID: 7, distributions: [{ kid: 1 }] }
              : [{ unexpected: true }],
          );
          await expectTrpcError(procedure.call(donor(), { donorId: 7 }), "INTERNAL_SERVER_ERROR");
        });
      });
    }

    it("taxUnits uses the NO locale by default and passes SV on", async () => {
      const stub = vi.spyOn(DAO.tax, "getByDonorId").mockResolvedValue([]);
      const caller = callerWith({ permissions: ["read:profile"], donorId: 7 });
      await caller.minside.taxUnits({ donorId: 7 });
      await caller.minside.taxUnits({ donorId: 7, locale: "SV" });
      expect(stub.mock.calls[0]).toStrictEqual([7, "NO"]);
      expect(stub.mock.calls[1]).toStrictEqual([7, "SV"]);
      await expectTrpcError(
        caller.minside.taxUnits({ donorId: 7, locale: "DK" } as any),
        "BAD_REQUEST",
      );
    });

    it("distributions returns only the given KIDs when kids is set", async () => {
      vi.spyOn(DAO.distributions, "getAllByDonor").mockResolvedValue({
        donorID: 7,
        distributions: [distribution("111"), distribution("222"), distribution("333")],
      } as any);
      const caller = theDonor();
      const kids = async (input: { kids?: string[] }) =>
        (await caller.minside.distributions({ donorId: 7, ...input })).map((d) => d.kid);

      expect(await kids({})).toStrictEqual(["111", "222", "333"]);
      expect(await kids({ kids: ["333", "111", "999"] })).toStrictEqual(["111", "333"]);
      expect(await kids({ kids: [] })).toStrictEqual([]);
      await expectTrpcError(
        caller.minside.distributions({ donorId: 7, kids: [""] }),
        "BAD_REQUEST",
      );
    });
  });

  describe("batched over HTTP", () => {
    // A signed-in donor 7, without the Auth0 validator: the batch's authorization is under test
    const app = express();
    app.use(
      "/trpc",
      createExpressMiddleware({
        router: appRouter,
        createContext: ({ req, res }) => ({
          req,
          res,
          auth: {
            permissions: ["read:donations", "read:profile"],
            [String(config.authUserIdClaim)]: 7,
          },
        }),
      }),
    );

    const batchInput = (...inputs: unknown[]) =>
      encodeURIComponent(JSON.stringify(Object.fromEntries(inputs.map((v, i) => [i, v]))));

    it("checks each procedure of a batch against its own donor id", async () => {
      const donations = vi.spyOn(DAO.donations, "getByDonorId").mockResolvedValue([]);
      const taxUnits = vi.spyOn(DAO.tax, "getByDonorId").mockResolvedValue([]);

      const res = await request(app)
        .get(
          `/trpc/minside.donations,minside.taxUnits?batch=1&input=${batchInput(
            { donorId: 7 },
            { donorId: 8 },
          )}`,
        )
        .expect(207);

      expect(res.body[0].result.data).toStrictEqual([]);
      expect(res.body[1].error.data.code).toBe("FORBIDDEN");
      expect(donations).toHaveBeenCalledExactlyOnceWith(7);
      expect(taxUnits).not.toHaveBeenCalled();
    });

    it("answers all of the donor's distributions (no KIDs) in Min Side's first batch, and only the donor's", async () => {
      const donations = vi.spyOn(DAO.donations, "getByDonorId").mockResolvedValue([]);
      const distributions = vi.spyOn(DAO.distributions, "getAllByDonor").mockResolvedValue({
        donorID: 7,
        distributions: ["111", "222"].map((kid) => ({
          kid,
          donorId: 7,
          taxUnitId: null,
          causeAreas: [],
        })),
      } as any);

      const res = await request(app)
        .get(
          `/trpc/minside.donations,minside.distributions,minside.distributions?batch=1&input=${batchInput(
            { donorId: 7 },
            { donorId: 7 },
            { donorId: 8 },
          )}`,
        )
        .expect(207);

      expect(res.body[0].result.data).toStrictEqual([]);
      expect(res.body[1].result.data.map((d: { kid: string }) => d.kid)).toStrictEqual([
        "111",
        "222",
      ]);
      expect(res.body[2].error.data.code).toBe("FORBIDDEN");
      expect(donations).toHaveBeenCalledExactlyOnceWith(7);
      expect(distributions).toHaveBeenCalledExactlyOnceWith(7);
    });

    it("rejects the other donor's id in either position of a batch", async () => {
      const donations = vi.spyOn(DAO.donations, "getByDonorId").mockResolvedValue([]);

      const res = await request(app)
        .get(
          `/trpc/minside.donations,minside.donations?batch=1&input=${batchInput(
            { donorId: 8 },
            { donorId: 7 },
          )}`,
        )
        .expect(207);

      expect(res.body[0].error.data.code).toBe("FORBIDDEN");
      expect(res.body[1].result.data).toStrictEqual([]);
      expect(donations).toHaveBeenCalledExactlyOnceWith(7);
    });
  });

  describe("over HTTP", () => {
    const app = express();
    app.use(express.json());
    mountTrpc(app);

    const input = (value: unknown) => encodeURIComponent(JSON.stringify(value));

    it("answers 401 without a token", async () => {
      const res = await request(app)
        .get(`/trpc/minside.profile?input=${input({ donorId: 7 })}`)
        .expect(401);
      expect(res.body.error.data.code).toBe("UNAUTHORIZED");
    });

    it("answers 401 with an invalid token", async () => {
      await request(app)
        .get(`/trpc/minside.profile?input=${input({ donorId: 7 })}`)
        .set("Authorization", "Bearer not.a.token")
        .expect(401);
    });
  });

  it("keeps the shared schemas free of backend imports (apps/web bundles them)", () => {
    const source = readFileSync(join(__dirname, "../trpc/shared/minside.ts"), "utf8");
    const imports = [...source.matchAll(/(?:from|import|require\()\s*["']([^"']+)["']/g)].map(
      (m) => m[1],
    );
    expect(imports).toStrictEqual(["zod"]);
  });
});
