import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import express, { type Request, type Response } from "express";
import request from "supertest";
import { DAO } from "../custom_modules/DAO";
import { getYearlyTaxReports } from "../custom_modules/taxReports";
import { RequestLocale } from "../middleware/locale";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
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

type Caller = ReturnType<typeof callerWith>;

const expectTrpcError = async (promise: Promise<unknown>, code: string) => {
  try {
    await promise;
    expect.unreachable(`expected ${code}`);
  } catch (err: any) {
    expect(err.code).toBe(code);
  }
};

/** Rows as the DAO returns them (mysql2: DATETIME and DATE as Date, DECIMAL as string) */
const dbVipps = {
  ID: "agr_5kSeqz",
  status: "ACTIVE",
  donorID: 7,
  full_name: "Jack Torrence",
  KID: "000007000000017",
  timestamp_created: new Date("2024-01-02T03:04:05.000Z"),
  monthly_charge_day: 15,
  force_charge_date: null,
  paused_until_date: null,
  amount: 300,
  agreement_url_code: "secret-url-code",
};
const dbAvtaleGiro = {
  ID: 21,
  active: 1,
  amount: "500",
  KID: "000007000000025",
  payment_date: 20,
  created: new Date("2023-02-03T04:05:06.000Z"),
  cancelled: null,
  last_updated: new Date("2023-02-03T04:05:06.000Z"),
  notice: 1,
  full_name: "Jack Torrence",
};

const dbTaxUnit = {
  id: 3,
  donorId: 7,
  name: "Jack Torrence",
  ssn: "12345678901",
  registered: new Date("2021-02-03T04:05:06.000Z"),
  archived: null,
  sumDonations: "1000",
  numDonations: 1,
  taxDeductions: [],
};
const dbDonation = (id: number, sum: string, taxUnitId: number | null, paymentMethod: string) => ({
  id,
  donor: "Jack Torrence",
  donorId: 7,
  email: "jack@overlookhotel.com",
  sum,
  transactionCost: "0",
  timestamp: new Date("2024-05-06T07:08:09.000Z"),
  paymentMethod,
  KID: "000007000000017",
  taxUnitId,
  metaOwnerId: 3,
});

/** Stubs the DAO calls of the tax report builder; returns the first one (the tax units) */
const stubTaxReportData = () => {
  const taxUnits = vi.spyOn(DAO.tax, "getByDonorId").mockResolvedValue([dbTaxUnit] as any);
  vi.spyOn(DAO.donations, "getByDonorId").mockResolvedValue([
    dbDonation(101, "1000.00", 3, "Bank"),
    dbDonation(102, "300.00", null, "Crypto"),
  ] as any);
  vi.spyOn(DAO.donations, "getEAFundsDonations").mockResolvedValue([]);
  return taxUnits;
};

