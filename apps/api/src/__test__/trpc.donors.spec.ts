import { describe, it, afterEach, expect, vi } from "vitest";
import type { Request, Response } from "express";
import * as auth0 from "../custom_modules/auth0";
import { DAO } from "../custom_modules/DAO";
import * as taxModule from "../custom_modules/tax";
import { validateTaxUnitSsn } from "../custom_modules/donorService";
import { RequestLocale } from "../middleware/locale";
import { appRouter } from "../trpc/router";
import { sanitizeBooleanQuery, toDonorSearch } from "../trpc/routers/donors";
import { createCallerFactory } from "../trpc/trpc";

const createCaller = createCallerFactory(appRouter);

const callerWith = (permissions?: string[]) =>
  createCaller({
    req: {} as Request,
    res: {} as Response,
    auth: permissions ? { permissions } : undefined,
  });

const admin = () => callerWith(["admin"]);

const expectTrpcError = async (promise: Promise<unknown>, code: string, message?: RegExp) => {
  try {
    await promise;
    expect.unreachable(`expected ${code}`);
  } catch (err: any) {
    expect(err.code).toBe(code);
    if (message) expect(err.message).toMatch(message);
  }
};

const donor = {
  id: 7,
  name: "Jack Torrence",
  email: "jack@overlookhotel.com",
  registered: "2020-01-01T00:00:00.000Z",
  newsletter: true,
  trash: false,
};

const listResult = {
  rows: [
    {
      id: 7,
      name: "Jack Torrence",
      email: "jack@overlookhotel.com",
      registered: new Date("2020-01-01"),
      lastDonation: null,
      donationsCount: 2,
      donationsSum: 300,
      newsletter: true,
      campaignCode: null,
    },
  ],
  pages: 1,
  statistics: { totalDonors: 1, totalDonationSum: 300, totalDonationCount: 2 },
};

const VALID_FNR = "01019010046";
const VALID_ORGNR = "910000004";

