import { describe, it, afterEach } from "vitest";
import { expect } from "chai";
import { readFileSync } from "fs";
import { join } from "path";
import { DateTime } from "luxon";
import sinon from "sinon";
import { DAO } from "../custom_modules/DAO";
import type {
  InflationCandidate,
  UnsentInflationAdjustment,
} from "../custom_modules/DAO_modules/inflationadjustment";
import {
  createSsbInflation,
  evaluateAmount,
  lastChangeMonth,
  MAX_SEND_BATCH,
  prepareInflationOffers,
  previewInflationRound,
  sendInflationOffers,
  type InflationSource,
} from "../custom_modules/inflationadjustment";

const NOW = DateTime.fromISO("2026-10-31T12:00:00", { zone: "Europe/Oslo" });

/** SSB's calculator: `change` for valid months, an error for months not published yet */
const ssbFetch = (rates: Record<string, number>, latest = "2026-09") =>
  sinon.spy(async (url: string) => {
    const p = new URL(url).searchParams;
    const start = `${p.get("startYear")}-${p.get("startMonth")}`;
    const end = `${p.get("endYear")}-${p.get("endMonth")}`;
    if (end > latest) {
      return { json: async () => ({ error: "Sluttmåned er ikke gyldig for denne utregningen" }) };
    }
    return { json: async () => ({ change: start === end ? 0 : (rates[start] ?? 0) }) };
  });

const candidate = (overrides: Partial<InflationCandidate> = {}): InflationCandidate => ({
  type: "avtaleGiro",
  agreementId: "1",
  KID: "000000000000001",
  donorId: 10,
  donorName: "Test",
  email: "test@example.org",
  amountOre: 30000,
  created: new Date("2022-03-10T10:00:00Z"),
  lastDifferentDonation: null,
  ...overrides,
});

const fixedInflation = (rates: Record<string, number>): InflationSource =>
  createSsbInflation(ssbFetch(rates));