describe("tRPC minside agreements and tax reports", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Each procedure: the REST route's permission, its DAO stub and what it returns */
  const procedures: {
    name: string;
    stub: () => MockInstance;
    call: (caller: Caller, input: any) => Promise<unknown>;
    expected?: unknown;
  }[] = [
    {
      name: "vippsAgreements",
      stub: () => vi.spyOn(DAO.vipps, "getAgreementsByDonorId").mockResolvedValue([dbVipps] as any),
      call: (caller, input) => caller.minside.vippsAgreements(input),
      // agreement_url_code and the fields Min Side doesn't read are not declared
      expected: [
        {
          ID: "agr_5kSeqz",
          status: "ACTIVE",
          KID: "000007000000017",
          amount: 300,
          monthly_charge_day: 15,
          timestamp_created: "2024-01-02T03:04:05.000Z",
        },
      ],
    },
    {
      name: "avtaleGiroAgreements",
      stub: () =>
        vi.spyOn(DAO.avtalegiroagreements, "getByDonorId").mockResolvedValue([dbAvtaleGiro] as any),
      call: (caller, input) => caller.minside.avtaleGiroAgreements(input),
      expected: [
        {
          ID: 21,
          active: 1,
          amount: "500",
          KID: "000007000000025",
          payment_date: 20,
          created: "2023-02-03T04:05:06.000Z",
          cancelled: null,
        },
      ],
    },
    {
      name: "taxReports",
      stub: stubTaxReportData,
      call: (caller, input) => caller.minside.taxReports(input),
      // Compared with what REST answers (getYearlyTaxReports) below
    },
  ];

  for (const procedure of procedures) {
    describe(procedure.name, () => {
      let stub: MockInstance;
      const donor = (donorId = 7) => callerWith({ permissions: ["read:donations"], donorId });

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

      it("rejects the donor without the read:donations permission", async () => {
        await expectTrpcError(
          procedure.call(callerWith({ permissions: ["read:profile"], donorId: 7 }), {
            donorId: 7,
          }),
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
        const result = await procedure.call(donor(), { donorId: 7 });
        if (procedure.expected !== undefined) {
          expect(result).toStrictEqual(procedure.expected);
        }
        expect(stub).toHaveBeenCalledOnce();
        expect(stub.mock.calls[0][0]).toBe(7);
      });

      it("returns any donor's data to an admin", async () => {
        const result = await procedure.call(
          callerWith({ permissions: ["read:donations", "admin"] }),
          { donorId: 7 },
        );
        expect(stub.mock.calls[0][0]).toBe(7);
        if (procedure.expected !== undefined) {
          expect(result).toStrictEqual(procedure.expected);
        }
      });

      if (procedure.name !== "taxReports") {
        it("fails as an internal error when the data doesn't match the output schema", async () => {
          stub.mockResolvedValue([{ unexpected: true }]);
          await expectTrpcError(procedure.call(donor(), { donorId: 7 }), "INTERNAL_SERVER_ERROR");
        });
      }
    });
  }

  describe("taxReports", () => {
    const caller = () => callerWith({ permissions: ["read:donations"], donorId: 7 });

    it("returns what GET /donors/:id/taxreports returns", async () => {
      stubTaxReportData();
      const rest = await getYearlyTaxReports(7, RequestLocale.NO);
      const reports = await caller().minside.taxReports({ donorId: 7 });

      expect(reports).toStrictEqual(rest);
      // The previous year down to 2022
      const lastYear = new Date().getFullYear() - 1;
      expect(reports.map((r) => r.year)).toStrictEqual(
        Array.from({ length: lastYear - 2021 }, (_, i) => lastYear - i),
      );

      const report2024 = reports.find((r) => r.year === 2024)!;
      expect(report2024.units).toHaveLength(1);
      expect(report2024.units[0]).toEqual(
        expect.objectContaining({
          id: 3,
          name: "Jack Torrence",
          ssn: "12345678901",
          sumDonations: 1000,
        }),
      );
      expect(report2024.units[0].channels).toStrictEqual([
        { channel: "Gi Effektivt", sumDonations: 1000 },
      ]);
      expect(report2024.sumDonationsWithoutTaxUnit.sumDonations).toBe(300);
      expect(report2024.sumNonDeductibleDonationsByType).toStrictEqual([
        { type: "Crypto", sumNonDeductibleDonations: 300 },
      ]);
    });

    it("leaves archived tax units out", async () => {
      stubTaxReportData().mockResolvedValue([
        dbTaxUnit,
        { ...dbTaxUnit, id: 4, archived: new Date("2023-01-01T00:00:00.000Z") },
      ] as any);
      const reports = await caller().minside.taxReports({ donorId: 7 });
      expect(reports.every((r) => r.units.length === 1 && r.units[0].id === 3)).toBe(true);
    });

    it("uses the NO locale by default and passes SV on", async () => {
      const taxUnits = stubTaxReportData();
      await caller().minside.taxReports({ donorId: 7 });
      await caller().minside.taxReports({ donorId: 7, locale: "SV" });
      expect(taxUnits.mock.calls[0]).toStrictEqual([7, "NO"]);
      expect(taxUnits.mock.calls[1]).toStrictEqual([7, "SV"]);
      await expectTrpcError(
        caller().minside.taxReports({ donorId: 7, locale: "DK" } as any),
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
            permissions: ["read:donations"],
            [String(config.authUserIdClaim)]: 7,
          },
        }),
      }),
    );

    const batchInput = (...inputs: unknown[]) =>
      encodeURIComponent(JSON.stringify(Object.fromEntries(inputs.map((v, i) => [i, v]))));

    it("answers the agreements page's lists in one batch", async () => {
      vi.spyOn(DAO.vipps, "getAgreementsByDonorId").mockResolvedValue([dbVipps] as any);
      vi.spyOn(DAO.avtalegiroagreements, "getByDonorId").mockResolvedValue([dbAvtaleGiro] as any);

      const res = await request(app)
        .get(
          `/trpc/minside.vippsAgreements,minside.avtaleGiroAgreements?batch=1&input=${batchInput(
            { donorId: 7 },
            { donorId: 7 },
          )}`,
        )
        .expect(200);

      expect(res.body.map((r: any) => r.result.data[0].KID)).toStrictEqual([
        dbVipps.KID,
        dbAvtaleGiro.KID,
      ]);
      expect(res.body[0].result.data[0]).not.toHaveProperty("agreement_url_code");
    });

    it("checks each procedure of a batch against its own donor id", async () => {
      const vipps = vi.spyOn(DAO.vipps, "getAgreementsByDonorId").mockResolvedValue([]);
      const taxUnits = stubTaxReportData();

      const res = await request(app)
        .get(
          `/trpc/minside.vippsAgreements,minside.taxReports?batch=1&input=${batchInput(
            { donorId: 8 },
            { donorId: 7 },
          )}`,
        )
        .expect(207);

      expect(res.body[0].error.data.code).toBe("FORBIDDEN");
      expect(res.body[1].result.data).toBeInstanceOf(Array);
      expect(res.body[1].result.data).not.toHaveLength(0);
      expect(vipps).not.toHaveBeenCalled();
      expect(taxUnits).toHaveBeenCalledExactlyOnceWith(7, RequestLocale.NO);
    });
  });
});
