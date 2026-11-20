import { describe, it, afterEach, expect, vi } from "vitest";
import { DAO } from "../../custom_modules/DAO";

describe("DAO writes report failures", () => {
  afterEach(() => vi.restoreAllMocks());

  it("addAgreement returns false when the insert fails", async () => {
    vi.spyOn(console, "error").mockReturnValue(undefined);
    vi.spyOn(DAO, "query").mockRejectedValue(new Error("db down"));
    const result = await DAO.vipps.addAgreement("agr_1", 1, "123", 100, 5, "code");
    expect(result).toBe(false);
  });

  it("addCharge returns false when the insert fails", async () => {
    vi.spyOn(console, "error").mockReturnValue(undefined);
    vi.spyOn(DAO, "query").mockRejectedValue(new Error("db down"));
    const result = await DAO.vipps.addCharge(
      "chr_1",
      "agr_1",
      100,
      "123",
      "2026-11-01",
      "DUE",
      "RECURRING",
    );
    expect(result).toBe(false);
  });

  it("addAgreement waits for the insert before reporting success", async () => {
    let resolved = false;
    vi.spyOn(DAO, "query").mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      resolved = true;
      return [{ affectedRows: 1 }, []] as any;
    });
    const result = await DAO.vipps.addAgreement("agr_1", 1, "123", 100, 5, "code");
    expect(result).toBe(true);
    expect(resolved).toBe(true);
  });

  it("vipps updates return whether a row matched", async () => {
    const query = vi.spyOn(DAO, "query").mockReturnValue(undefined as any);
    query.mockResolvedValueOnce([{ affectedRows: 1 }, []] as any);
    query.mockResolvedValueOnce([{ affectedRows: 0 }, []] as any);
    expect(await DAO.vipps.updateAgreementStatus("agr_1", "ACTIVE")).toBe(true);
    expect(await DAO.vipps.updateChargeStatus("CHARGED", "agr_1", "chr_missing")).toBe(false);
  });

  it("vipps updates return false when the query fails", async () => {
    vi.spyOn(console, "error").mockReturnValue(undefined);
    vi.spyOn(DAO, "query").mockRejectedValue(new Error("db down"));
    expect(await DAO.vipps.updateAgreementPrice("agr_1", 200)).toBe(false);
    expect(await DAO.vipps.updateAgreementKID("agr_1", "123")).toBe(false);
  });

  it("avtalegiro cancelAgreement propagates failures instead of reporting success", async () => {
    vi.spyOn(DAO, "query").mockRejectedValue(new Error("db down"));
    let caught: unknown;
    try {
      await DAO.avtalegiroagreements.cancelAgreement("123");
    } catch (ex) {
      caught = ex;
    }
    expect(caught).toBeInstanceOf(Error);
  });
});

describe("DAO transactions release their connection", () => {
  const originalPool = (DAO as any).dbPool;
  afterEach(() => {
    vi.restoreAllMocks();
    (DAO as any).dbPool = originalPool;
  });

  const fakeConnection = (failOn?: string) => {
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql === failOn) throw new Error(`${sql} failed`);
      return [[], []];
    });
    return { query, release: vi.fn() };
  };

  it("releases and rolls back when COMMIT fails, and a later rollback is a no-op", async () => {
    vi.spyOn(console, "log").mockReturnValue(undefined);
    const conn = fakeConnection("COMMIT");
    let caught: unknown;
    try {
      await DAO.commitTransaction(conn);
    } catch (ex) {
      caught = ex;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(conn.query).toHaveBeenCalledWith("ROLLBACK");
    expect(conn.release).toHaveBeenCalledOnce();

    await DAO.rollbackTransaction(conn);
    expect(conn.release).toHaveBeenCalledOnce();
    expect(conn.query.mock.calls.filter(([sql]) => sql === "ROLLBACK")).toHaveLength(1);
  });

  it("releases when ROLLBACK fails", async () => {
    vi.spyOn(console, "log").mockReturnValue(undefined);
    const conn = fakeConnection("ROLLBACK");
    let caught: unknown;
    try {
      await DAO.rollbackTransaction(conn);
    } catch (ex) {
      caught = ex;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(conn.release).toHaveBeenCalledOnce();
  });

  it("releases after a successful commit", async () => {
    const conn = fakeConnection();
    await DAO.commitTransaction(conn);
    expect(conn.release).toHaveBeenCalledOnce();
  });

  it("releases the connection when START TRANSACTION fails", async () => {
    vi.spyOn(console, "log").mockReturnValue(undefined);
    const conn = fakeConnection("START TRANSACTION");
    (DAO as any).dbPool = { getConnection: async () => conn };
    let caught: unknown;
    try {
      await DAO.startTransaction();
    } catch (ex) {
      caught = ex;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(conn.release).toHaveBeenCalledOnce();
  });
});
