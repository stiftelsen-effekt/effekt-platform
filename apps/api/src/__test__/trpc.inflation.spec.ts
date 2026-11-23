import { describe, it, afterEach, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { DAO } from "../custom_modules/DAO";
import * as inflation from "../custom_modules/inflationadjustment";
import * as mail from "../custom_modules/mail";
import { appRouter } from "../trpc/router";
import { createCallerFactory } from "../trpc/trpc";

const createCaller = createCallerFactory(appRouter);

const callerWith = (permissions?: string[]) =>
  createCaller({
    req: {} as Request,
    res: {} as Response,
    auth: permissions ? { permissions } : undefined,
  });

const expectTrpcError = async (promise: Promise<unknown>, code: string) => {
  try {
    await promise;
    expect.unreachable(`expected ${code}`);
  } catch (err: any) {
    expect(err.code).toBe(code);
  }
};

describe("tRPC inflation router", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is admin-only", async () => {
    const prepare = vi.spyOn(inflation, "prepareInflationOffers").mockReturnValue(undefined as any);
    const send = vi.spyOn(inflation, "sendInflationOffers").mockReturnValue(undefined as any);
    await expectTrpcError(callerWith().inflation.prepare(), "UNAUTHORIZED");
    await expectTrpcError(callerWith(["read:profile"]).inflation.prepare(), "FORBIDDEN");
    await expectTrpcError(
      callerWith(["read:profile"]).inflation.send({ batchSize: 1 }),
      "FORBIDDEN",
    );
    await expectTrpcError(callerWith(["read:profile"]).inflation.overview(), "FORBIDDEN");
    expect(prepare).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("shows the preview, the unsent offers and totals in kroner", async () => {
    vi.spyOn(inflation, "previewInflationRound").mockResolvedValue({
      inflationUntil: "2026-09",
      proposals: [
        {
          type: "avtaleGiro",
          agreementId: "1",
          donorId: 10,
          donorName: "Test",
          email: "test@example.org",
          currentOre: 30000,
          proposedOre: 32000,
          increaseOre: 2000,
          inflation: 0.0645,
          lastChange: "2024-10",
          monthsSinceChange: 24,
        },
        {
          type: "vipps",
          agreementId: "abc",
          donorId: 11,
          donorName: null,
          email: "v@example.org",
          currentOre: 15000,
          proposedOre: 16000,
          increaseOre: 1000,
          inflation: 0.0645,
          lastChange: "2024-10",
          monthsSinceChange: 24,
        },
      ],
      skipped: {
        unknownStart: 0,
        changedRecently: 3,
        lowInflation: 4,
        smallIncrease: 0,
        noEmail: 0,
      },
    });
    vi.spyOn(DAO.inflationadjustments, "getUnsent").mockResolvedValue([]);
    vi.spyOn(DAO.inflationadjustments, "getStatusCounts").mockResolvedValue([
      { status: "expired", count: 360, monthlyIncreaseOre: 123400 },
    ]);

    const overview = await callerWith(["admin"]).inflation.overview();

    expect(overview.eligibleTotals).toStrictEqual({
      count: 2,
      avtaleGiro: 1,
      vipps: 1,
      monthlyIncrease: "30.00",
      yearlyIncrease: "360.00",
    });
    expect(overview.eligible[0]).toEqual(
      expect.objectContaining({
        currentAmount: "300.00",
        proposedAmount: "320.00",
        increase: "20.00",
      }),
    );
    expect(overview.statuses).toStrictEqual([
      { status: "expired", count: 360, monthlyIncrease: "1234.00" },
    ]);
    expect(overview.unsentTotals.count).toBe(0);
  });

  it("prepares and logs the counts", async () => {
    vi.spyOn(inflation, "prepareInflationOffers").mockResolvedValue({
      created: 5,
      alreadyOpen: 0,
      expired: 0,
      inflationUntil: "2026-09",
    });
    const log = vi.spyOn(DAO.logging, "add").mockResolvedValue(1);

    const result = await callerWith(["admin"]).inflation.prepare();

    expect(result.created).toBe(5);
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toBe("Inflation adjustment");
  });

  it("sends a batch through the inflation email, within the batch limit", async () => {
    const send = vi
      .spyOn(inflation, "sendInflationOffers")
      .mockImplementation(async ({ sendEmail }) => ({
        sent: (await sendEmail(7)) ? 1 : 0,
        failed: 0,
        cancelled: 0,
        remaining: 0,
      }));
    vi.spyOn(DAO.inflationadjustments, "getByIdForEmail").mockResolvedValue({
      ID: 7,
      current_amount: 300,
      proposed_amount: 320,
    } as any);
    const email = vi.spyOn(mail, "sendAgreementInflationAdjustment").mockResolvedValue(true);
    vi.spyOn(DAO.logging, "add").mockResolvedValue(1);

    const result = await callerWith(["admin"]).inflation.send({ batchSize: 10 });

    expect(result.sent).toBe(1);
    expect(send.mock.calls[0][0].batchSize).toBe(10);
    expect(email.mock.calls[0][0]).toEqual(expect.objectContaining({ ID: 7 }));
    await expectTrpcError(
      callerWith(["admin"]).inflation.send({ batchSize: inflation.MAX_SEND_BATCH + 1 }),
      "BAD_REQUEST",
    );
  });
});
