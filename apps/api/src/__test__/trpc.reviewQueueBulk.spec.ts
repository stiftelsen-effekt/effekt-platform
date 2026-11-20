import { describe, it, afterEach, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { DAO } from "../custom_modules/DAO";
import { appRouter } from "../trpc/router";
import { createCallerFactory } from "../trpc/trpc";

/** Ignoring many review items at once: selected items, or every open item from one import */
const createCaller = createCallerFactory(appRouter);

const callerWith = (auth?: Record<string, unknown>) =>
  createCaller({ req: {} as Request, res: {} as Response, auth: auth as any });

const admin = () =>
  callerWith({ permissions: ["admin"], sub: "auth0|admin", email: "ops@example.org" }).reports
    .reviewQueue;

const expectTrpcError = async (promise: Promise<unknown>, code: string) => {
  try {
    await promise;
    expect.unreachable(`expected ${code}`);
  } catch (err: any) {
    expect(err.code).toBe(code);
  }
};

describe("tRPC reports.reviewQueue bulk ignore", () => {
  afterEach(() => vi.restoreAllMocks());

  it("ignores the selected items once each, with one note, and reports what was skipped", async () => {
    const ignoreMany = vi.spyOn(DAO.reviewqueue, "ignoreMany").mockResolvedValue(2);
    const result = await admin().ignoreMany({ ids: [5, 6, 6, 7], note: "Wrong file uploaded" });
    expect(result).toStrictEqual({ ignored: 2, skipped: 1 });
    const [ids, resolvedBy, note] = ignoreMany.mock.calls[0];
    expect(ids).toStrictEqual([5, 6, 7]);
    expect(resolvedBy).toBeTypeOf("string");
    expect(resolvedBy).not.toHaveLength(0);
    expect(note).toBe("Wrong file uploaded");
  });

  it("ignores without a note, and rejects an empty list, a blank note or too many ids", async () => {
    const ignoreMany = vi.spyOn(DAO.reviewqueue, "ignoreMany").mockResolvedValue(1);
    await admin().ignoreMany({ ids: [5] });
    expect(ignoreMany.mock.calls[0][2]).toBeNull();
    await expectTrpcError(admin().ignoreMany({ ids: [] }), "BAD_REQUEST");
    await expectTrpcError(admin().ignoreMany({ ids: [5], note: "  " }), "BAD_REQUEST");
    const many = Array.from({ length: 501 }, (_, i) => i + 1);
    await expectTrpcError(admin().ignoreMany({ ids: many }), "BAD_REQUEST");
    expect(ignoreMany).toHaveBeenCalledOnce();
  });

  it("counts and ignores every open item from one import", async () => {
    vi.spyOn(DAO.reviewqueue, "getOpenCountForImport").mockResolvedValue(312);
    const ignoreImport = vi.spyOn(DAO.reviewqueue, "ignoreImport").mockResolvedValue(312);
    expect(await admin().importOpenCount({ importLogId: 88 })).toStrictEqual({
      importLogId: 88,
      open: 312,
    });
    expect(await admin().ignoreImport({ importLogId: 88, note: "Wrong owner" })).toStrictEqual({
      ignored: 312,
    });
    expect(ignoreImport.mock.calls[0][0]).toBe(88);
    expect(ignoreImport.mock.calls[0][2]).toBe("Wrong owner");
  });

  it("is for admins only", async () => {
    const ignoreMany = vi.spyOn(DAO.reviewqueue, "ignoreMany").mockReturnValue(undefined as any);
    const ignoreImport = vi
      .spyOn(DAO.reviewqueue, "ignoreImport")
      .mockReturnValue(undefined as any);
    const notAdmin = callerWith({ permissions: ["read:profile"] }).reports.reviewQueue;
    await expectTrpcError(notAdmin.ignoreMany({ ids: [5] }), "FORBIDDEN");
    await expectTrpcError(notAdmin.ignoreImport({ importLogId: 1 }), "FORBIDDEN");
    await expectTrpcError(
      callerWith().reports.reviewQueue.importOpenCount({ importLogId: 1 }),
      "UNAUTHORIZED",
    );
    expect(ignoreMany.mock.calls.length > 0 || ignoreImport.mock.calls.length > 0).toBe(false);
  });
});
