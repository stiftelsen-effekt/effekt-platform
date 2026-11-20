import { describe, it, afterEach, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { DAO } from "../custom_modules/DAO";
import { appRouter } from "../trpc/router";
import { createCallerFactory } from "../trpc/trpc";

const createCaller = createCallerFactory(appRouter);

const callerWith = (permissions?: string[]) =>
  createCaller({
    req: {} as Request,
    res: {} as Response,
    auth: permissions ? { permissions } : undefined,
  });

const admin = () => callerWith(["admin"]);

const expectCode = async (promise: Promise<unknown>, code: string) => {
  try {
    await promise;
    expect.unreachable(`expected ${code}`);
  } catch (err: any) {
    expect(err.code).toBe(code);
  }
};

const causeArea = {
  id: 1,
  name: "Global health",
  shortDescription: "short",
  longDescription: "long",
  informationUrl: "https://example.org",
  isActive: true,
  ordering: 1,
  standardPercentageShare: 100,
};

const organization = (id: number, causeAreaId: number, ordering: number) => ({
  id,
  name: `Org ${id}`,
  abbreviation: `O${id}`,
  shortDescription: null,
  longDescription: "",
  standardShare: 50,
  informationUrl: null,
  isActive: true,
  ordering,
  causeAreaId,
  chartColor: null,
});

const orgRow = {
  ID: 7,
  cause_area_ID: 1,
  full_name: "Against Malaria Foundation",
  abbriv: "AMF",
  short_desc: "nets",
  long_desc: "long",
  info_url: "https://amf.org",
  widget_display_name: null,
  widget_context: null,
  std_percentage_share: 40,
  is_active: 1,
  ordering: 2,
  chart_color: "chart-3",
};

describe("tRPC config router", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("auth and validation", () => {
    it("rejects anonymous callers", async () => {
      const stub = vi.spyOn(DAO.payment, "getMethods").mockResolvedValue([]);
      await expectCode(callerWith().config.paymentMethods.list(), "UNAUTHORIZED");
      expect(stub).not.toHaveBeenCalled();
    });

    it("rejects authenticated callers without the admin permission", async () => {
      const stub = vi.spyOn(DAO.causeareas, "add").mockResolvedValue(1);
      await expectCode(
        callerWith(["read:profile"]).config.causeAreas.create({ name: "X" }),
        "FORBIDDEN",
      );
      expect(stub).not.toHaveBeenCalled();
    });

    it("rejects invalid input", async () => {
      const stub = vi.spyOn(DAO.organizations, "add").mockResolvedValue(1);
      await expectCode(
        admin().config.organizations.create({
          name: "X",
          abbreviation: "",
          causeAreaId: 1,
        }),
        "BAD_REQUEST",
      );
      await expectCode(
        admin().config.organizations.create({
          name: "X",
          abbreviation: "X",
          causeAreaId: 1,
          standardShare: 101,
        }),
        "BAD_REQUEST",
      );
      await expectCode(
        admin().config.organizations.create({
          name: "X",
          abbreviation: "ABCDEFGHIJK",
          causeAreaId: 1,
        }),
        "BAD_REQUEST",
      );
      await expectCode(admin().config.causeAreas.toggleActive({ id: -1 }), "BAD_REQUEST");
      expect(stub).not.toHaveBeenCalled();
    });
  });

  describe("causeAreas", () => {
    it("lists active cause areas with organizations", async () => {
      const data = [{ ...causeArea, organizations: [organization(1, 1, 1)] }];
      vi.spyOn(DAO.causeareas, "getActiveWithOrganizations").mockResolvedValue(data);
      expect(await admin().config.causeAreas.listActive()).toStrictEqual(data);
    });

    it("lists all cause areas with their organizations", async () => {
      vi.spyOn(DAO.causeareas, "getAll").mockResolvedValue([
        causeArea,
        { ...causeArea, id: 2, isActive: false },
      ]);
      vi.spyOn(DAO.organizations, "getAll").mockResolvedValue([
        organization(1, 1, 1),
        organization(2, 2, 1),
        organization(3, 1, 2),
      ]);
      const result = await admin().config.causeAreas.listAll();
      expect(result.map((c) => c.organizations.map((o) => o.id))).toStrictEqual([[1, 3], [2]]);
    });

    it("creates a cause area with REST defaults and returns it", async () => {
      const add = vi.spyOn(DAO.causeareas, "add").mockResolvedValue(5);
      const getById = vi
        .spyOn(DAO.causeareas, "getById")
        .mockResolvedValue({ ...causeArea, id: 5 });
      const created = await admin().config.causeAreas.create({ name: "Animals" });
      expect(getById.mock.calls[0][0]).toBe(5);
      expect(created.id).toBe(5);
      expect(add.mock.calls[0][0]).toStrictEqual({
        name: "Animals",
        shortDescription: "",
        longDescription: "",
        informationUrl: "",
        isActive: true,
        ordering: 99,
        standardPercentageShare: 0,
      });
    });

    it("updates only the given fields", async () => {
      vi.spyOn(DAO.causeareas, "getById").mockResolvedValue(causeArea);
      const update = vi.spyOn(DAO.causeareas, "updateById").mockResolvedValue(undefined);
      await admin().config.causeAreas.update({ id: 1, standardPercentageShare: 60 });
      expect(update.mock.calls[0][0]).toStrictEqual({ ...causeArea, standardPercentageShare: 60 });
    });

    it("maps a missing cause area to NOT_FOUND", async () => {
      vi.spyOn(DAO.causeareas, "getById").mockRejectedValue(new Error("Cause area not found"));
      const update = vi.spyOn(DAO.causeareas, "updateById").mockResolvedValue(undefined);
      await expectCode(admin().config.causeAreas.update({ id: 9, name: "X" }), "NOT_FOUND");
      expect(update).not.toHaveBeenCalled();
    });

    it("toggles active", async () => {
      const getById = vi.spyOn(DAO.causeareas, "getById").mockReturnValue(undefined as any);
      getById.mockResolvedValueOnce(causeArea);
      getById.mockResolvedValueOnce({ ...causeArea, isActive: false });
      const update = vi.spyOn(DAO.causeareas, "updateById").mockResolvedValue(undefined);
      const result = await admin().config.causeAreas.toggleActive({ id: 1 });
      expect(update.mock.calls[0][0].isActive).toBe(false);
      expect(result.isActive).toBe(false);
    });
  });

  describe("organizations", () => {
    it("lists active and all organizations", async () => {
      vi.spyOn(DAO.organizations, "getActive").mockResolvedValue([organization(1, 1, 1)]);
      vi.spyOn(DAO.organizations, "getAll").mockResolvedValue([organization(2, 1, 1)]);
      expect((await admin().config.organizations.listActive())[0].id).toBe(1);
      expect((await admin().config.organizations.listAll())[0].id).toBe(2);
    });

    it("lists organizations of a cause area sorted by ordering", async () => {
      vi.spyOn(DAO.organizations, "getAll").mockResolvedValue([
        organization(1, 1, 3),
        organization(2, 2, 1),
        organization(3, 1, 1),
      ]);
      const result = await admin().config.organizations.listByCauseArea({ causeAreaId: 1 });
      expect(result.map((o) => o.id)).toStrictEqual([3, 1]);
    });

    it("creates an organization with REST defaults and returns it", async () => {
      vi.spyOn(DAO.causeareas, "getById").mockResolvedValue(causeArea);
      const add = vi.spyOn(DAO.organizations, "add").mockResolvedValue(7);
      const getByID = vi.spyOn(DAO.organizations, "getByID").mockResolvedValue(orgRow);
      const created = await admin().config.organizations.create({
        name: "GD",
        abbreviation: "GD",
        causeAreaId: 1,
      });
      expect(getByID.mock.calls[0][0]).toBe(7);
      expect(created).toEqual(
        expect.objectContaining({ id: 7, abbreviation: "AMF", isActive: true }),
      );
      expect(add.mock.calls[0][0]).toStrictEqual({
        name: "GD",
        abbreviation: "GD",
        shortDescription: "",
        longDescription: "",
        informationUrl: "",
        isActive: true,
        ordering: 99,
        standardShare: 0,
        causeAreaId: 1,
        chartColor: null,
      });
    });

    it("rejects an unknown cause area on create and update", async () => {
      vi.spyOn(DAO.causeareas, "getById").mockRejectedValue(new Error("Cause area not found"));
      vi.spyOn(DAO.organizations, "getByID").mockResolvedValue(orgRow);
      const add = vi.spyOn(DAO.organizations, "add").mockResolvedValue(7);
      const update = vi.spyOn(DAO.organizations, "updateById").mockResolvedValue(undefined);
      await expectCode(
        admin().config.organizations.create({ name: "GD", abbreviation: "GD", causeAreaId: 99 }),
        "BAD_REQUEST",
      );
      await expectCode(
        admin().config.organizations.update({ id: 7, causeAreaId: 99 }),
        "BAD_REQUEST",
      );
      expect(add).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it("updates an organization and returns it mapped", async () => {
      vi.spyOn(DAO.organizations, "getByID").mockResolvedValue(orgRow);
      const update = vi.spyOn(DAO.organizations, "updateById").mockResolvedValue(undefined);
      const result = await admin().config.organizations.update({ id: 7, standardShare: 60 });
      expect(update.mock.calls[0][0]).toStrictEqual({
        id: 7,
        name: "Against Malaria Foundation",
        abbreviation: "AMF",
        shortDescription: "nets",
        longDescription: "long",
        informationUrl: "https://amf.org",
        isActive: true,
        ordering: 2,
        standardShare: 60,
        causeAreaId: 1,
        chartColor: "chart-3",
      });
      expect(result.abbreviation).toBe("AMF");
      expect(result.chartColor).toBe("chart-3");
    });

    it("sets and clears an organization's chart colour from the palette", async () => {
      vi.spyOn(DAO.organizations, "getByID").mockResolvedValue(orgRow);
      const update = vi.spyOn(DAO.organizations, "updateById").mockResolvedValue(undefined);
      await admin().config.organizations.update({ id: 7, chartColor: "chart-11" });
      expect(update.mock.calls[0][0]).toEqual(
        expect.objectContaining({ chartColor: "chart-11", standardShare: 40 }),
      );
      await admin().config.organizations.update({ id: 7, chartColor: null });
      expect(update.mock.calls[1][0]).to.include({ chartColor: null });
    });

    it("rejects chart colours outside the organization palette", async () => {
      vi.spyOn(DAO.organizations, "getByID").mockResolvedValue(orgRow);
      const update = vi.spyOn(DAO.organizations, "updateById").mockResolvedValue(undefined);
      const add = vi.spyOn(DAO.organizations, "add").mockResolvedValue(7);
      // chart-5 is "Other"; raw colours would break the dark theme
      for (const chartColor of ["chart-5", "#2f48c8", "chart-16", ""]) {
        await expectCode(
          admin().config.organizations.update({ id: 7, chartColor: chartColor as never }),
          "BAD_REQUEST",
        );
      }
      await expectCode(
        admin().config.organizations.create({
          name: "New",
          abbreviation: "N",
          causeAreaId: 1,
          chartColor: "red" as never,
        }),
        "BAD_REQUEST",
      );
      expect(update).not.toHaveBeenCalled();
      expect(add).not.toHaveBeenCalled();
    });

    it("maps unknown stored chart colours to null", async () => {
      vi.spyOn(DAO.organizations, "getByID").mockResolvedValue({ ...orgRow, chart_color: "teal" });
      const result = await admin().config.organizations.get({ id: 7 });
      expect(result.chartColor).toBe(null);
    });

    it("toggles active and 404s on missing organizations", async () => {
      const getByID = vi.spyOn(DAO.organizations, "getByID").mockReturnValue(undefined as any);
      getByID.withArgs(7).resolves(orgRow);
      getByID.withArgs(8).resolves(null);
      const update = vi.spyOn(DAO.organizations, "updateById").mockResolvedValue(undefined);
      await admin().config.organizations.toggleActive({ id: 7 });
      expect(update.mock.calls[0][0].isActive).toBe(false);
      await expectCode(admin().config.organizations.toggleActive({ id: 8 }), "NOT_FOUND");
      expect(update).toHaveBeenCalledOnce();
    });
  });

  describe("referralTypes", () => {
    const type = { id: 3, name: "Podcast", ordering: 2, is_active: 1 as const };
    const mapped = { id: 3, name: "Podcast", ordering: 2, isActive: true };

    it("lists active and all referral types", async () => {
      vi.spyOn(DAO.referrals, "getTypes").mockResolvedValue([
        { id: 3, name: "Podcast", ordering: 2 },
      ]);
      vi.spyOn(DAO.referrals, "getAllTypes").mockResolvedValue([type]);
      expect(await admin().config.referralTypes.listActive()).toStrictEqual([
        { id: 3, name: "Podcast", ordering: 2, isActive: true },
      ]);
      expect(await admin().config.referralTypes.listAll()).toStrictEqual([mapped]);
    });

    it("creates a referral type", async () => {
      const create = vi
        .spyOn(DAO.referrals, "createType")
        .mockResolvedValue({ id: 4, name: "Radio", ordering: 5, is_active: true });
      const result = await admin().config.referralTypes.create({ name: "Radio", ordering: 5 });
      expect(create.mock.calls[0]).toStrictEqual(["Radio", 5]);
      expect(result).toStrictEqual({ id: 4, name: "Radio", ordering: 5, isActive: true });
    });

    it("updates a referral type", async () => {
      const update = vi.spyOn(DAO.referrals, "updateType").mockResolvedValue(true);
      vi.spyOn(DAO.referrals, "getTypeById").mockResolvedValue(type);
      const result = await admin().config.referralTypes.update({ id: 3, isActive: false });
      expect(update.mock.calls[0]).toStrictEqual([
        3,
        { name: undefined, ordering: undefined, is_active: false },
      ]);
      expect(result).toStrictEqual(mapped);
    });

    it("rejects empty updates and 404s on missing types", async () => {
      const update = vi.spyOn(DAO.referrals, "updateType").mockResolvedValue(false);
      await expectCode(admin().config.referralTypes.update({ id: 3 }), "BAD_REQUEST");
      expect(update).not.toHaveBeenCalled();
      await expectCode(admin().config.referralTypes.update({ id: 3, name: "X" }), "NOT_FOUND");
    });

    it("toggles active", async () => {
      vi.spyOn(DAO.referrals, "toggleTypeActive").mockResolvedValue(true);
      vi.spyOn(DAO.referrals, "getTypeById").mockResolvedValue({ ...type, is_active: 0 });
      const result = await admin().config.referralTypes.toggleActive({ id: 3 });
      expect(result.isActive).toBe(false);
    });
  });

  describe("paymentMethods", () => {
    it("lists payment methods, empty list when none", async () => {
      const getMethods = vi.spyOn(DAO.payment, "getMethods").mockReturnValue(undefined as any);
      getMethods.mockResolvedValueOnce(null);
      expect(await admin().config.paymentMethods.list()).toStrictEqual([]);
    });
  });
});
