import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import { DAO } from "../custom_modules/DAO";
import { donationHelpers } from "../custom_modules/donationHelpers";
import { replaceAvtaleGiroDistribution } from "../custom_modules/avtalegiro";
import { updateAgreementDistribution } from "../custom_modules/vippsService";
import {
  assertDistributionOwnedBy,
  DistributionOwnershipError,
} from "../custom_modules/distributionOwnership";

const mail = require("../custom_modules/mail");

const OWNER = 7;
const OTHER = 8;

const causeAreas = [
  {
    id: 1,
    standardSplit: false,
    percentageShare: "100",
    organizations: [
      { id: 5, percentageShare: "60" },
      { id: 6, percentageShare: "40" },
    ],
  },
];

const taxUnits: Record<number, { id: number; donorId: number; archived: string | null }> = {
  70: { id: 70, donorId: OWNER, archived: null },
  71: { id: 71, donorId: OWNER, archived: "2025-01-01" },
  80: { id: 80, donorId: OTHER, archived: null },
};

describe("distribution ownership", () => {
  let replaceAvtaleGiroStub: MockInstance;
  let addDistributionStub: MockInstance;

  beforeAll(() => {
    vi.spyOn(DAO.tax, "getById").mockImplementation(
      async (id: number) => (taxUnits[id] as any) ?? null,
    );
    vi.spyOn(DAO.distributions, "getSplitByKID").mockResolvedValue({
      kid: "1234567",
      donorId: OWNER,
      taxUnitId: 70,
      causeAreas,
    } as any);
    replaceAvtaleGiroStub = vi
      .spyOn(DAO.avtalegiroagreements, "replaceDistribution")
      .mockResolvedValue(undefined as any);
    vi.spyOn(donationHelpers, "createAvtaleGiroKID").mockResolvedValue("99999999");
    vi.spyOn(donationHelpers, "createKID").mockResolvedValue("88888888");
    vi.spyOn(DAO.vipps, "getAgreement").mockResolvedValue({ ID: "agr_1", donorID: OWNER } as any);
    vi.spyOn(DAO.distributions, "getKIDbySplit").mockResolvedValue(null as any);
    addDistributionStub = vi.spyOn(DAO.distributions, "add").mockResolvedValue(undefined as any);
    vi.spyOn(DAO.vipps, "updateAgreementKID").mockResolvedValue(true as any);
    vi.spyOn(mail, "sendAvtaleGiroChange").mockResolvedValue(true);
    vi.spyOn(mail, "sendVippsAgreementChange").mockResolvedValue(true);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("assertDistributionOwnedBy", () => {
    it("accepts the owner with no tax unit or an active own tax unit", async () => {
      await assertDistributionOwnedBy(OWNER, { donorId: OWNER, taxUnitId: null });
      await assertDistributionOwnedBy(OWNER, { donorId: OWNER, taxUnitId: 70 });
    });

    for (const [name, input] of [
      ["another donor", { donorId: OTHER, taxUnitId: null }],
      ["another donor's tax unit", { donorId: OWNER, taxUnitId: 80 }],
      ["an archived own tax unit", { donorId: OWNER, taxUnitId: 71 }],
      ["an unknown tax unit", { donorId: OWNER, taxUnitId: 999 }],
    ] as const) {
      it(`rejects ${name}`, async () => {
        let error: unknown;
        try {
          await assertDistributionOwnedBy(OWNER, input);
        } catch (ex) {
          error = ex;
        }
        expect(error).toBeInstanceOf(DistributionOwnershipError);
      });
    }
  });

  describe("AvtaleGiro service", () => {
    for (const [name, input] of [
      ["another donor", { donorId: OTHER, taxUnitId: 80 }],
      ["the owner with another donor's tax unit", { donorId: OWNER, taxUnitId: 80 }],
    ] as const) {
      it(`refuse ${name} without writing`, async () => {
        let avtaleGiroError: unknown;
        await replaceAvtaleGiroDistribution("1234567", { ...input, causeAreas } as any).catch(
          (ex) => (avtaleGiroError = ex),
        );
        expect(avtaleGiroError).toBeInstanceOf(DistributionOwnershipError);
        expect(replaceAvtaleGiroStub).not.toHaveBeenCalled();
      });
    }

    it("still replace the owner's own distribution", async () => {
      await replaceAvtaleGiroDistribution("1234567", {
        donorId: OWNER,
        taxUnitId: 70,
        causeAreas,
      } as any);
      expect(replaceAvtaleGiroStub).toHaveBeenCalledOnce();
    });
  });

  describe("Vipps updateAgreementDistribution", () => {
    it("rejects another donor's tax unit without creating a distribution", async () => {
      const result = await updateAgreementDistribution("agr_1", {
        donorId: OWNER,
        taxUnitId: 80,
        causeAreas,
      } as any);
      expect(result.ok).toBe(false);
      expect(addDistributionStub).not.toHaveBeenCalled();
    });

    it("accepts the owner's own tax unit", async () => {
      const result = await updateAgreementDistribution("agr_1", {
        donorId: OWNER,
        taxUnitId: 70,
        causeAreas,
      } as any);
      expect(result.ok).toBe(true);
    });
  });
});