describe("inflation adjustment", () => {
  afterEach(() => sinon.restore());

  describe("last amount change", () => {
    it("is the month after the latest donation with a different sum, in Oslo time", () => {
      // 23:30 UTC on 31 January is 1 February in Oslo, so the change is in March
      expect(
        lastChangeMonth({
          created: new Date("2020-01-01T00:00:00Z"),
          lastDifferentDonation: new Date("2026-01-31T23:30:00Z"),
        }),
      ).to.deep.equal({ year: 2026, month: 3 });
      expect(
        lastChangeMonth({
          created: null,
          lastDifferentDonation: new Date("2025-12-20T00:00:00Z"),
        }),
      ).to.deep.equal({ year: 2026, month: 1 });
    });

    it("is the creation month when every donation had the current amount", () => {
      expect(
        lastChangeMonth({ created: new Date("2023-05-31T22:30:00Z"), lastDifferentDonation: null }),
      ).to.deep.equal({ year: 2023, month: 6 });
      expect(lastChangeMonth({ created: null, lastDifferentDonation: null })).to.equal(null);
    });

    it("compares AvtaleGiro amounts in øre with donation sums in kroner, by payment method", async () => {
      const query = sinon.stub(DAO, "query").resolves([[], []] as any);
      await DAO.inflationadjustments.getCandidates();
      const sql = query.firstCall.args[0] as string;
      expect(sql).to.contain("Don.sum_confirmed * 100 <> AG.amount");
      expect(sql).to.contain("Don.Payment_ID = 7");
      expect(sql).to.contain("Don.sum_confirmed <> VA.amount");
      expect(sql).to.contain("Don.Payment_ID = 8");
      expect(sql).to.contain("VA.amount * 100 AS amountOre");
      // The anonymous donor never gets an offer
      expect(sql).to.contain("D.Donor_ID <> 1464");
      expect(sql).to.contain("VA.donorID <> 1464");
      // Open or recent offers block; old expired ones don't
      expect(sql).to.contain("A.status IN ('new', 'sending')");
      expect(sql).to.contain("A.status = 'pending' AND A.expires > UTC_TIMESTAMP()");
      expect(sql).to.contain("A.created > NOW() - INTERVAL 12 MONTH");
    });
  });

  describe("amount rules", () => {
    it("needs at least 5 % inflation", () => {
      expect(evaluateAmount(30000, 0.049)).to.deep.equal({
        eligible: false,
        reason: "lowInflation",
      });
      expect(evaluateAmount(30000, 0.05)).to.deep.equal({
        eligible: true,
        proposedOre: 32000, // 315 kr rounds to 320 kr
        increaseOre: 2000,
      });
    });

    it("rounds the new amount to the nearest 10 kr", () => {
      expect(evaluateAmount(50000, 0.064)).to.deep.include({ proposedOre: 53000 }); // 532
      expect(evaluateAmount(50000, 0.07)).to.deep.include({ proposedOre: 54000 }); // 535
      expect(evaluateAmount(100000, 0.0644)).to.deep.include({ proposedOre: 106000 }); // 1064.4
    });

    it("needs an increase of at least 10 kr after rounding", () => {
      // 50 kr * 1.06 = 53 kr, rounds to 50 kr: no increase
      expect(evaluateAmount(5000, 0.06)).to.deep.equal({
        eligible: false,
        reason: "smallIncrease",
      });
      // 100 kr * 1.06 = 106 kr, rounds to 110 kr
      expect(evaluateAmount(10000, 0.06)).to.deep.include({ eligible: true, increaseOre: 1000 });
    });
  });

  describe("SSB inflation", () => {
    it("uses the latest published month and fetches each start month once", async () => {
      const fetch = ssbFetch({ "2024-10": 0.0645, "2025-01": 0.06 });
      const ssb = createSsbInflation(fetch);

      const end = await ssb.latestMonth(NOW);
      expect(end).to.deep.equal({ year: 2026, month: 9 });
      const rates = await ssb.since(
        [
          { year: 2024, month: 10 },
          { year: 2025, month: 1 },
          { year: 2024, month: 10 },
        ],
        end,
      );
      expect(rates.get("2024-10")).to.equal(0.0645);
      expect(rates.get("2025-01")).to.equal(0.06);
      // 2026-09/2026-09 for the latest month, then one per start month
      expect(fetch.callCount).to.equal(3);

      await ssb.latestMonth(NOW);
      await ssb.since([{ year: 2024, month: 10 }], end);
      expect(fetch.callCount).to.equal(3);
    });

    it("falls back to earlier months until SSB has one", async () => {
      const fetch = ssbFetch({}, "2026-07");
      expect(await createSsbInflation(fetch).latestMonth(NOW)).to.deep.equal({
        year: 2026,
        month: 7,
      });
      expect(fetch.callCount).to.equal(3); // 09, 08, 07
    });

    it("fails when SSB has nothing for a year", async () => {
      const fetch = ssbFetch({}, "2020-01");
      try {
        await createSsbInflation(fetch).latestMonth(NOW);
        expect.fail("expected an error");
      } catch (err: any) {
        expect(err.message).to.contain("SSB");
      }
    });

    it("treats a start month at or after the latest month as no inflation", async () => {
      const fetch = ssbFetch({});
      const rates = await createSsbInflation(fetch).since([{ year: 2026, month: 10 }], {
        year: 2026,
        month: 9,
      });
      expect(rates.get("2026-10")).to.equal(0);
      expect(fetch.called).to.be.false;
    });
  });

  describe("preview", () => {
    it("applies the 12-month rule from the last change and the amount rules", async () => {
      sinon.stub(DAO.inflationadjustments, "getCandidates").resolves([
        // Created in 2022, never changed: inflation since 2022-03
        candidate({ agreementId: "1" }),
        // Changed in March 2026: too recent
        candidate({
          agreementId: "2",
          lastDifferentDonation: new Date("2026-02-20T00:00:00Z"),
        }),
        // Changed in November 2025 (11 months): too recent
        candidate({
          agreementId: "3",
          lastDifferentDonation: new Date("2025-10-20T00:00:00Z"),
        }),
        // Changed in October 2025 (12 months), but under 5 % since
        candidate({
          agreementId: "4",
          lastDifferentDonation: new Date("2025-09-20T00:00:00Z"),
        }),
        // Vipps, created October 2024
        candidate({
          type: "vipps",
          agreementId: "abc",
          amountOre: 20000,
          created: new Date("2024-10-05T08:00:00Z"),
        }),
        // Too small to reach 10 kr
        candidate({ agreementId: "5", amountOre: 5000, created: new Date("2024-10-05") }),
        candidate({ agreementId: "6", email: " " }),
      ]);

      const preview = await previewInflationRound({
        now: NOW,
        inflation: fixedInflation({ "2022-03": 0.2, "2025-10": 0.03, "2024-10": 0.0645 }),
      });

      expect(preview.inflationUntil).to.equal("2026-09");
      expect(preview.proposals.map((p) => [p.type, p.agreementId, p.proposedOre])).to.deep.equal([
        ["avtaleGiro", "1", 36000],
        ["vipps", "abc", 21000],
      ]);
      expect(preview.proposals[0]).to.deep.include({
        currentOre: 30000,
        increaseOre: 6000,
        inflation: 0.2,
        lastChange: "2022-03",
        monthsSinceChange: 55,
      });
      expect(preview.skipped).to.deep.equal({
        unknownStart: 0,
        changedRecently: 2,
        lowInflation: 1,
        smallIncrease: 1,
        noEmail: 1,
      });
    });

    it("reads only", async () => {
      sinon.stub(DAO.inflationadjustments, "getCandidates").resolves([candidate()]);
      const create = sinon.stub(DAO.inflationadjustments, "createIfNoOpenOffer");
      await previewInflationRound({ now: NOW, inflation: fixedInflation({ "2022-03": 0.2 }) });
      expect(create.called).to.be.false;
    });
  });

  describe("prepare", () => {
    it("adds a new offer per eligible agreement, and none twice", async () => {
      sinon.stub(DAO.inflationadjustments, "expirePending").resolves(2);
      sinon
        .stub(DAO.inflationadjustments, "getCandidates")
        .resolves([candidate({ agreementId: "1" }), candidate({ agreementId: "2" })]);
      const create = sinon.stub(DAO.inflationadjustments, "createIfNoOpenOffer");
      create.onFirstCall().resolves(true);
      create.onSecondCall().resolves(false); // prepared concurrently: the INSERT skips it

      const result = await prepareInflationOffers({
        now: NOW,
        inflation: fixedInflation({ "2022-03": 0.2 }),
      });

      expect(result).to.deep.equal({
        created: 1,
        alreadyOpen: 1,
        expired: 2,
        inflationUntil: "2026-09",
      });
      expect(create.firstCall.args[0]).to.deep.equal({
        agreementId: "1",
        agreementType: "avtaleGiro",
        currentAmount: 30000,
        proposedAmount: 36000,
        inflationPercentage: 0.2,
      });
    });

    it("only inserts when no blocking offer exists, in the same statement", async () => {
      const query = sinon.stub(DAO, "query").resolves([{ affectedRows: 0 }, []] as any);
      const added = await DAO.inflationadjustments.createIfNoOpenOffer({
        agreementId: 5,
        agreementType: "vipps",
        currentAmount: 10000,
        proposedAmount: 11000,
        inflationPercentage: 0.06,
      });
      expect(added).to.equal(false);
      const sql = (query.firstCall.args[0] as string).replace(/\s+/g, " ");
      expect(sql).to.contain("SELECT ?, ?, ?, ?, ?, ?, 'new', ? FROM DUAL WHERE NOT EXISTS");
      expect(sql).to.contain("A.status IN ('new', 'sending')");
    });
  });

  describe("send", () => {
    const unsent = (ID: number, stillValid = true): UnsentInflationAdjustment => ({
      ID,
      agreementType: "avtaleGiro",
      agreementId: String(ID),
      donorId: 10,
      donorName: "Test",
      email: "test@example.org",
      currentAmount: 30000,
      proposedAmount: 32000,
      inflationPercentage: 0.06,
      created: new Date(),
      stillValid,
    });

    const stubSend = (rows: UnsentInflationAdjustment[], claimed: (id: number) => boolean) => {
      const getUnsent = sinon
        .stub(DAO.inflationadjustments, "getUnsent")
        .callsFake(async (limit?: number) => rows.slice(0, limit));
      const claim = sinon
        .stub(DAO.inflationadjustments, "claimForSending")
        .callsFake(async (id: number) => claimed(id));
      const finish = sinon.stub(DAO.inflationadjustments, "finishSending").resolves(true);
      const cancel = sinon.stub(DAO.inflationadjustments, "cancelUnsent").resolves(true);
      sinon
        .stub(DAO.inflationadjustments, "getStatusCounts")
        .resolves([{ status: "new", count: 7, monthlyIncreaseOre: 0 }]);
      return { getUnsent, claim, finish, cancel };
    };

    it("claims each offer before its email and marks it pending only when sent", async () => {
      const { claim, finish, cancel } = stubSend(
        [unsent(1), unsent(2), unsent(3, false), unsent(4)],
        () => true,
      );
      const sendEmail = sinon.stub();
      sendEmail.withArgs(1).resolves(true);
      sendEmail.withArgs(2).resolves(false);
      sendEmail.withArgs(4).rejects(new Error("MailerSend down"));

      const result = await sendInflationOffers({ batchSize: 10, sendEmail, pauseMs: 0 });

      expect(result).to.deep.equal({ sent: 1, failed: 2, cancelled: 1, remaining: 7 });
      expect(claim.args.map((a) => a[0])).to.deep.equal([1, 2, 4]);
      // The offer is valid for 30 days from the send
      const expires = claim.firstCall.args[1] as Date;
      expect(expires.getTime() - Date.now()).to.be.closeTo(30 * 24 * 3600 * 1000, 60_000);
      expect(claim.firstCall.calledBefore(sendEmail.firstCall)).to.be.true;
      expect(finish.args).to.deep.equal([
        [1, true],
        [2, false],
        [4, false],
      ]);
      expect(cancel.calledOnceWith(3)).to.be.true;
      expect(sendEmail.neverCalledWith(3)).to.be.true;
    });

    it("never emails an offer another run already claimed", async () => {
      stubSend([unsent(1), unsent(2)], (id) => id !== 1);
      const sendEmail = sinon.stub().resolves(true);

      const result = await sendInflationOffers({ batchSize: 10, sendEmail, pauseMs: 0 });

      expect(sendEmail.args).to.deep.equal([[2]]);
      expect(result.sent).to.equal(1);
    });

    it("sends at most the batch size, capped per call", async () => {
      const rows = Array.from({ length: 40 }, (_, i) => unsent(i + 1));
      const { getUnsent } = stubSend(rows, () => true);
      const sendEmail = sinon.stub().resolves(true);

      await sendInflationOffers({ batchSize: 3, sendEmail, pauseMs: 0 });
      expect(sendEmail.callCount).to.equal(3);

      sendEmail.resetHistory();
      await sendInflationOffers({ batchSize: 100, sendEmail, pauseMs: 0 });
      expect(getUnsent.lastCall.args[0]).to.equal(MAX_SEND_BATCH);
      expect(sendEmail.callCount).to.equal(MAX_SEND_BATCH);
    });

    it("stops starting emails when the time budget is used", async () => {
      stubSend([unsent(1), unsent(2), unsent(3)], () => true);
      const sendEmail = sinon.stub().callsFake(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return true;
      });

      const result = await sendInflationOffers({
        batchSize: 10,
        sendEmail,
        pauseMs: 0,
        timeBudgetMs: 20,
      });

      expect(result.sent).to.equal(1);
    });
  });
});

describe("inflation adjustment expiry migration", () => {
  const sql = readFileSync(
    join(
      __dirname,
      "../../prisma/migrations/20261031200000_expire_inflation_adjustments/migration.sql",
    ),
    "utf8",
  );
  const statements = sql
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  it("only expires new and pending offers whose time ran out", () => {
    expect(statements).to.deep.equal([
      "UPDATE `Agreement_inflation_adjustments` SET `status` = 'expired' WHERE `status` IN ('new', 'pending') AND `expires` < UTC_TIMESTAMP()",
    ]);
  });
});
