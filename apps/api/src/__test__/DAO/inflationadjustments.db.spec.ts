import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import { expect } from "chai";
import { readFileSync } from "fs";
import { join } from "path";
import * as mysql from "mysql2/promise";
import { DAO } from "../../custom_modules/DAO";
import {
  ANON_DONOR_ID,
  type InflationCandidate,
} from "../../custom_modules/DAO_modules/inflationadjustment";

/**
 * Runs the inflation adjustment queries and the expiry migration against a real MySQL. Skipped
 * unless INFLATION_TEST_DB_URL points at a local, migrated database, e.g. the dev environment's:
 *
 *   INFLATION_TEST_DB_URL=mysql://root:effekt-local@127.0.0.1:3307/EffektDonasjonDB_Local \
 *     pnpm test src/__test__/DAO/inflationadjustments.db.spec.ts
 *
 * The session zone is +02:00 like production. The spec adds a few donors and agreements with
 * KIDs starting with 9917 and agreement IDs starting with "infl-spec", and deletes them again.
 */
const url = process.env.INFLATION_TEST_DB_URL;
const isLocal = !!url && /@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);

const migration = readFileSync(
  join(
    __dirname,
    "../../../prisma/migrations/20261031200000_expire_inflation_adjustments/migration.sql",
  ),
  "utf8",
);

