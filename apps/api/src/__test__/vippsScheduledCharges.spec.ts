import { describe, it, afterEach, expect as vexpect, expect, vi } from "vitest";
import { DAO } from "../custom_modules/DAO";
const vipps = require("../custom_modules/vipps");

// Local dates, like the scheduler. "now" is 01:50 on the given day.
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 1, 50);
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);

describe("scheduledChargeDueDate", () => {
  const longAgo = "2020-01-01T00:00:00Z";

  it("charges on the regular day, three days ahead", () => {
    const due = vipps.scheduledChargeDueDate({ monthly_charge_day: 15 }, at(2026, 11, 12));
    expect(due?.getTime()).toBe(day(2026, 11, 15).getTime());
  });

  it("treats charge day 0 as the last day of the month", () => {
    expect(vipps.scheduledChargeDueDate({ monthly_charge_day: 0 }, at(2026, 11, 27))).not.toBe(
      null,
    );
    expect(vipps.scheduledChargeDueDate({ monthly_charge_day: 0 }, at(2026, 11, 26))).toBe(null);
  });

  it("catches up a charge day missed in the last three days for an existing agreement", () => {
    const agreement = { monthly_charge_day: 15, timestamp_created: longAgo };
    // Should have been created on the 12th; the job did not run until the 14th
    const due = vipps.scheduledChargeDueDate(agreement, at(2026, 11, 14));
    expect(due?.getTime()).toBe(day(2026, 11, 17).getTime());
    // Too late to catch up
    expect(vipps.scheduledChargeDueDate(agreement, at(2026, 11, 16))).toBe(null);
  });

  it("does not charge a new agreement before its first regular run", () => {
    const agreement = { monthly_charge_day: 15, timestamp_created: "2026-11-13T10:00:00" };
    expect(vipps.scheduledChargeDueDate(agreement, at(2026, 11, 14))).toBe(null);
    expect(vipps.scheduledChargeDueDate({ monthly_charge_day: 15 }, at(2026, 11, 14))).toBe(null);
  });

  it("charges on (or catches up) a force charge date", () => {
    const agreement = { monthly_charge_day: 1, force_charge_date: "2026-11-20" };
    expect(vipps.scheduledChargeDueDate(agreement, at(2026, 11, 17))).not.toBe(null);
    expect(vipps.scheduledChargeDueDate(agreement, at(2026, 11, 19))).not.toBe(null);
    expect(vipps.scheduledChargeDueDate(agreement, at(2026, 11, 16))).toBe(null);
    expect(vipps.scheduledChargeDueDate(agreement, at(2026, 11, 21))).toBe(null);
  });
});

describe("scheduledChargeIdempotencyKey", () => {
  it("is stable per agreement and due date", () => {
    const key = vipps.scheduledChargeIdempotencyKey("agr_1", "2026-11-15");
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(vipps.scheduledChargeIdempotencyKey("agr_1", "2026-11-15")).toBe(key);
    expect(vipps.scheduledChargeIdempotencyKey("agr_1", "2026-12-15")).not.toBe(key);
    expect(vipps.scheduledChargeIdempotencyKey("agr_2", "2026-11-15")).not.toBe(key);
  });
});

describe("hasChargedDueMonth", () => {
  afterEach(() => vi.restoreAllMocks());
  const due = day(2026, 11, 15);

  it("counts charges that are still pending or due, not only charged ones", async () => {
    for (const status of ["PENDING", "DUE", "RESERVED", "PROCESSING", "CHARGED"]) {
      vi.restoreAllMocks();
      vi.spyOn(vipps, "getCharges").mockResolvedValue([{ due: "2026-11-15", status }]);
      expect(await vipps.hasChargedDueMonth("agr_1", due), status).toBe(true);
    }
  });

  it("leaves the month open after a failed or cancelled charge, or one in another month", async () => {
    vi.spyOn(vipps, "getCharges").mockResolvedValue([
      { due: "2026-11-01", status: "FAILED" },
      { due: "2026-11-02", status: "CANCELLED" },
      { due: "2026-10-15", status: "CHARGED" },
    ]);
    expect(await vipps.hasChargedDueMonth("agr_1", due)).toBe(false);
  });

  it("throws when the charges cannot be fetched", async () => {
    vi.spyOn(vipps, "getCharges").mockResolvedValue(false);
    await vexpect(vipps.hasChargedDueMonth("agr_1", due)).rejects.toThrow();
  });
});