describe("tRPC donors router", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("auth and validation", () => {
    it("rejects anonymous callers", async () => {
      const stub = vi.spyOn(DAO.donors, "getByID").mockResolvedValue(donor as any);
      await expectTrpcError(callerWith().donors.get({ donorId: 7 }), "UNAUTHORIZED");
      expect(stub).not.toHaveBeenCalled();
    });

    it("rejects callers without the admin permission", async () => {
      const stub = vi.spyOn(DAO.donors, "getByID").mockResolvedValue(donor as any);
      await expectTrpcError(
        callerWith(["read:profile"]).donors.taxUnits.list({ donorId: 7 }),
        "FORBIDDEN",
      );
      expect(stub).not.toHaveBeenCalled();
    });

    it("rejects invalid input", async () => {
      const stub = vi.spyOn(DAO.donors, "getAll").mockResolvedValue(listResult);
      await expectTrpcError(
        admin().donors.list({ page: 0, limit: 10, filter: { fundraiserTypes: ["adoveo"] } } as any),
        "BAD_REQUEST",
      );
      await expectTrpcError(admin().donors.get({ donorId: -1 }), "BAD_REQUEST");
      await expectTrpcError(admin().donors.search({ query: "x", limit: 101 }), "BAD_REQUEST");
      expect(stub).not.toHaveBeenCalled();
    });
  });

  describe("list / export / search", () => {
    it("passes the filter to getAll with dates and a null donorId", async () => {
      const stub = vi.spyOn(DAO.donors, "getAll").mockResolvedValue(listResult);
      const result = await admin().donors.list({
        page: 2,
        limit: 25,
        sort: { id: "donationsSum", desc: false },
        filter: {
          name: "Jack",
          registered: { from: "2024-01-31" },
          donationsSum: { from: 100 },
          fundraiserGiving: "never",
          recipientOrgIDs: [1, 2],
        },
      });

      expect(result).toStrictEqual(listResult);
      const [sort, page, limit, filter] = stub.mock.calls[0];
      expect(sort).toStrictEqual({ id: "donationsSum", desc: false });
      expect(page).toBe(2);
      expect(limit).toBe(25);
      expect(filter!.donorId).toBe(null);
      expect(filter!.name).toBe("Jack");
      // Whole Oslo days
      expect(filter!.registered).toBe(undefined);
      expect(filter!.registeredRange).toStrictEqual({
        from: new Date("2024-01-30T23:00:00Z"),
        before: undefined,
      });
      expect(filter!.donationsSum).toStrictEqual({ from: 100 });
      expect(filter!.recipientOrgIDs).toStrictEqual([1, 2]);
    });

    it("treats fundraiserTypes alone as having given to such a fundraiser", async () => {
      const stub = vi.spyOn(DAO.donors, "getAll").mockResolvedValue(listResult);
      await admin().donors.list({ page: 0, limit: 10, filter: { fundraiserTypes: ["facebook"] } });
      expect(stub.mock.calls[0][3]).toEqual(
        expect.objectContaining({
          fundraiserGiving: "atLeastOnce",
          fundraiserTypes: ["facebook"],
        }),
      );
      await admin().donors.list({
        page: 0,
        limit: 10,
        filter: { fundraiserTypes: ["facebook"], fundraiserGiving: "never" },
      });
      expect(stub.mock.calls[1][3]).toEqual(expect.objectContaining({ fundraiserGiving: "never" }));
      await admin().donors.list({ page: 0, limit: 10, filter: {} });
      expect(stub.mock.calls[2][3]!.fundraiserGiving).toBe(undefined);
    });

    it("matches name or email with nameOrEmail, escaping wildcards", async () => {
      const stub = vi.spyOn(DAO.donors, "getAll").mockResolvedValue(listResult);
      await admin().donors.list({
        page: 0,
        limit: 10,
        filter: { nameOrEmail: " 50%_off ", newsletter: true },
      });
      expect(stub.mock.calls[0][3]).toEqual(
        expect.objectContaining({ nameOrEmail: "50%_off", newsletter: true }),
      );
      await expectTrpcError(
        admin().donors.list({ page: 0, limit: 10, filter: { nameOrEmail: "  " } }),
        "BAD_REQUEST",
      );

      stub.mockRestore();
      const query = vi.spyOn(DAO, "query").mockResolvedValue([[], []] as any);
      await DAO.donors
        .getAll(
          { id: "id", desc: true },
          0,
          10,
          { donorId: null, nameOrEmail: "o'b%_\\", newsletter: true },
          "NO" as any,
        )
        .catch(() => undefined);
      const sql: string = query.mock.calls[0][0];
      const pattern = "'%o\\'b\\\\%\\\\_\\\\\\\\%'";
      expect(sql).toContain(`(Donors.full_name LIKE ${pattern} OR Donors.email LIKE ${pattern})`);
      expect(sql).toContain("Donors.newsletter = 1");

      await DAO.donors.getAll(
        { id: "id", desc: true },
        0,
        10,
        { donorId: null, newsletter: false },
        RequestLocale.NO,
      );
      expect(query.mock.lastCall![0]).toContain(
        "(Donors.newsletter = 0 OR Donors.newsletter IS NULL)",
      );
    });

    it("returns statistics as numbers", async () => {
      vi.spyOn(DAO.donors, "getAll").mockResolvedValue({
        ...listResult,
        statistics: {
          totalDonors: "1",
          totalDonationSum: "300.00",
          totalDonationCount: "2",
        } as any,
      });
      const result = await admin().donors.list({ page: 0, limit: 10 });
      expect(result.statistics).toStrictEqual({
        totalDonors: 1,
        totalDonationSum: 300,
        totalDonationCount: 2,
      });
    });

    it("exports all matching donors as CSV", async () => {
      const stub = vi.spyOn(DAO.donors, "getAll").mockResolvedValue(listResult);
      const result = await admin().donors.export({ filter: { newsletter: true } });

      expect(stub.mock.calls[0][1]).toBe(0);
      expect(stub.mock.calls[0][2]).toBe(Number.MAX_SAFE_INTEGER);
      expect(result.filename).toMatch(/^donors-.*\.csv$/);
      expect(result.csv.startsWith("\uFEFF")).toBe(true);
      expect(result.csv.slice(1).split("\n")[0]).toBe(
        "id,name,email,registered,lastDonation,donationsCount,donationsSum,newsletter,campaignCode",
      );
      expect(result.csv).toContain("jack@overlookhotel.com");
    });

    it("searches with the boolean mode query and defaults", async () => {
      const stub = vi.spyOn(DAO.donors, "getAll").mockResolvedValue(listResult);
      const result = await admin().donors.search({ query: "+jack -gmail" });

      expect(result.rows).toHaveLength(1);
      const [sort, page, limit, filter] = stub.mock.calls[0];
      expect(sort).toStrictEqual({ id: "id", desc: true });
      expect(page).toBe(0);
      expect(limit).toBe(25);
      expect(filter!.query).toBe("+jack -gmail");
      expect(filter!.donorId).toBe(null);
      expect(filter!.exactMatchFirst).toBe("+jack -gmail");
    });

    it("requires all plain words, matches emails partially and ranks exact matches first", async () => {
      const stub = vi.spyOn(DAO.donors, "getAll").mockResolvedValue(listResult);
      await admin().donors.search({ query: " Jack Tor " });
      expect(stub.mock.calls[0][3]).toEqual(
        expect.objectContaining({
          query: "+Jack* +Tor*",
          exactMatchFirst: "Jack Tor",
        }),
      );

      await admin().donors.search({ query: "Jack.T_1@Overlook.com" });
      expect(stub.mock.calls[1][3]).toEqual(
        expect.objectContaining({
          nameOrEmail: "Jack.T_1@Overlook.com",
          query: undefined,
          exactMatchFirst: "Jack.T_1@Overlook.com",
        }),
      );

      expect(toDonorSearch("27")).toStrictEqual({ query: "27" });
      expect(toDonorSearch("@overlook")).toStrictEqual({ nameOrEmail: "@overlook" });
      expect(toDonorSearch("anne-marie hotel")).toStrictEqual({ query: "+anne* +marie* +hotel*" });
      expect(toDonorSearch('"jack torrence"')).toStrictEqual({ query: '"jack torrence"' });
      expect(toDonorSearch("jac* hotel")).toStrictEqual({ query: "jac* hotel" });
      expect(toDonorSearch("((((")).toHaveProperty("error");
    });

    it("orders exact id, email or name matches first in the DAO", async () => {
      const query = vi.spyOn(DAO, "query").mockResolvedValue([[], []] as any);
      await DAO.donors.getAll(
        { id: "id", desc: true },
        0,
        10,
        { donorId: null, query: "+jack*", exactMatchFirst: "Jack@Overlook.com" },
        RequestLocale.NO,
      );
      const sql = query.mock.calls[0][0] as string;
      expect(sql).toContain(
        "ORDER BY (LOWER(FD.email) = LOWER('Jack@Overlook.com') OR LOWER(FD.full_name) = LOWER('Jack@Overlook.com')) DESC, FD.ID DESC",
      );
    });

    it("sanitises malformed boolean mode queries", () => {
      expect(sanitizeBooleanQuery("+jack -gmail")).toBe("+jack -gmail");
      expect(sanitizeBooleanQuery('"jack torrence" +hotel')).toBe('"jack torrence" +hotel');
      expect(sanitizeBooleanQuery("jac*")).toBe("jac*");
      expect(sanitizeBooleanQuery("12345")).toBe("12345");
      expect(sanitizeBooleanQuery("+")).toBe("");
      expect(sanitizeBooleanQuery("((((")).toBe("");
      expect(sanitizeBooleanQuery('"jack')).toBe("jack");
      expect(sanitizeBooleanQuery("+anne-marie")).toBe("+anne +marie");
      expect(sanitizeBooleanQuery("jack@overlook.com")).toBe("jack overlook.com");
      expect(sanitizeBooleanQuery("~a <b >c (d) **")).toBe("a b c d");
    });

    it("rejects queries without search terms and maps MySQL parse errors", async () => {
      const stub = vi.spyOn(DAO.donors, "getAll").mockReturnValue(undefined as any);
      await expectTrpcError(admin().donors.search({ query: "((((" }), "BAD_REQUEST");
      expect(stub).not.toHaveBeenCalled();

      stub.mockRejectedValue(Object.assign(new Error("syntax error"), { errno: 1064 }));
      await expectTrpcError(admin().donors.search({ query: "jack" }), "BAD_REQUEST");
    });
  });

  describe("donor", () => {
    it("gets a donor", async () => {
      vi.spyOn(DAO.donors, "getByID").mockResolvedValue(donor as any);
      expect(await admin().donors.get({ donorId: 7 })).toStrictEqual(donor);
    });

    it("returns trash as a boolean", async () => {
      const getByID = vi.spyOn(DAO.donors, "getByID").mockReturnValue(undefined as any);
      getByID.mockResolvedValueOnce({ ...donor, trash: null } as any);
      getByID.mockResolvedValueOnce({ ...donor, trash: 1 } as any);
      expect((await admin().donors.get({ donorId: 7 })).trash).toBe(false);
      expect((await admin().donors.get({ donorId: 7 })).trash).toBe(true);
    });

    it("returns NOT_FOUND for a missing donor", async () => {
      vi.spyOn(DAO.donors, "getByID").mockResolvedValue(null);
      await expectTrpcError(admin().donors.get({ donorId: 7 }), "NOT_FOUND");
    });

    it("creates a donor", async () => {
      vi.spyOn(DAO.donors, "getIDbyEmail").mockResolvedValue(null);
      const add = vi.spyOn(DAO.donors, "add").mockResolvedValue(7);
      vi.spyOn(DAO.donors, "getByID").mockResolvedValue(donor as any);

      const created = await admin().donors.create({ email: donor.email, name: donor.name });
      expect(created).toStrictEqual(donor);
      expect(add.mock.calls[0][0]).toStrictEqual({ email: donor.email, full_name: donor.name });
    });

    it("creates a donor with a tax unit when ssn is given", async () => {
      const taxUnit = { id: 11, donorId: 7, name: donor.name, ssn: "199001011239", archived: null };
      vi.spyOn(DAO.donors, "getIDbyEmail").mockResolvedValue(null);
      vi.spyOn(DAO.donors, "add").mockResolvedValue(7);
      vi.spyOn(DAO.donors, "getByID").mockResolvedValue(donor as any);
      const addTaxUnit = vi.spyOn(DAO.tax, "addTaxUnit").mockResolvedValue(11);
      vi.spyOn(DAO.tax, "getById").mockResolvedValue(taxUnit as any);
      vi.spyOn(DAO.tax, "getByDonorId").mockResolvedValue([taxUnit as any]);
      vi.spyOn(taxModule, "connectDonationsForFirstTaxUnit").mockResolvedValue(undefined);

      await admin().donors.create({
        email: donor.email,
        name: donor.name,
        ssn: "19900101-1239",
        locale: RequestLocale.SV,
      });
      expect(addTaxUnit.mock.calls[0]).toStrictEqual([7, "199001011239", donor.name]);
    });

    it("rejects an invalid ssn on create before creating the donor", async () => {
      const add = vi.spyOn(DAO.donors, "add").mockResolvedValue(7);
      await expectTrpcError(
        admin().donors.create({ email: donor.email, name: donor.name, ssn: "01019010047" }),
        "BAD_REQUEST",
      );
      expect(add).not.toHaveBeenCalled();
    });

    it("refuses to create a donor with an existing email", async () => {
      vi.spyOn(DAO.donors, "getIDbyEmail").mockResolvedValue(3);
      const add = vi.spyOn(DAO.donors, "add").mockReturnValue(undefined as any);
      await expectTrpcError(
        admin().donors.create({ email: donor.email, name: donor.name }),
        "CONFLICT",
      );
      expect(add).not.toHaveBeenCalled();
    });

    it("updates a donor, keeping unspecified fields", async () => {
      vi.spyOn(DAO.donors, "getByID").mockResolvedValue(donor as any);
      const update = vi.spyOn(DAO.donors, "update").mockResolvedValue(true);

      await admin().donors.update({ donorId: 7, name: "John", trash: true });
      expect(update.mock.calls[0]).toStrictEqual([7, "John", donor.email, true, true]);
    });

    it("maps a duplicate email on update to CONFLICT", async () => {
      vi.spyOn(DAO.donors, "getByID").mockResolvedValue(donor as any);
      vi.spyOn(DAO.donors, "update").mockRejectedValue(
        Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" }),
      );
      const lookup = vi.spyOn(DAO.donors, "getIDbyEmail").mockResolvedValue(12);
      await expectTrpcError(
        admin().donors.update({ donorId: 7, name: "John", email: "taken@example.com" }),
        "CONFLICT",
        /\(donor 12\)$/,
      );
      lookup.mockRejectedValue(new Error("db down"));
      await expectTrpcError(
        admin().donors.update({ donorId: 7, name: "John", email: "taken@example.com" }),
        "CONFLICT",
        /another donor$/,
      );
    });

    it("names the existing donor when creating a donor with a taken email", async () => {
      vi.spyOn(DAO.donors, "getIDbyEmail").mockResolvedValue(12);
      const add = vi.spyOn(DAO.donors, "add").mockResolvedValue(7);
      await expectTrpcError(
        admin().donors.create({ email: "taken@example.com", name: "John" }),
        "CONFLICT",
        /\(donor 12\)$/,
      );
      expect(add).not.toHaveBeenCalled();
    });

    it("merges donors, re-pointing Auth0 to the destination first", async () => {
      vi.spyOn(DAO.donors, "getByID").mockResolvedValue(donor as any);
      const merge = vi.spyOn(DAO.donors, "mergeDonors").mockResolvedValue(undefined);
      const repoint = vi
        .spyOn(auth0, "repointAuth0DonorIdOnMerge")
        .mockResolvedValue({ updated: [], skipped: [] });

      expect(await admin().donors.merge({ originId: 7, destinationId: 8 })).toBe(true);
      expect(merge.mock.calls[0]).toStrictEqual([7, 8]);
      expect(repoint.mock.calls[0]).toStrictEqual([7, 8, donor.email]);
      expect(repoint).toHaveBeenCalledBefore(merge);
    });

    it("still merges when re-pointing Auth0 fails", async () => {
      vi.spyOn(DAO.donors, "getByID").mockResolvedValue(donor as any);
      const merge = vi.spyOn(DAO.donors, "mergeDonors").mockResolvedValue(undefined);
      vi.spyOn(console, "error").mockReturnValue(undefined);
      vi.spyOn(auth0, "repointAuth0DonorIdOnMerge").mockRejectedValue(
        new Error("Auth0 unavailable"),
      );

      expect(await admin().donors.merge({ originId: 7, destinationId: 8 })).toBe(true);
      expect(merge).toHaveBeenCalledOnce();
    });

    it("refuses to merge a donor into itself", async () => {
      const merge = vi.spyOn(DAO.donors, "mergeDonors").mockResolvedValue(undefined);
      const repoint = vi
        .spyOn(auth0, "repointAuth0DonorIdOnMerge")
        .mockReturnValue(undefined as any);
      await expectTrpcError(admin().donors.merge({ originId: 7, destinationId: 7 }), "BAD_REQUEST");
      expect(merge).not.toHaveBeenCalled();
      expect(repoint).not.toHaveBeenCalled();
    });

    it("returns NOT_FOUND when merging a missing donor", async () => {
      vi.spyOn(DAO.donors, "getByID").mockImplementation((id) => {
        if (id === 8) return Promise.resolve(null);
        if (id === 7) return Promise.resolve(donor as any);
        return undefined as any;
      });
      const merge = vi.spyOn(DAO.donors, "mergeDonors").mockResolvedValue(undefined);
      const repoint = vi
        .spyOn(auth0, "repointAuth0DonorIdOnMerge")
        .mockReturnValue(undefined as any);
      await expectTrpcError(admin().donors.merge({ originId: 7, destinationId: 8 }), "NOT_FOUND");
      expect(merge).not.toHaveBeenCalled();
      expect(repoint).not.toHaveBeenCalled();
    });
  });

  describe("per donor data", () => {
    it("returns donations, aggregates, referrals and agreements", async () => {
      const donations = [{ id: 1 }];
      const yearly = [
        {
          ID: 1,
          organization: "AMF",
          abbriv: "AMF",
          causeAreaID: 1,
          chartColor: null,
          value: "10",
          year: 2024,
        },
      ];
      const distributions = [
        { KID: "123", sum: "10.00", count: 1, full_name: "J", email: "j@x" },
        { KID: "124", sum: null, count: null, full_name: "J", email: "j@x" },
      ];
      const referral = {
        id: 1,
        typeId: 2,
        donorId: 7,
        timestamp: null,
        session: null,
        active: 1 as const,
        answer: "Podcast",
      };
      const avtalegiro = [{ ID: 1, amount: "500", active: 1, notice: 0 }];
      const vipps = [{ ID: "abc" }];

      vi.spyOn(DAO.donations, "getByDonorId").mockResolvedValue(donations as any);
      vi.spyOn(DAO.donations, "getYearlyAggregateByDonorId").mockResolvedValue(yearly);
      vi.spyOn(DAO.distributions, "getByDonorId").mockResolvedValue(distributions as any);
      vi.spyOn(DAO.distributions, "getOrgSharesByKIDs").mockResolvedValue(new Map());
      vi.spyOn(DAO.referrals, "getDonorAnswers").mockResolvedValue([referral]);
      vi.spyOn(DAO.avtalegiroagreements, "getByDonorId").mockResolvedValue(avtalegiro as any);
      vi.spyOn(DAO.vipps, "getAgreementsByDonorId").mockResolvedValue(vipps as any);

      const caller = admin();
      expect(await caller.donors.donations({ donorId: 7 })).toStrictEqual([
        { ...donations[0], orgSplit: [] },
      ]);
      expect(await caller.donors.donationsAggregated({ donorId: 7 })).toStrictEqual(yearly);
      expect(await caller.donors.distributionsAggregated({ donorId: 7 })).toStrictEqual([
        { ...distributions[0], orgSplit: [] },
        { ...distributions[1], count: 0, orgSplit: [] },
      ]);
      expect(await caller.donors.referrals({ donorId: 7 })).toStrictEqual([
        { ...referral, active: true },
      ]);
      expect(await caller.donors.recurring.avtalegiro({ donorId: 7 })).toStrictEqual([
        { ID: 1, amount: 500, active: true, notice: false },
      ]);
      expect(await caller.donors.recurring.vipps({ donorId: 7 })).toStrictEqual(vipps);
    });
  });

  describe("donations of a donor", () => {
    it("adds the organization split of each donation's KID", async () => {
      const split = [
        {
          organizationId: 1,
          organizationName: "Against Malaria Foundation",
          causeAreaId: 1,
          chartColor: null,
          share: "100.000000",
        },
      ];
      vi.spyOn(DAO.donations, "getByDonorId").mockResolvedValue([
        { id: 1, KID: "111", sum: "100" },
        { id: 2, KID: "222", sum: "50" },
      ] as any);
      const shares = vi
        .spyOn(DAO.distributions, "getOrgSharesByKIDs")
        .mockResolvedValue(new Map([["111", split]]));

      const rows = await admin().donors.donations({ donorId: 7 });

      expect(shares).toHaveBeenCalledExactlyOnceWith(["111", "222"]);
      expect(rows.map((row) => row.orgSplit)).toStrictEqual([split, []]);
    });
  });

  describe("tax units", () => {
    const taxUnit = { id: 11, donorId: 7, name: "Jack Torrence", ssn: VALID_FNR, archived: null };

    it("lists tax units with the requested locale", async () => {
      const stub = vi.spyOn(DAO.tax, "getByDonorId").mockResolvedValue([taxUnit as any]);
      expect(
        await admin().donors.taxUnits.list({ donorId: 7, locale: RequestLocale.SV }),
      ).toHaveLength(1);
      expect(stub.mock.calls[0]).toStrictEqual([7, RequestLocale.SV]);
      await admin().donors.taxUnits.list({ donorId: 7 });
      expect(stub.mock.calls[1]).toStrictEqual([7, RequestLocale.NO]);
    });

    it("creates the first tax unit and connects donations", async () => {
      vi.spyOn(DAO.donors, "getByID").mockResolvedValue(donor as any);
      vi.spyOn(DAO.tax, "getByDonorIdAndSsn").mockResolvedValue(null);
      const add = vi.spyOn(DAO.tax, "addTaxUnit").mockResolvedValue(11);
      vi.spyOn(DAO.tax, "getById").mockResolvedValue(taxUnit as any);
      vi.spyOn(DAO.tax, "getByDonorId").mockResolvedValue([taxUnit as any]);
      const connect = vi
        .spyOn(taxModule, "connectDonationsForFirstTaxUnit")
        .mockResolvedValue(undefined);

      const created = await admin().donors.taxUnits.create({
        donorId: 7,
        name: "Jack Torrence",
        ssn: VALID_FNR,
      });
      expect(created).toStrictEqual(taxUnit);
      expect(add.mock.calls[0]).toStrictEqual([7, VALID_FNR, "Jack Torrence"]);
      expect(connect.mock.calls[0]).toStrictEqual([7, 11]);
    });

    it("rejects an invalid ssn before touching the database", async () => {
      const add = vi.spyOn(DAO.tax, "addTaxUnit").mockResolvedValue(11);
      await expectTrpcError(
        admin().donors.taxUnits.create({ donorId: 7, name: "Jack", ssn: "01019010047" }),
        "BAD_REQUEST",
      );
      expect(add).not.toHaveBeenCalled();
    });

    it("refuses a duplicate ssn for the donor", async () => {
      vi.spyOn(DAO.donors, "getByID").mockResolvedValue(donor as any);
      vi.spyOn(DAO.tax, "getByDonorIdAndSsn").mockResolvedValue(taxUnit as any);
      const add = vi.spyOn(DAO.tax, "addTaxUnit").mockResolvedValue(11);
      await expectTrpcError(
        admin().donors.taxUnits.create({ donorId: 7, name: "Jack", ssn: VALID_FNR }),
        "CONFLICT",
      );
      expect(add).not.toHaveBeenCalled();
    });

    it("updates a tax unit", async () => {
      vi.spyOn(DAO.tax, "getById").mockResolvedValue(taxUnit as any);
      vi.spyOn(DAO.tax, "getByDonorIdAndSsn").mockResolvedValue(null);
      const update = vi.spyOn(DAO.tax, "updateTaxUnit").mockResolvedValue(1);

      const updated = await admin().donors.taxUnits.update({
        id: 11,
        name: "Overlook AS",
        ssn: VALID_ORGNR,
      });
      expect(updated).toEqual(
        expect.objectContaining({ id: 11, name: "Overlook AS", ssn: VALID_ORGNR }),
      );
      expect(update.mock.calls[0][0]).toBe(11);
      expect(update.mock.calls[0][1]).toEqual(
        expect.objectContaining({ name: "Overlook AS", ssn: VALID_ORGNR }),
      );
    });

    it("refuses to update to an ssn the donor has on another tax unit", async () => {
      vi.spyOn(DAO.tax, "getById").mockResolvedValue(taxUnit as any);
      vi.spyOn(DAO.tax, "getByDonorIdAndSsn").mockResolvedValue({ ...taxUnit, id: 12 } as any);
      const update = vi.spyOn(DAO.tax, "updateTaxUnit").mockResolvedValue(1);
      await expectTrpcError(
        admin().donors.taxUnits.update({ id: 11, name: "Overlook AS", ssn: VALID_ORGNR }),
        "CONFLICT",
      );
      expect(update).not.toHaveBeenCalled();
    });

    it("allows keeping the tax unit's own ssn on update", async () => {
      vi.spyOn(DAO.tax, "getById").mockResolvedValue(taxUnit as any);
      vi.spyOn(DAO.tax, "getByDonorIdAndSsn").mockResolvedValue(taxUnit as any);
      const update = vi.spyOn(DAO.tax, "updateTaxUnit").mockResolvedValue(1);
      await admin().donors.taxUnits.update({ id: 11, name: "Jack T", ssn: VALID_FNR });
      expect(update).toHaveBeenCalledOnce();
    });

    it("stores Swedish personnummer without the dash and checks both forms", async () => {
      vi.spyOn(DAO.donors, "getByID").mockResolvedValue(donor as any);
      const lookup = vi.spyOn(DAO.tax, "getByDonorIdAndSsn").mockResolvedValue(null);
      const add = vi.spyOn(DAO.tax, "addTaxUnit").mockResolvedValue(11);
      vi.spyOn(DAO.tax, "getById").mockResolvedValue(taxUnit as any);
      vi.spyOn(DAO.tax, "getByDonorId").mockResolvedValue([taxUnit as any, taxUnit as any]);

      await admin().donors.taxUnits.create({
        donorId: 7,
        name: "Jack",
        ssn: "19900101-1239",
        locale: RequestLocale.SV,
      });
      expect(add.mock.calls[0][1]).toBe("199001011239");
      expect(lookup.mock.calls.map((args) => args[1])).toStrictEqual([
        "199001011239",
        "19900101-1239",
      ]);
    });

    it("returns NOT_FOUND when updating a missing tax unit", async () => {
      vi.spyOn(DAO.tax, "getById").mockResolvedValue(null);
      await expectTrpcError(
        admin().donors.taxUnits.update({ id: 11, name: "X", ssn: VALID_ORGNR }),
        "NOT_FOUND",
      );
    });

    it("archives a tax unit with a transfer target", async () => {
      vi.spyOn(DAO.donors, "getByID").mockResolvedValue(donor as any);
      vi.spyOn(DAO.tax, "getById").mockImplementation((id) => {
        if (id === 11) return Promise.resolve(taxUnit as any);
        if (id === 12) return Promise.resolve({ ...taxUnit, id: 12 } as any);
        return undefined as any;
      });
      const del = vi.spyOn(DAO.tax, "deleteById").mockResolvedValue(1);

      expect(
        await admin().donors.taxUnits.archive({ donorId: 7, taxUnitId: 11, transferId: 12 }),
      ).toBe(true);
      expect(del.mock.calls[0]).toStrictEqual([11, 7, 12]);
    });

    it("refuses to archive another donor's tax unit", async () => {
      vi.spyOn(DAO.donors, "getByID").mockResolvedValue(donor as any);
      vi.spyOn(DAO.tax, "getById").mockResolvedValue({ ...taxUnit, donorId: 99 } as any);
      const del = vi.spyOn(DAO.tax, "deleteById").mockResolvedValue(1);
      await expectTrpcError(
        admin().donors.taxUnits.archive({ donorId: 7, taxUnitId: 11 }),
        "NOT_FOUND",
      );
      expect(del).not.toHaveBeenCalled();
    });

    it("refuses a transfer target belonging to another donor", async () => {
      vi.spyOn(DAO.tax, "getById").mockImplementation((id) =>
        id === 12
          ? Promise.resolve({ ...taxUnit, id: 12, donorId: 99 } as any)
          : (undefined as any),
      );
      const del = vi.spyOn(DAO.tax, "deleteById").mockResolvedValue(1);
      await expectTrpcError(
        admin().donors.taxUnits.archive({ donorId: 7, taxUnitId: 11, transferId: 12 }),
        "BAD_REQUEST",
      );
      expect(del).not.toHaveBeenCalled();
    });
  });

  describe("validateTaxUnitSsn", () => {
    it("accepts valid Norwegian fnr and orgnr", () => {
      expect(validateTaxUnitSsn(VALID_FNR, RequestLocale.NO)).toBe(null);
      expect(validateTaxUnitSsn(VALID_ORGNR, RequestLocale.NO)).toBe(null);
    });

    it("rejects invalid Norwegian numbers", () => {
      expect(validateTaxUnitSsn("01019010047", RequestLocale.NO)).toBeTypeOf("string");
      expect(validateTaxUnitSsn("910000005", RequestLocale.NO)).toBeTypeOf("string");
      expect(validateTaxUnitSsn("1234567890", RequestLocale.NO)).toBeTypeOf("string");
      expect(validateTaxUnitSsn(" " + VALID_ORGNR, RequestLocale.NO)).toBeTypeOf("string");
    });

    it("accepts valid Swedish personnummer and organisationsnummer", () => {
      expect(validateTaxUnitSsn("199001011239", RequestLocale.SV)).toBe(null);
      expect(validateTaxUnitSsn("19900101-1239", RequestLocale.SV)).toBe(null);
      expect(validateTaxUnitSsn("165560360793", RequestLocale.SV)).toBe(null);
    });

    it("rejects invalid Swedish numbers", () => {
      expect(validateTaxUnitSsn("199001011238", RequestLocale.SV)).toBeTypeOf("string");
      expect(validateTaxUnitSsn("9001011239", RequestLocale.SV)).toBeTypeOf("string");
      expect(validateTaxUnitSsn("175560360793", RequestLocale.SV)).toBeTypeOf("string");
      expect(validateTaxUnitSsn(VALID_FNR, RequestLocale.SV)).toBeTypeOf("string");
    });
  });
});