(isLocal ? describe : describe.skip)(
  "inflation adjustments against MySQL",
  { timeout: 30000 },
  function () {
    let pool: mysql.Pool;
    let originalPool: mysql.Pool | undefined;
    let donorID: number;
    const agIds: Record<string, number> = {};

    const KIDS = {
      old: "991700000000011",
      changed: "991700000000022",
      offered: "991700000000033",
      anon: "991700000000044",
      vipps: "991700000000055",
    };

    const clean = async () => {
      await pool.query(
        `DELETE FROM Agreement_inflation_adjustments
         WHERE agreement_ID LIKE 'infl-spec%' OR agreement_ID IN (?)`,
        [Object.values(agIds).map(String).concat("0")],
      );
    };

    const candidates = async () =>
      (await DAO.inflationadjustments.getCandidates()).filter(
        (c) =>
          Object.values(agIds).map(String).includes(c.agreementId) ||
          c.agreementId === "infl-spec-1",
      );
    const byId = (list: InflationCandidate[], id: string | number) =>
      list.find((c) => c.agreementId === String(id));

    beforeAll(async () => {
      pool = mysql.createPool({ uri: url!, timezone: "+00:00", connectionLimit: 2 });
      pool.on("connection", (conn) => {
        (conn as any).query("SET time_zone = '+02:00'");
      });
      originalPool = DAO.dbPool;
      DAO.dbPool = pool;

      await pool.query(
        `INSERT IGNORE INTO Payment (ID, payment_name, abbriv) VALUES (7, 'AvtaleGiro', 'AG'), (8, 'Vipps Recurring', 'VR')`,
      );
      const [donor] = await pool.query<mysql.ResultSetHeader>(
        "INSERT INTO Donors (email, full_name) VALUES ('inflation-db-spec@example.org', 'Test')",
      );
      donorID = donor.insertId;
      await pool.query(
        `INSERT INTO Donors (ID, email, full_name) VALUES (?, 'anon@example.org', 'Anonymous')
         ON DUPLICATE KEY UPDATE ID = ID`,
        [ANON_DONOR_ID],
      );
      for (const [name, KID] of Object.entries(KIDS)) {
        await pool.query(
          "INSERT INTO Distributions (KID, Donor_ID, Tax_unit_ID) VALUES (?, ?, NULL)",
          [KID, name === "anon" ? ANON_DONOR_ID : donorID],
        );
      }
      for (const name of ["old", "changed", "offered", "anon"] as const) {
        const [res] = await pool.query<mysql.ResultSetHeader>(
          `INSERT INTO Avtalegiro_agreements (KID, amount, payment_date, notice, active, created)
           VALUES (?, 30000, 20, 0, 1, '2022-03-10 12:00:00')`,
          [KIDS[name]],
        );
        agIds[name] = res.insertId;
      }
      // "old": always 300 kr. "changed": 200 kr until Feb 2026 (Oslo), then 300 kr
      const donations: [string, number, Date, number][] = [
        [KIDS.old, 7, new Date("2026-09-20T00:00:00Z"), 300],
        [KIDS.changed, 7, new Date("2025-12-20T00:00:00Z"), 200],
        [KIDS.changed, 7, new Date("2026-01-31T23:30:00Z"), 200], // 1 Feb in Oslo
        [KIDS.changed, 7, new Date("2026-03-20T00:00:00Z"), 300],
        // Another method on the same KID doesn't count as a change
        [KIDS.old, 2, new Date("2026-08-01T00:00:00Z"), 1000],
      ];
      await pool.query(
        `INSERT IGNORE INTO Payment (ID, payment_name, abbriv) VALUES (2, 'Bank', 'Bank')`,
      );
      for (const [KID, payment, at, sum] of donations) {
        await pool.query(
          `INSERT INTO Donations (Donor_ID, Payment_ID, sum_confirmed, timestamp_confirmed, KID_fordeling)
           VALUES (?, ?, ?, ?, ?)`,
          [donorID, payment, sum, at, KID],
        );
      }
      await pool.query(
        `INSERT INTO Vipps_agreements (ID, donorID, KID, amount, status, monthly_charge_day, agreement_url_code, timestamp_created)
         VALUES ('infl-spec-1', ?, ?, 150, 'ACTIVE', 1, 'x', '2023-05-05 10:00:00')`,
        [donorID, KIDS.vipps],
      );
    });

    afterAll(async () => {
      if (!pool) return;
      await clean();
      await pool.query("DELETE FROM Donations WHERE KID_fordeling IN (?)", [Object.values(KIDS)]);
      await pool.query("DELETE FROM Vipps_agreements WHERE ID = 'infl-spec-1'");
      await pool.query("DELETE FROM Avtalegiro_agreements WHERE KID IN (?)", [Object.values(KIDS)]);
      await pool.query("DELETE FROM Distributions WHERE KID IN (?)", [Object.values(KIDS)]);
      await pool.query("DELETE FROM Donors WHERE ID = ?", [donorID]);
      DAO.dbPool = originalPool;
      await pool.end();
    });

    beforeEach(clean);

    it("lists active agreements with the amount in øre and the latest differing donation", async () => {
      const list = await candidates();
      const old = byId(list, agIds.old)!;
      expect(old.type).to.equal("avtaleGiro");
      expect(old.amountOre).to.equal(30000);
      expect(old.lastDifferentDonation).to.equal(null);
      // Created at 12:00 in the DB clock (UTC+2) is 10:00 UTC
      expect(old.created!.toISOString()).to.equal("2022-03-10T10:00:00.000Z");

      const changed = byId(list, agIds.changed)!;
      expect(changed.lastDifferentDonation!.toISOString()).to.equal("2026-01-31T23:30:00.000Z");

      const vipps = byId(list, "infl-spec-1")!;
      expect(vipps.type).to.equal("vipps");
      expect(vipps.amountOre).to.equal(15000);
      expect(vipps.email).to.equal("inflation-db-spec@example.org");

      expect(byId(list, agIds.anon)).to.equal(undefined);
    });

    it("leaves out agreements with an open or recent offer, not expired old ones", async () => {
      const offer = (agreementId: number | string, type = "avtaleGiro") => ({
        agreementId,
        agreementType: type as "avtaleGiro",
        currentAmount: 30000,
        proposedAmount: 32000,
        inflationPercentage: 0.06,
      });
      expect(await DAO.inflationadjustments.createIfNoOpenOffer(offer(agIds.offered))).to.equal(
        true,
      );
      // Never two open offers
      expect(await DAO.inflationadjustments.createIfNoOpenOffer(offer(agIds.offered))).to.equal(
        false,
      );
      expect(byId(await candidates(), agIds.offered)).to.equal(undefined);

      // An offer from two years ago that expired doesn't block
      await clean();
      await pool.query(
        `INSERT INTO Agreement_inflation_adjustments
          (agreement_ID, agreement_type, current_amount, proposed_amount, inflation_percentage, token, status, created, expires)
         VALUES (?, 'avtaleGiro', 30000, 32000, 0.06, ?, 'expired', NOW() - INTERVAL 2 YEAR, UTC_TIMESTAMP() - INTERVAL 23 MONTH)`,
        [String(agIds.offered), "a".repeat(64)],
      );
      expect(byId(await candidates(), agIds.offered)).to.not.equal(undefined);

      // One sent four months ago blocks, even though it expired
      await pool.query(
        `UPDATE Agreement_inflation_adjustments SET created = NOW() - INTERVAL 4 MONTH WHERE token = ?`,
        ["a".repeat(64)],
      );
      expect(byId(await candidates(), agIds.offered)).to.equal(undefined);
    });

    it("the migration expires old new and pending offers and keeps accepted ones", async () => {
      const insert = (status: string, expires: string, token: string) =>
        pool.query(
          `INSERT INTO Agreement_inflation_adjustments
            (agreement_ID, agreement_type, current_amount, proposed_amount, inflation_percentage, token, status, expires)
           VALUES ('infl-spec-1', 'vipps', 15000, 16000, 0.06, ?, ?, ${expires})`,
          [token.repeat(64), status],
        );
      await insert("new", "'2024-12-01'", "1");
      await insert("pending", "'2024-12-01'", "2");
      await insert("accepted", "'2024-12-01'", "3");
      await insert("pending", "UTC_TIMESTAMP() + INTERVAL 1 DAY", "4");

      await pool.query(migration);

      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT LEFT(token, 1) AS t, status FROM Agreement_inflation_adjustments
         WHERE agreement_ID = 'infl-spec-1' ORDER BY t`,
      );
      expect(rows.map((r) => [r.t, r.status])).to.deep.equal([
        ["1", "expired"],
        ["2", "expired"],
        ["3", "accepted"],
        ["4", "pending"],
      ]);
    });

    it("sends each prepared offer once: claim, then pending or failed", async () => {
      await DAO.inflationadjustments.createIfNoOpenOffer({
        agreementId: "infl-spec-1",
        agreementType: "vipps",
        currentAmount: 15000,
        proposedAmount: 16000,
        inflationPercentage: 0.06,
      });
      const [unsent] = (await DAO.inflationadjustments.getUnsent()).filter(
        (u) => u.agreementId === "infl-spec-1",
      );
      expect(unsent.stillValid).to.equal(true);
      expect(unsent.email).to.equal("inflation-db-spec@example.org");

      const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000);
      expect(await DAO.inflationadjustments.claimForSending(unsent.ID, expires)).to.equal(true);
      expect(await DAO.inflationadjustments.claimForSending(unsent.ID, expires)).to.equal(false);
      expect(await DAO.inflationadjustments.finishSending(unsent.ID, true)).to.equal(true);
      expect(await DAO.inflationadjustments.finishSending(unsent.ID, true)).to.equal(false);

      const email = await DAO.inflationadjustments.getByIdForEmail(unsent.ID);
      expect(email!.status).to.equal("pending");
      expect(Number(email!.proposed_amount)).to.equal(160);

      // The open offer is not expired by expirePending
      expect(await DAO.inflationadjustments.expirePending()).to.be.at.least(0);
      expect((await DAO.inflationadjustments.getByIdForEmail(unsent.ID))!.status).to.equal(
        "pending",
      );
    });

    it("marks an unsent offer invalid when the agreement's amount changed", async () => {
      await DAO.inflationadjustments.createIfNoOpenOffer({
        agreementId: agIds.old,
        agreementType: "avtaleGiro",
        currentAmount: 25000,
        proposedAmount: 27000,
        inflationPercentage: 0.06,
      });
      const [unsent] = (await DAO.inflationadjustments.getUnsent()).filter(
        (u) => u.agreementId === String(agIds.old),
      );
      expect(unsent.stillValid).to.equal(false);
      expect(await DAO.inflationadjustments.cancelUnsent(unsent.ID)).to.equal(true);
    });
  },
);