describe("createFutureDueCharges", () => {
  afterEach(() => vi.restoreAllMocks());
  const now = at(2026, 11, 12);
  const agreement = (ID: string) => ({ ID, monthly_charge_day: 15, paused_until_date: null });
  const vippsAgreement = (id: string) => ({ id, status: "ACTIVE", pricing: { amount: 30000 } });

  it("continues past failing agreements, counts only created charges and reports failures", async () => {
    vi.spyOn(console, "error").mockReturnValue(undefined);
    vi.spyOn(console, "log").mockReturnValue(undefined);
    vi.spyOn(DAO.vipps, "getActiveAgreements").mockResolvedValue([
      agreement("agr_1"),
      agreement("agr_2"),
      agreement("agr_3"),
    ] as any);
    vi.spyOn(vipps, "getAgreement").mockImplementation((id) => {
      if (id === "agr_1") return Promise.reject(new Error("network"));
      if (id === "agr_2" || id === "agr_3") return Promise.resolve(vippsAgreement(id));
      return undefined;
    });
    vi.spyOn(vipps, "hasChargedDueMonth").mockResolvedValue(false);
    const createCharge = vi.spyOn(vipps, "createCharge").mockImplementation((id) => {
      if (id === "agr_2") return Promise.resolve(false);
      if (id === "agr_3") return Promise.resolve("chr_3");
      return undefined;
    });

    const result = await vipps.createFutureDueCharges(now);

    expect(result.activeAgreements).toBe(3);
    expect(result.createdCharges).toBe(1);
    expect(result.failed.map((f) => f.agreementId)).toStrictEqual(["agr_1", "agr_2"]);

    const [, amount, , dueDate, key] = createCharge.mock.calls.filter(
      ([id]) => id === "agr_3",
    )[0] as any[];
    expect(amount).toBe(300);
    expect(dueDate.getTime()).toBe(day(2026, 11, 15).getTime());
    expect(key).toBe(vipps.scheduledChargeIdempotencyKey("agr_3", "2026-11-15"));
  });

  it("does not create a second charge when the month already has a pending one", async () => {
    vi.spyOn(DAO.vipps, "getActiveAgreements").mockResolvedValue([agreement("agr_1")] as any);
    vi.spyOn(vipps, "getAgreement").mockResolvedValue(vippsAgreement("agr_1"));
    vi.spyOn(vipps, "getCharges").mockResolvedValue([{ due: "2026-11-15", status: "PENDING" }]);
    const createCharge = vi.spyOn(vipps, "createCharge").mockReturnValue(undefined);

    const result = await vipps.createFutureDueCharges(now);

    expect(createCharge).not.toHaveBeenCalled();
    expect(result.failed).toStrictEqual([]);
  });
});

describe("synchronizeVippsAgreementDatabase", () => {
  afterEach(() => vi.restoreAllMocks());

  it("continues past a failing agreement and reports it", async () => {
    vi.spyOn(console, "error").mockReturnValue(undefined);
    vi.spyOn(vipps, "getAgreements").mockImplementation(async (status) => {
      if (status === "ACTIVE")
        return [
          { id: "agr_1", status: "ACTIVE", pricing: { amount: 10000 } },
          { id: "agr_2", status: "ACTIVE", pricing: { amount: 10000 } },
        ];
      if (status === "EXPIRED") return false;
      return [];
    });
    vi.spyOn(DAO.vipps, "addAgreement").mockResolvedValue(true);
    vi.spyOn(DAO.vipps, "updateAgreementPrice").mockResolvedValue(true);
    vi.spyOn(DAO.vipps, "updateAgreementStatus").mockResolvedValue(true);
    vi.spyOn(DAO.vipps, "getAgreement").mockResolvedValue({ KID: "123" } as any);
    const getCharges = vi.spyOn(vipps, "getCharges").mockImplementation((id) => {
      if (id === "agr_1") return Promise.resolve(false);
      if (id === "agr_2") return Promise.resolve([]);
      return undefined;
    });

    const result = await vipps.synchronizeVippsAgreementDatabase();

    expect(result.agreements).toBe(2);
    expect(getCharges).toHaveBeenCalledWith("agr_2");
    expect(result.failed).toStrictEqual([
      { status: "EXPIRED", error: "Could not fetch EXPIRED agreements" },
      { agreementId: "agr_1", error: "Could not fetch charges" },
    ]);
  });
});
