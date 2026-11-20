import { describe, it, afterEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import type { Request, Response } from "express";
import { DAO } from "../custom_modules/DAO";
import type { Round, RoundSummary, Transfer } from "../custom_modules/regranting/types";
import { appRouter } from "../trpc/router";
import { createCallerFactory } from "../trpc/trpc";

const createCaller = createCallerFactory(appRouter);
const callerWith = (auth?: Record<string, unknown>) =>
  createCaller({ req: {} as Request, res: {} as Response, auth: auth as any }).regranting;
const admin = (claims: Record<string, unknown> = { sub: "auth0|bob", email: "bob@example.org" }) =>
  callerWith({ permissions: ["admin"], ...claims });

const expectTrpcError = async (promise: Promise<unknown>, code: string, message?: RegExp) => {
  try {
    await promise;
    expect.unreachable(`expected ${code}`);
  } catch (err: any) {
    expect(err.code, err.message).toBe(code);
    if (message) expect(err.message).toMatch(message);
  }
};

const arrayResults = new Set([
  "getBalances",
  "getOrganizations",
  "listFunds",
  "getFundGrants",
  "getTransfers",
  "listHolds",
  "getRoundDonations",
  "getFronted",
  "getLastTransfers",
  "listAdjustments",
  "getSnapshot",
  "listRoutings",
  "overlappingRoutings",
  "listProjects",
  "listPayees",
  "listRounds",
  "existingDonationIds",
  "getStatementRows",
  "getCommittedLines",
  "deleteRoundLinesFor",
  "listDocuments",
]);
const mapResults = new Set([
  "getPayeesAt",
  "getIncludeDirectOverrides",
  "getProjectOrganizations",
  "getProjectNames",
  "documentsFor",
]);

type Stubs = Record<keyof typeof DAO.regranting, MockInstance>;

/** Stubs every DAO.regranting function with an empty result; transactions run on a fake connection */
const stubDao = (): Stubs => {
  const stubs = {} as Stubs;
  for (const key of Object.keys(DAO.regranting) as (keyof typeof DAO.regranting)[]) {
    const stub: MockInstance = vi
      .spyOn(DAO.regranting as Record<string, (...args: any[]) => any>, key)
      .mockReturnValue(undefined);
    if (arrayResults.has(key)) stub.mockResolvedValue([]);
    else if (mapResults.has(key)) stub.mockResolvedValue(new Map());
    else stub.mockResolvedValue(null);
    stubs[key] = stub;
  }
  stubs.inTransaction.mockImplementation((fn: (conn: unknown) => unknown) => fn({ fake: true }));
  stubs.getUnassigned.mockResolvedValue({ amount: "0.00", donationCount: 0 });
  stubs.getOrganizations.mockResolvedValue([
    { id: 1, name: "AGF", abbriv: "AGF", isActive: true, ordering: 1 },
    { id: 3, name: "MC", abbriv: "MC", isActive: true, ordering: 3 },
    { id: 4, name: "Fund", abbriv: "GEBF", isActive: true, ordering: 4 },
  ]);
  return stubs;
};

const round = (overrides: Partial<Round> = {}): Round => ({
  id: 7,
  name: "Q3",
  kind: "regular",
  cutoff: "2026-09-30",
  status: "draft",
  minTransfer: "0.00",
  createdBy: "alice@example.org",
  createdAt: new Date("2026-10-01"),
  approvedBy: null,
  approvedAt: null,
  paidAt: null,
  notes: null,
  ...overrides,
});
const summary = (r: Round): RoundSummary => ({
  ...r,
  totalNok: "0.00",
  transferCount: 0,
  fundGrantCount: 0,
  fundGrantTotal: "0.00",
});

const transfer = (overrides: Partial<Transfer> = {}): Transfer => ({
  id: 70,
  roundId: 7,
  payee: { id: 10, name: "GiveWell", currency: "NOK" },
  amountNok: "1000.00",
  currency: "NOK",
  amountForeign: null,
  fxRate: null,
  bankFee: null,
  paidAt: null,
  bankRef: null,
  paidBy: "foundation",
  notes: null,
  documents: [],
  lines: [
    {
      id: 700,
      transferId: 70,
      organizationId: 1,
      organizationName: "AGF",
      projectId: null,
      projectName: null,
      amountNok: "1000.00",
    },
  ],
  ...overrides,
});

const balanceRow = (organizationId: number, allocations: string) => ({
  organizationId,
  projectId: null,
  opening: "0.00",
  allocations,
  fundGrantsIn: "0.00",
  fundGrantsOut: "0.00",
  transfers: "0.00",
  adjustments: "0.00",
  committed: "0.00",
  laterDebits: "0.00",
  inflowSince: "0.00",
});

describe("tRPC regranting", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("auth and input", () => {
    it("rejects anonymous and non-admin callers", async () => {
      const stubs = stubDao();
      await expectTrpcError(callerWith().rounds.list(), "UNAUTHORIZED");
      await expectTrpcError(
        callerWith({ permissions: ["read:profile"] }).balances.list(),
        "FORBIDDEN",
      );
      expect(stubs.listRounds).not.toHaveBeenCalled();
    });

    it("rejects unknown fields and invalid values", async () => {
      stubDao();
      await expectTrpcError(
        admin().rounds.list({ statuses: ["reconciled" as any] }),
        "BAD_REQUEST",
      );
      await expectTrpcError(admin().balances.list({ at: "30.09.2026" as any }), "BAD_REQUEST");
      await expectTrpcError(admin().holds.list({ extra: 1 } as any), "BAD_REQUEST");
      await expectTrpcError(
        admin().transfers.setLines({
          id: 1,
          lines: [
            { organizationId: 1, projectId: null, amountNok: 1 },
            { organizationId: 1, projectId: null, amountNok: 2 },
          ],
        }),
        "BAD_REQUEST",
        /appears twice/,
      );
      await expectTrpcError(
        admin().transfers.setLine({ id: 1, organizationId: 1, projectId: null, amountNok: 1.005 }),
        "BAD_REQUEST",
      );
    });

    it("major_donor rounds need donations and only they have them", async () => {
      stubDao();
      await expectTrpcError(
        admin().rounds.create({ name: "x", kind: "major_donor", cutoff: "2026-09-30" }),
        "BAD_REQUEST",
        /donationIds/,
      );
      await expectTrpcError(
        admin().rounds.create({
          name: "x",
          kind: "regular",
          cutoff: "2026-09-30",
          donationIds: [1],
        }),
        "BAD_REQUEST",
        /donationIds/,
      );
    });

    it("adjustment links match the type; fronted amounts are positive", async () => {
      stubDao();
      const base = { organizationId: 1, reason: "r", effectiveAt: "2026-09-30" };
      await expectTrpcError(
        admin().adjustments.create({ ...base, amount: 10, type: "fee", linkedTransferId: 1 }),
        "BAD_REQUEST",
        /Only corrections/,
      );
      await expectTrpcError(
        admin().adjustments.create({
          ...base,
          amount: 10,
          type: "correction",
          linkedDonationId: 1,
        }),
        "BAD_REQUEST",
        /Only fronted/,
      );
      await expectTrpcError(
        admin().adjustments.create({ ...base, amount: -10, type: "fronted" }),
        "BAD_REQUEST",
        /positive/,
      );
      await expectTrpcError(
        admin().adjustments.create({ ...base, amount: 0, type: "fee" }),
        "BAD_REQUEST",
      );
      await expectTrpcError(
        admin().adjustments.create({ ...base, amount: 5, type: "fee", reason: "   " }),
        "BAD_REQUEST",
      );
    });
  });

  describe("authors", () => {
    it("records the creator from the token's email claim, else its subject", async () => {
      const stubs = stubDao();
      stubs.createRound.mockResolvedValue(7);
      stubs.getRound.mockResolvedValue(round());
      stubs.getRoundSummary.mockResolvedValue(summary(round()));

      await admin().rounds.create({
        name: "Q3",
        kind: "regular",
        cutoff: "2026-09-30",
        propose: false,
      });
      expect(stubs.createRound.mock.calls[0][2]).toBe("bob@example.org");

      await admin({ sub: "auth0|carol" }).rounds.create({
        name: "Q3",
        kind: "regular",
        cutoff: "2026-09-30",
        propose: false,
      });
      expect(stubs.createRound.mock.calls[1][2]).toBe("auth0|carol");
      expect(stubs.createRound.mock.calls[0][1]).toEqual(
        expect.objectContaining({ minTransfer: 0 }),
      );
    });

    it("records who created an adjustment", async () => {
      const stubs = stubDao();
      stubs.createAdjustment.mockResolvedValue(5);
      stubs.getAdjustment.mockResolvedValue({ id: 5 });
      await admin({
        "https://gieffektivt.no/email": "nina@example.org",
        sub: "x",
      }).adjustments.create({
        organizationId: 1,
        amount: -100,
        type: "fee",
        reason: "Wire fee charged to recipient",
        effectiveAt: "2026-09-30",
      });
      expect(stubs.createAdjustment.mock.calls[0][1]).toBe("nina@example.org");
      expect(stubs.createAdjustment.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          projectId: null,
          roundId: null,
          linkedTransferId: null,
        }),
      );
    });
  });

  describe("approval", () => {
    it("requires someone other than the creator", async () => {
      const stubs = stubDao();
      stubs.lockRound.mockResolvedValue(round({ createdBy: "bob@example.org" }));
      await expectTrpcError(admin().rounds.approve({ id: 7 }), "FORBIDDEN", /someone other/);
      expect(stubs.setRoundApproved).not.toHaveBeenCalled();
    });

    it("returns the issues and changes nothing when validation finds errors", async () => {
      const stubs = stubDao();
      stubs.lockRound.mockResolvedValue(round());
      stubs.getRound.mockResolvedValue(round());
      stubs.getRoundSummary.mockResolvedValue(summary(round()));
      stubs.getTransfers.mockResolvedValue([transfer({ amountNok: "999.00" })]);
      stubs.getBalances.mockResolvedValue([balanceRow(1, "1000.00")]);
      stubs.getPayeesAt.mockResolvedValue(
        new Map([[1, { id: 10, name: "GiveWell", currency: "NOK" }]]),
      );

      const result = await admin().rounds.approve({ id: 7 });
      expect(result.approved).toBe(false);
      expect(result.issues.map((i) => i.code)).toStrictEqual(["transfer_lines_mismatch"]);
      expect(stubs.writeSnapshot).not.toHaveBeenCalled();
      expect(stubs.setRoundApproved).not.toHaveBeenCalled();
    });

    it("writes the snapshot and approves round and fund grants", async () => {
      const stubs = stubDao();
      stubs.lockRound.mockResolvedValue(round());
      stubs.getRound.mockResolvedValue(round());
      stubs.getRoundSummary.mockResolvedValue(summary(round({ status: "approved" })));
      stubs.getTransfers.mockResolvedValue([transfer()]);
      stubs.getBalances.mockResolvedValue([balanceRow(1, "1200.00")]);
      stubs.getPayeesAt.mockResolvedValue(
        new Map([[1, { id: 10, name: "GiveWell", currency: "NOK" }]]),
      );

      const result = await admin().rounds.approve({ id: 7 });
      expect(result.approved).toBe(true);
      expect(stubs.writeSnapshot.mock.calls[0][2]).toStrictEqual([
        {
          organizationId: 1,
          projectId: null,
          balanceAtCutoff: "1200.00",
          committed: "0.00",
          fundGrants: "0.00",
          inRound: "1000.00",
          roundAdjustments: "0.00",
          includedDirect: true,
        },
      ]);
      expect(stubs.setRoundApproved.mock.calls[0].slice(1)).toStrictEqual([7, "bob@example.org"]);
      // balances at the cutoff exclude the round itself
      expect(stubs.getBalances.mock.calls[0][0]).toStrictEqual({
        at: "2026-09-30",
        excludeRoundId: 7,
      });
    });

    it("only approves drafts", async () => {
      const stubs = stubDao();
      stubs.lockRound.mockResolvedValue(round({ status: "paid" }));
      await expectTrpcError(admin().rounds.approve({ id: 7 }), "CONFLICT", /never edited/);
      stubs.lockRound.mockResolvedValue(null);
      await expectTrpcError(admin().rounds.approve({ id: 7 }), "NOT_FOUND");
    });
  });

  describe("locking", () => {
    it("draft-only edits fail with CONFLICT on approved and paid rounds", async () => {
      const stubs = stubDao();
      stubs.getTransfer.mockResolvedValue(transfer());
      stubs.lockRound.mockResolvedValue(round({ status: "approved" }));
      await expectTrpcError(
        admin().transfers.setLine({ id: 70, organizationId: 1, projectId: null, amountNok: 5 }),
        "CONFLICT",
        /approved/,
      );
      stubs.lockRound.mockResolvedValue(round({ status: "paid" }));
      await expectTrpcError(admin().transfers.delete({ id: 70 }), "CONFLICT", /paid/);
      await expectTrpcError(
        admin().rounds.setIncludeDirect({ roundId: 7, organizationId: 1, includeDirect: true }),
        "CONFLICT",
      );
      expect(stubs.replaceTransferLines).not.toHaveBeenCalled();
      expect(stubs.deleteTransfer).not.toHaveBeenCalled();
      expect(stubs.setIncludeDirect).not.toHaveBeenCalled();
    });

    it("notes can be set and cleared in any status, also on paid rounds", async () => {
      const stubs = stubDao();
      stubs.getRoundSummary.mockResolvedValue(
        summary(round({ status: "paid", notes: "AMF got more" })),
      );
      stubs.getTransfer.mockResolvedValue(
        transfer({ paidAt: "2016-04-10", notes: "Held back 500 kr" }),
      );
      stubs.lockRound.mockResolvedValue(round({ status: "paid" }));

      const r = await admin().rounds.setNotes({ id: 7, notes: "  AMF got more\nsee bilag  " });
      expect(r.notes).toBe("AMF got more");
      expect(stubs.setRoundNotes.mock.calls[0].slice(0, 2)).toStrictEqual([
        7,
        "AMF got more\nsee bilag",
      ]);
      await admin().rounds.setNotes({ id: 7, notes: "   " });
      expect(stubs.setRoundNotes.mock.calls[1].slice(0, 2)).toStrictEqual([7, null]);

      const t = await admin().transfers.setNotes({ id: 70, notes: "Held back 500 kr" });
      expect(t.notes).toBe("Held back 500 kr");
      await admin().transfers.setNotes({ id: 70, notes: null });
      expect(stubs.setTransferNotes.mock.calls.map((a) => a.slice(0, 2))).toStrictEqual([
        [70, "Held back 500 kr"],
        [70, null],
      ]);
      // No round lock: notes are documentation, not money
      expect(stubs.lockRound).not.toHaveBeenCalled();

      await expectTrpcError(
        admin().rounds.setNotes({ id: 7, notes: "x".repeat(5001) }),
        "BAD_REQUEST",
      );
      stubs.getRoundSummary.mockResolvedValue(null);
      await expectTrpcError(admin().rounds.setNotes({ id: 8, notes: "x" }), "NOT_FOUND");
      stubs.getTransfer.mockResolvedValue(null);
      await expectTrpcError(admin().transfers.setNotes({ id: 71, notes: "x" }), "NOT_FOUND");
    });

    it("draft transfers take notes on create and update", async () => {
      const stubs = stubDao();
      stubs.getPayee.mockResolvedValue({ id: 10, name: "GiveWell", currency: "NOK" } as any);
      stubs.lockRound.mockResolvedValue(round());
      stubs.createTransfer.mockResolvedValue(70);
      stubs.getTransfer.mockResolvedValue(transfer());
      await admin().transfers.create({ roundId: 7, payeeId: 10, notes: " Mis-keyed KID " });
      expect(stubs.createTransfer.mock.calls[0][1].notes).toBe("Mis-keyed KID");
      await admin().transfers.update({ id: 70, notes: "" });
      expect(stubs.setTransferNotes.mock.calls[0].slice(0, 2)).toStrictEqual([70, null]);
      await admin().transfers.update({ id: 70, currency: "USD" });
      expect(stubs.setTransferNotes).toHaveBeenCalledOnce();
    });

    it("payments are recorded on approved rounds only, and all before marking paid", async () => {
      const stubs = stubDao();
      stubs.getTransfer.mockResolvedValue(transfer());
      stubs.lockRound.mockResolvedValue(round({ status: "draft" }));
      await expectTrpcError(
        admin().transfers.recordPayment({ id: 70, paidAt: "2026-10-05" }),
        "CONFLICT",
        /approve it first/,
      );
      stubs.lockRound.mockResolvedValue(round({ status: "approved" }));
      await admin().transfers.recordPayment({
        id: 70,
        paidAt: "2026-10-05",
        currency: "EUR",
        amountForeign: "86.81",
        fxRate: "11.52",
        bankFee: 30,
      });
      expect(stubs.recordPayment.mock.calls[0][2]).toStrictEqual({
        paidAt: "2026-10-05",
        currency: "EUR",
        amountForeign: "86.81",
        fxRate: "11.52",
        bankFee: 30,
        bankRef: null,
        paidBy: "foundation",
      });

      stubs.getTransfers.mockResolvedValue([
        transfer(),
        transfer({ id: 71, paidAt: "2026-10-05" }),
      ]);
      await expectTrpcError(admin().rounds.markPaid({ id: 7 }), "PRECONDITION_FAILED", /70/);
      expect(stubs.setRoundPaid).not.toHaveBeenCalled();
    });

    it("transfer setLine replaces just that line and syncs the amount", async () => {
      const stubs = stubDao();
      stubs.getTransfer.mockResolvedValue(transfer());
      stubs.lockRound.mockResolvedValue(round());
      await admin().transfers.setLine({
        id: 70,
        organizationId: 3,
        projectId: null,
        amountNok: 250,
      });
      expect(stubs.replaceTransferLines.mock.calls[0].slice(1)).toStrictEqual([
        70,
        [
          { organizationId: 1, projectId: null, amount: "1000.00" },
          { organizationId: 3, projectId: null, amount: 250 },
        ],
        true,
      ]);
      await admin().transfers.setLine({ id: 70, organizationId: 1, projectId: null, amountNok: 0 });
      expect(stubs.replaceTransferLines.mock.calls[1][2]).toStrictEqual([]);
    });

    it("adjustments in approved or paid rounds can't change", async () => {
      const stubs = stubDao();
      stubs.getAdjustment.mockResolvedValue({
        id: 5,
        roundId: 7,
        type: "correction",
        pairedAdjustmentId: null,
      });
      stubs.lockRound.mockResolvedValue(round({ status: "approved" }));
      await expectTrpcError(
        admin().adjustments.delete({ id: 5 }),
        "CONFLICT",
        /Q3 \(cutoff 30\.09\.2026\)/,
      );
      expect(stubs.deleteAdjustments).not.toHaveBeenCalled();
      // Attaching a new adjustment to an approved round locks it and fails too
      await expectTrpcError(
        admin().adjustments.create({
          organizationId: 1,
          amount: -10,
          type: "correction",
          reason: "r",
          effectiveAt: "2026-09-30",
          roundId: 7,
        }),
        "CONFLICT",
        /approved/,
      );
      expect(stubs.createAdjustment).not.toHaveBeenCalled();
    });

    it("half of an earmark is deleted with its pair and can't be edited alone", async () => {
      const stubs = stubDao();
      const half = {
        id: 5,
        roundId: 7,
        type: "reallocation",
        reason: "Earmarked for Water in Q3",
        pairedAdjustmentId: 6,
      };
      stubs.getAdjustment.mockResolvedValue(half);
      stubs.lockRound.mockResolvedValue(round());
      const result = await admin().adjustments.delete({ id: 5 });
      expect(result.deletedIds).toStrictEqual([5, 6]);
      expect(stubs.deleteAdjustments.mock.calls[0][1]).toStrictEqual([5, 6]);
      await expectTrpcError(
        admin().adjustments.update({
          id: 5,
          organizationId: 1,
          amount: -5,
          type: "reallocation",
          reason: "smaller",
          effectiveAt: "2026-09-30",
          roundId: 7,
        }),
        "CONFLICT",
        /half of an earmark/,
      );
      expect(stubs.updateAdjustment).not.toHaveBeenCalled();
    });

    it("fronted entries can be linked to their donation after the round is paid", async () => {
      const stubs = stubDao();
      stubs.getAdjustment.mockResolvedValue({ id: 5, roundId: 7, type: "fronted" });
      stubs.existingDonationIds.mockResolvedValue([123]);
      await admin().adjustments.linkDonation({ id: 5, donationId: 123 });
      expect(stubs.linkAdjustmentDonation.mock.calls[0]).toStrictEqual([5, 123]);
      stubs.getAdjustment.mockResolvedValue({ id: 6, roundId: null, type: "fee" });
      await expectTrpcError(
        admin().adjustments.linkDonation({ id: 6, donationId: 123 }),
        "BAD_REQUEST",
      );
    });
  });

  describe("references", () => {
    it("own funds can't be on transfer lines or receive fund grants", async () => {
      const stubs = stubDao();
      stubs.listFunds.mockResolvedValue([
        { organizationId: 4, name: "Fund", abbriv: "GEBF", maxHoldDays: null },
      ]);
      stubs.getFund.mockResolvedValue({
        organizationId: 4,
        name: "Fund",
        abbriv: "GEBF",
        maxHoldDays: null,
      });
      await expectTrpcError(
        admin().transfers.setLine({ id: 70, organizationId: 4, projectId: null, amountNok: 5 }),
        "BAD_REQUEST",
        /own fund/,
      );
      await expectTrpcError(
        admin().fundGrants.create({
          roundId: 7,
          fundId: 4,
          rationale: "r",
          lines: [{ organizationId: 4, projectId: null, amount: 5 }],
        }),
        "BAD_REQUEST",
        /own fund/,
      );
      stubs.getFund.mockResolvedValue(null);
      await expectTrpcError(
        admin().fundGrants.create({
          roundId: 7,
          fundId: 1,
          rationale: "r",
          lines: [{ organizationId: 3, projectId: null, amount: 5 }],
        }),
        "BAD_REQUEST",
        /AGF isn't an own fund/,
      );
    });

    it("routings may not overlap for a recipient", async () => {
      const stubs = stubDao();
      stubs.getPayee.mockResolvedValue({ id: 10 });
      stubs.overlappingRoutings.mockResolvedValue([
        { id: 1, payeeName: "GiveWell", validFrom: "2020-01-01", validTo: null },
      ]);
      await expectTrpcError(
        admin().routings.create({ organizationId: 3, payeeId: 11, validFrom: "2026-08-01" }),
        "CONFLICT",
        /GiveWell/,
      );
      await expectTrpcError(
        admin().routings.create({
          organizationId: 3,
          payeeId: 11,
          validFrom: "2026-08-01",
          validTo: "2026-07-01",
        }),
        "BAD_REQUEST",
      );
      expect(stubs.createRouting).not.toHaveBeenCalled();
    });
  });

  describe("major donor scoping in the builder", () => {
    it("leaves donations already passed on out of the chosen allocations", async () => {
      const stubs = stubDao();
      const md = round({ kind: "major_donor" });
      stubs.getRound.mockResolvedValue(md);
      stubs.getRoundSummary.mockResolvedValue(summary(md));
      stubs.getBalances.mockResolvedValue([balanceRow(3, "15000.00")]);
      stubs.getPayeesAt.mockResolvedValue(
        new Map([[3, { id: 10, name: "GiveWell", currency: "NOK" }]]),
      );
      const donation = {
        donorId: 1,
        sum: "10000.00",
        timestampConfirmed: new Date("2026-09-01"),
        afterCutoff: false,
        passedOnByRoundId: null,
        frontedByAdjustmentId: null,
        allocations: [{ organizationId: 3, amount: "10000.00" }],
      };
      stubs.getRoundDonations.mockResolvedValue([
        { ...donation, donationId: 1 },
        {
          ...donation,
          donationId: 2,
          sum: "4000.00",
          allocations: [{ organizationId: 3, amount: "4000.00" }],
          frontedByAdjustmentId: 9,
        },
        {
          ...donation,
          donationId: 3,
          sum: "500.00",
          allocations: [{ organizationId: 3, amount: "500.00" }],
          afterCutoff: true,
        },
      ]);

      const builder = await admin().rounds.builder({ id: 7 });
      const mc = builder.recipients.find((r) => r.organizationId === 3)!;
      expect(mc.chosenAllocations).toBe("10000.00");
      expect(mc.totals.proposed).toBe("10000.00");
      expect(
        builder.donations.map((d) => [d.donationId, d.inScope, d.excludedReason]),
      ).toStrictEqual([
        [1, true, null],
        [2, false, "passed_on"],
        [3, false, "after_cutoff"],
      ]);
      expect(builder.issues.map((i) => [i.code, i.donationId])).toStrictEqual([
        ["donation_already_passed_on", 2],
      ]);
    });
  });

  describe("payments", () => {
    const record = (extra: Record<string, unknown>) =>
      admin().transfers.recordPayment({ id: 70, paidAt: "2026-10-05", ...extra } as any);

    it("needs the foreign amount and FX rate of a foreign-currency transfer, and they add up", async () => {
      const stubs = stubDao();
      stubs.getTransfer.mockResolvedValue(transfer({ currency: "EUR" }));
      stubs.lockRound.mockResolvedValue(round({ status: "approved" }));
      await expectTrpcError(
        record({}),
        "BAD_REQUEST",
        /EUR transfer needs the amount paid in EUR and the FX rate/,
      );
      await expectTrpcError(record({ amountForeign: "86.81" }), "BAD_REQUEST", /needs the FX rate/);
      // 86.81 × 12.52 = 1086.86, the transfer is 1000: more than 5 kr apart
      await expectTrpcError(
        record({ amountForeign: "86.81", fxRate: "12.52" }),
        "BAD_REQUEST",
        /86\.81 EUR at 12\.52 NOK\/EUR is 1\s086,86\skr, but the transfer is 1\s000,00\skr/,
      );
      expect(stubs.recordPayment).not.toHaveBeenCalled();
      await record({ amountForeign: "86.81", fxRate: "11.52" }); // 1000.05: within 5 kr
      expect(stubs.recordPayment).toHaveBeenCalledOnce();
    });

    it("a NOK transfer has no foreign amount or FX rate", async () => {
      const stubs = stubDao();
      stubs.getTransfer.mockResolvedValue(transfer());
      stubs.lockRound.mockResolvedValue(round({ status: "approved" }));
      await expectTrpcError(
        record({ fxRate: "1" }),
        "BAD_REQUEST",
        /NOK transfer has no foreign amount/,
      );
      await expectTrpcError(record({ bankFee: -1 }), "BAD_REQUEST");
      // The currency in the input wins over the transfer's
      await expectTrpcError(record({ currency: "USD" }), "BAD_REQUEST", /USD transfer needs/);
      expect(stubs.recordPayment).not.toHaveBeenCalled();
    });
  });

  describe("saving the builder's payments", () => {
    const basis = [{ id: 70, lines: [{ organizationId: 1, projectId: null, amountNok: 1000 }] }];
    const plan = {
      roundId: 7,
      basis,
      setLines: [{ id: 70, lines: [{ organizationId: 1, projectId: null, amountNok: 600 }] }],
      create: [{ payeeId: 11, lines: [{ organizationId: 3, projectId: null, amountNok: 400 }] }],
    };

    /** inTransaction keeps the writes of a callback that throws out of the "database" */
    const transactional = (stubs: Stubs) => {
      const committed: string[] = [];
      stubs.inTransaction.mockImplementation(async (fn: (conn: unknown) => unknown) => {
        const conn = { pending: [] as string[] };
        const result = await fn(conn);
        committed.push(...conn.pending);
        return result;
      });
      stubs.createTransfer.mockImplementation(
        async (conn: { pending: string[] }, t: { payeeId: number }) => {
          conn.pending.push(`create payee ${t.payeeId}`);
          return 71;
        },
      );
      stubs.replaceTransferLines.mockImplementation(
        async (conn: { pending: string[] }, id: number) => {
          conn.pending.push(`lines ${id}`);
        },
      );
      return committed;
    };

    const setUp = () => {
      const stubs = stubDao();
      stubs.lockRound.mockResolvedValue(round());
      stubs.getTransfers.mockResolvedValue([transfer()]);
      stubs.getPayee.mockResolvedValue({ id: 11, name: "MC", currency: "NOK" });
      return stubs;
    };

    it("applies the whole plan in one transaction", async () => {
      const stubs = setUp();
      const committed = transactional(stubs);
      expect(await admin().transfers.savePayments(plan)).toStrictEqual({ updated: 1, created: 1 });
      expect(stubs.inTransaction).toHaveBeenCalledOnce();
      expect(committed).toStrictEqual(["lines 70", "create payee 11", "lines 71"]);
    });

    it("saves nothing when a step fails", async () => {
      const stubs = setUp();
      const committed = transactional(stubs);
      // Saving transfer 71 fails; other transfers keep the fake above
      const replaceLines = stubs.replaceTransferLines.getMockImplementation()!;
      stubs.replaceTransferLines.mockImplementation(async (...args: any[]) => {
        if (args[1] === 71) throw new Error("connection lost");
        return replaceLines(...args);
      });
      try {
        await admin().transfers.savePayments(plan);
        expect.unreachable("expected the save to fail");
      } catch (err: any) {
        expect(err.message).toMatch(/connection lost/);
      }
      expect(committed).toStrictEqual([]);
    });

    it("refuses a plan made from transfers that have changed (a retry after a lost response)", async () => {
      const stubs = setUp();
      const committed = transactional(stubs);
      // The first save went through: the round now has the updated line and a new transfer
      stubs.getTransfers.mockResolvedValue([
        transfer({ lines: [{ ...transfer().lines[0], amountNok: "600.00" }] }),
        transfer({ id: 71, payee: { id: 11, name: "MC", currency: "NOK" } }),
      ]);
      await expectTrpcError(admin().transfers.savePayments(plan), "CONFLICT", /changed since/);
      expect(committed).toStrictEqual([]);
      expect(stubs.createTransfer).not.toHaveBeenCalled();
    });

    it("only edits the round's own transfers, and only in a draft", async () => {
      const stubs = setUp();
      await expectTrpcError(
        admin().transfers.savePayments({ ...plan, setLines: [{ ...plan.setLines[0], id: 99 }] }),
        "BAD_REQUEST",
        /isn't in this round/,
      );
      stubs.lockRound.mockResolvedValue(round({ status: "approved" }));
      await expectTrpcError(admin().transfers.savePayments(plan), "CONFLICT");
      expect(stubs.replaceTransferLines).not.toHaveBeenCalled();
    });
  });

  describe("adjustments attached to a round", () => {
    const adjustment = (overrides: Record<string, unknown>) => ({
      id: 1,
      organizationId: 1,
      organizationName: "AGF",
      projectId: null,
      projectName: null,
      amount: "0.00",
      type: "reallocation",
      reason: "r",
      effectiveAt: "2026-09-30",
      roundId: 7,
      linkedTransferId: null,
      linkedDonationId: null,
      documents: [],
      createdBy: "alice@example.org",
      createdAt: new Date("2026-10-01"),
      pairedAdjustmentId: null,
      roundStatus: "draft",
      pending: true,
      affectsBalance: false,
      ...overrides,
    });

    it("count in the round's own positions and proposal, kept apart from the balance", async () => {
      const stubs = stubDao();
      stubs.getRound.mockResolvedValue(round());
      stubs.getRoundSummary.mockResolvedValue(summary(round()));
      stubs.getBalances.mockResolvedValue([balanceRow(1, "1000.00")]);
      stubs.getPayeesAt.mockResolvedValue(
        new Map([[1, { id: 10, name: "GiveWell", currency: "NOK" }]]),
      );
      stubs.getProjectNames.mockResolvedValue(new Map([[61, { name: "Water", status: "active" }]]));
      stubs.listAdjustments.mockResolvedValue([
        adjustment({ id: 1, amount: "-300.00", pairedAdjustmentId: 2 }),
        adjustment({
          id: 2,
          projectId: 61,
          projectName: "Water",
          amount: "300.00",
          pairedAdjustmentId: 1,
        }),
        adjustment({ id: 3, type: "fronted", amount: "50.00" }), // a record only
        adjustment({ id: 4, amount: "20.00", effectiveAt: "2026-10-05" }), // after the cutoff
      ]);

      const builder = await admin().rounds.builder({ id: 7 });
      const agf = builder.recipients.find((r) => r.organizationId === 1)!;
      expect(
        agf.lines.map((l) => [
          l.projectName,
          l.balanceAtCutoff,
          l.roundAdjustments,
          l.available,
          l.proposed,
        ]),
      ).toStrictEqual([
        [null, "1000.00", "-300.00", "700.00", "700.00"],
        ["Water", "0.00", "300.00", "300.00", "300.00"],
      ]);
      expect(stubs.listAdjustments.mock.calls[0][0]).toStrictEqual({ roundId: 7 });
    });

    it("are paid in rounds without direct donations too", async () => {
      const stubs = stubDao();
      const r = round({ kind: "fund_grant" });
      stubs.getRound.mockResolvedValue(r);
      stubs.getRoundSummary.mockResolvedValue(summary(r));
      stubs.getBalances.mockResolvedValue([balanceRow(1, "1000.00"), balanceRow(3, "500.00")]);
      stubs.getPayeesAt.mockResolvedValue(
        new Map([
          [1, { id: 10, name: "GiveWell", currency: "NOK" }],
          [3, { id: 10, name: "GiveWell", currency: "NOK" }],
        ]),
      );
      stubs.listAdjustments.mockResolvedValue([
        adjustment({ id: 1, amount: "-300.00", pairedAdjustmentId: 2 }),
        adjustment({ id: 2, projectId: 61, amount: "300.00", pairedAdjustmentId: 1 }),
      ]);
      const builder = await admin().rounds.builder({ id: 7 });
      const agf = builder.recipients.find((x) => x.organizationId === 1)!;
      expect(agf.lines.map((l) => [l.projectId, l.proposed])).toStrictEqual([
        [null, "0.00"],
        [61, "300.00"],
      ]);
      // In the round: AGF has adjustments here; MC only has a balance
      expect(builder.recipients.map((x) => [x.organizationId, x.inRound])).toStrictEqual([
        [1, true],
        [3, false],
      ]);
    });

    it("the snapshot keeps them apart", async () => {
      const stubs = stubDao();
      stubs.lockRound.mockResolvedValue(round());
      stubs.getRound.mockResolvedValue(round());
      stubs.getRoundSummary.mockResolvedValue(summary(round({ status: "approved" })));
      stubs.getBalances.mockResolvedValue([balanceRow(1, "1000.00")]);
      stubs.getPayeesAt.mockResolvedValue(
        new Map([[1, { id: 10, name: "GiveWell", currency: "NOK" }]]),
      );
      stubs.getTransfers.mockResolvedValue([
        transfer({ amountNok: "700.00", lines: [{ ...transfer().lines[0], amountNok: "700.00" }] }),
      ]);
      stubs.listAdjustments.mockResolvedValue([adjustment({ amount: "-300.00" })]);
      await admin().rounds.approve({ id: 7 });
      expect(stubs.writeSnapshot.mock.calls[0][2][0]).toEqual(
        expect.objectContaining({
          balanceAtCutoff: "1000.00",
          roundAdjustments: "-300.00",
          inRound: "700.00",
        }),
      );
    });
  });

  describe("builder scope", () => {
    it("flags recipients the round touches: lines, grant lines, chosen donations or an override", async () => {
      const stubs = stubDao();
      const r = round({ kind: "extraordinary" });
      stubs.getRound.mockResolvedValue(r);
      stubs.getRoundSummary.mockResolvedValue(summary(r));
      stubs.getBalances.mockResolvedValue([balanceRow(1, "1000.00"), balanceRow(3, "500.00")]);
      stubs.getIncludeDirectOverrides.mockResolvedValue(new Map([[3, false]]));
      let builder = await admin().rounds.builder({ id: 7 });
      expect(builder.recipients.map((x) => [x.organizationId, x.inRound])).toStrictEqual([
        [1, false],
        [3, true], // an override, even one that leaves direct donations out
      ]);
      stubs.getIncludeDirectOverrides.mockResolvedValue(new Map());
      stubs.getTransfers.mockResolvedValue([
        transfer({ lines: [{ ...transfer().lines[0], amountNok: "1.00" }], amountNok: "1.00" }),
      ]);
      builder = await admin().rounds.builder({ id: 7 });
      expect(builder.recipients.map((x) => [x.organizationId, x.inRound])).toStrictEqual([
        [1, true],
        [3, false],
      ]);
    });
  });

  describe("earmarks", () => {
    const project = (organizationId: number) => ({
      id: 61,
      organizationId,
      organizationName: organizationId === 1 ? "AGF" : "MC",
      name: "Water",
    });
    const setUp = () => {
      const stubs = stubDao();
      stubs.lockRound.mockResolvedValue(round());
      stubs.getRound.mockResolvedValue(round());
      stubs.getRoundSummary.mockResolvedValue(summary(round()));
      stubs.getBalances.mockResolvedValue([balanceRow(1, "1200.00")]);
      stubs.getPayeesAt.mockResolvedValue(
        new Map([[1, { id: 10, name: "GiveWell", currency: "NOK" }]]),
      );
      stubs.getTransfers.mockResolvedValue([transfer()]); // AGF unrestricted pays 1000
      stubs.getProject.mockResolvedValue(project(1));
      stubs.createAdjustment.mockResolvedValueOnce(11).mockResolvedValueOnce(12);
      return stubs;
    };

    it("writes the paired adjustments and moves Pay now, in one transaction", async () => {
      const stubs = setUp();
      await admin().rounds.earmark({
        roundId: 7,
        organizationId: 1,
        projectId: 61,
        amount: 400,
        note: "Grant letter 12",
      });
      expect(stubs.inTransaction).toHaveBeenCalledOnce();
      const [from, to] = stubs.createAdjustment.mock.calls;
      expect(from[0]).toEqual(
        expect.objectContaining({
          organizationId: 1,
          projectId: null,
          amount: -400,
          type: "reallocation",
          effectiveAt: "2026-09-30",
          roundId: 7,
          reason: "Earmarked for Water in Q3: Grant letter 12",
        }),
      );
      expect(to[0]).toEqual(expect.objectContaining({ projectId: 61, amount: 400, roundId: 7 }));
      expect(from[1]).toBe("bob@example.org");
      expect(from[2]).toStrictEqual({ fake: true });
      expect(stubs.pairAdjustments.mock.calls[0].slice(1)).toStrictEqual([11, 12]);
      expect(stubs.replaceTransferLines.mock.calls[0].slice(1)).toStrictEqual([
        70,
        [
          { organizationId: 1, projectId: null, amount: "600.00" },
          { organizationId: 1, projectId: 61, amount: "400.00" },
        ],
        true,
      ]);
    });

    it("moves at most what the unrestricted line pays", async () => {
      const stubs = setUp();
      await admin().rounds.earmark({ roundId: 7, organizationId: 1, projectId: 61, amount: 1200 });
      expect(stubs.replaceTransferLines.mock.calls[0][2]).toStrictEqual([
        { organizationId: 1, projectId: 61, amount: "1000.00" },
      ]);
    });

    it("checks the project, the amount and that the round is a draft", async () => {
      const stubs = setUp();
      stubs.getProject.mockResolvedValue(project(3));
      await expectTrpcError(
        admin().rounds.earmark({ roundId: 7, organizationId: 1, projectId: 61, amount: 100 }),
        "BAD_REQUEST",
        /Water is a project at MC, not at AGF/,
      );
      stubs.getProject.mockResolvedValue(project(1));
      await expectTrpcError(
        admin().rounds.earmark({ roundId: 7, organizationId: 1, projectId: 61, amount: 1200.01 }),
        "BAD_REQUEST",
        /AGF has 1\s200,00\skr unrestricted available in Q3 \(cutoff 30\.09\.2026\)/,
      );
      stubs.lockRound.mockResolvedValue(round({ status: "approved" }));
      await expectTrpcError(
        admin().rounds.earmark({ roundId: 7, organizationId: 1, projectId: 61, amount: 100 }),
        "CONFLICT",
        /Can't earmark money in Q3 \(cutoff 30\.09\.2026\): it is approved/,
      );
      expect(stubs.createAdjustment).not.toHaveBeenCalled();
      expect(stubs.replaceTransferLines).not.toHaveBeenCalled();
    });

    it("removing one deletes both halves and moves Pay now back", async () => {
      const stubs = setUp();
      const half = (id: number, projectId: number | null, amount: string, paired: number) => ({
        id,
        organizationId: 1,
        organizationName: "AGF",
        projectId,
        amount,
        type: "reallocation",
        roundId: 7,
        pairedAdjustmentId: paired,
      });
      const adjustments = new Map<unknown, unknown>([
        [11, half(11, null, "-400.00", 12)],
        [12, half(12, 61, "400.00", 11)],
      ]);
      // Unknown ids keep stubDao's default (null)
      stubs.getAdjustment.mockImplementation(async (id) => adjustments.get(id) ?? null);
      stubs.getTransfers.mockResolvedValue([
        transfer({
          lines: [
            { ...transfer().lines[0], amountNok: "600.00" },
            {
              ...transfer().lines[0],
              id: 701,
              projectId: 61,
              projectName: "Water",
              amountNok: "400.00",
            },
          ],
        }),
      ]);
      await admin().rounds.removeEarmark({ adjustmentId: 11 });
      expect(stubs.replaceTransferLines.mock.calls[0][2]).toStrictEqual([
        { organizationId: 1, projectId: null, amount: "1000.00" },
      ]);
      expect(stubs.deleteAdjustments.mock.calls[0][1]).toStrictEqual([11, 12]);

      adjustments.set(13, { ...half(13, null, "-5.00", 0), pairedAdjustmentId: null, type: "fee" });
      await expectTrpcError(
        admin().rounds.removeEarmark({ adjustmentId: 13 }),
        "BAD_REQUEST",
        /isn't an earmark/,
      );
    });
  });

  describe("messages", () => {
    it("name things and write dates as dd.mm.yyyy", async () => {
      const stubs = stubDao();
      stubs.getPayee.mockResolvedValue({ id: 10 });
      stubs.overlappingRoutings.mockResolvedValue([
        {
          id: 1,
          organizationName: "Malaria Consortium",
          payeeName: "GiveWell",
          validFrom: "2020-01-01",
          validTo: "2026-07-31",
        },
      ]);
      await expectTrpcError(
        admin().routings.create({ organizationId: 3, payeeId: 11, validFrom: "2026-07-01" }),
        "CONFLICT",
        /^Malaria Consortium is already routed to GiveWell from 01\.01\.2020 to 31\.07\.2026; end that routing first$/,
      );
      await expectTrpcError(
        admin().transfers.setLine({ id: 70, organizationId: 99, projectId: null, amountNok: 5 }),
        "BAD_REQUEST",
        /^Recipient #99 doesn't exist$/,
      );
      stubs.getTransfers.mockResolvedValue([transfer()]);
      stubs.lockRound.mockResolvedValue(round({ status: "approved" }));
      await expectTrpcError(
        admin().rounds.markPaid({ id: 7 }),
        "PRECONDITION_FAILED",
        /^Record the payment of the transfer to GiveWell \(1\s000,00\skr, #70\) first$/,
      );
    });

    it("turn a delete of something still in use into a CONFLICT that says what to do", async () => {
      const stubs = stubDao();
      stubs.getPayee.mockResolvedValue({ id: 10, name: "GiveWell" });
      stubs.deletePayee.mockRejectedValue(
        Object.assign(new Error("ER_ROW_IS_REFERENCED_2"), { errno: 1451 }),
      );
      await expectTrpcError(
        admin().payees.delete({ id: 10 }),
        "CONFLICT",
        /GiveWell is still used by routings or transfers; mark it inactive instead/,
      );
    });
  });

  describe("statements", () => {
    it("show adjustments of draft rounds as pending, outside the running balance", async () => {
      const stubs = stubDao();
      const row = {
        projectId: null,
        donationCount: null,
        roundId: null,
        roundName: null,
        transferId: null,
        transferLineId: null,
        payeeName: null,
        bankRef: null,
        transferNotes: null,
        fundGrantId: null,
        fundGrantLineId: null,
        counterpartOrganizationId: null,
        rationale: null,
        adjustmentId: null,
        adjustmentType: null,
        reason: null,
        createdBy: null,
        pending: false,
      };
      stubs.getStatementRows.mockResolvedValue([
        { ...row, date: "2026-09-01", kind: "allocations", amount: "1000.00", donationCount: 3 },
        {
          ...row,
          date: "2026-09-30",
          kind: "adjustment",
          amount: "-300.00",
          adjustmentType: "reallocation",
          roundId: 7,
          pending: true,
        },
      ]);
      const s = await admin().statements.recipient({
        organizationId: 1,
        from: "2026-09-01",
        to: "2026-09-30",
      });
      expect(
        s.entries.map((e) => [e.amount, e.pending, e.affectsBalance, e.balanceAfter]),
      ).toStrictEqual([
        ["1000.00", false, true, "1000.00"],
        ["-300.00", true, false, "1000.00"],
      ]);
      expect(s.closingBalance).toBe("1000.00");
    });
  });

  describe("DAO getBalances", () => {
    it("passes one parameter per placeholder, with and without a recipient filter", async () => {
      vi.restoreAllMocks();
      const query = vi.spyOn(DAO, "query").mockResolvedValue([[], []] as any);
      await DAO.regranting.getBalances({ at: "2026-09-30" });
      await DAO.regranting.getBalances({
        at: "2026-09-30",
        organizationIds: [1, 2],
        excludeRoundId: 3,
        inflowSince: "2026-06-30",
      });
      for (const args of query.mock.calls) {
        const [sql, params] = args as [string, unknown[]];
        expect((sql.match(/\?/g) ?? []).length).toBe(params.length);
      }
      const [, filtered] = query.mock.calls[1] as [string, unknown[]];
      expect(filtered[0]).toBe("2026-06-30");
      expect(filtered.filter((p) => Array.isArray(p))).toHaveLength(5);
      // excludeRoundId leaves the round's fund grants, transfer lines and adjustments out
      expect(filtered.filter((p) => p === 3)).toHaveLength(4);
    });

    it("returns nothing for an empty recipient filter without querying", async () => {
      vi.restoreAllMocks();
      const query = vi.spyOn(DAO, "query").mockReturnValue(undefined as any);
      expect(
        await DAO.regranting.getBalances({ at: "2026-09-30", organizationIds: [] }),
      ).toStrictEqual([]);
      expect(query).not.toHaveBeenCalled();
    });
  });
});
