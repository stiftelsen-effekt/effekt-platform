import { describe, it, afterEach } from "vitest";
import { expect } from "chai";
import type { Request, Response } from "express";
import sinon from "sinon";
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
    expect.fail(`expected ${code}`);
  } catch (err: any) {
    expect(err.code).to.equal(code);
  }
};

describe("tRPC inflation router", () => {
  afterEach(() => sinon.restore());

  it("is admin-only", async () => {
    const prepare = sinon.stub(inflation, "prepareInflationOffers");
    const send = sinon.stub(inflation, "sendInflationOffers");
    await expectTrpcError(callerWith().inflation.prepare(), "UNAUTHORIZED");
    await expectTrpcError(callerWith(["read:profile"]).inflation.prepare(), "FORBIDDEN");
    await expectTrpcError(
      callerWith(["read:profile"]).inflation.send({ batchSize: 1 }),
      "FORBIDDEN",
    );
    await expectTrpcError(callerWith(["read:profile"]).inflation.overview(), "FORBIDDEN");
    expect(prepare.called).to.be.false;
    expect(send.called).to.be.false;
  });

  it("shows the preview, the unsent offers and totals in kroner", async () => {
    sinon.stub(inflation, "previewInflationRound").resolves({
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
    sinon.stub(DAO.inflationadjustments, "getUnsent").resolves([]);
    sinon
      .stub(DAO.inflationadjustments, "getStatusCounts")
      .resolves([{ status: "expired", count: 360, monthlyIncreaseOre: 123400 }]);

    const overview = await callerWith(["admin"]).inflation.overview();

    expect(overview.eligibleTotals).to.deep.equal({
      count: 2,
      avtaleGiro: 1,
      vipps: 1,
      monthlyIncrease: "30.00",
      yearlyIncrease: "360.00",
    });
    expect(overview.eligible[0]).to.deep.include({
      currentAmount: "300.00",
      proposedAmount: "320.00",
      increase: "20.00",
    });
    expect(overview.statuses).to.deep.equal([
      { status: "expired", count: 360, monthlyIncrease: "1234.00" },
    ]);
    expect(overview.unsentTotals.count).to.equal(0);
  });

  it("prepares and logs the counts", async () => {
    sinon
      .stub(inflation, "prepareInflationOffers")
      .resolves({ created: 5, alreadyOpen: 0, expired: 0, inflationUntil: "2026-09" });
    const log = sinon.stub(DAO.logging, "add").resolves(1);

    const result = await callerWith(["admin"]).inflation.prepare();

    expect(result.created).to.equal(5);
    expect(log.calledOnce).to.be.true;
    expect(log.firstCall.args[0]).to.equal("Inflation adjustment");
  });

  it("sends a batch through the inflation email, within the batch limit", async () => {
    const send = sinon.stub(inflation, "sendInflationOffers").callsFake(async ({ sendEmail }) => ({
      sent: (await sendEmail(7)) ? 1 : 0,
      failed: 0,
      cancelled: 0,
      remaining: 0,
    }));
    sinon
      .stub(DAO.inflationadjustments, "getByIdForEmail")
      .resolves({ ID: 7, current_amount: 300, proposed_amount: 320 } as any);
    const email = sinon.stub(mail, "sendAgreementInflationAdjustment").resolves(true);
    sinon.stub(DAO.logging, "add").resolves(1);

    const result = await callerWith(["admin"]).inflation.send({ batchSize: 10 });

    expect(result.sent).to.equal(1);
    expect(send.firstCall.args[0].batchSize).to.equal(10);
    expect(email.firstCall.args[0]).to.deep.include({ ID: 7 });
    await expectTrpcError(
      callerWith(["admin"]).inflation.send({ batchSize: inflation.MAX_SEND_BATCH + 1 }),
      "BAD_REQUEST",
    );
  });
});
