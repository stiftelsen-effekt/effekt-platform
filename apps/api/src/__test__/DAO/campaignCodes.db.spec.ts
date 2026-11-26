import { describe, it, beforeAll, afterAll, expect } from "vitest";
import * as mysql from "mysql2/promise";
import { DAO } from "../../custom_modules/DAO";

/**
 * Reproduces the campaign-code cross-linking bug against a real MySQL: two Vipps agreements
 * reusing the same KID (the donor testing a near-identical agreement again) must each keep their
 * own claimed referral code, never showing the other agreement's code. Skipped unless
 * CAMPAIGN_CODES_TEST_DB_URL points at a local, migrated database, e.g. the dev environment's:
 *
 *   CAMPAIGN_CODES_TEST_DB_URL=mysql://root:effekt-local@127.0.0.1:3307/EffektDonasjonDB_Local \
 *     pnpm test src/__test__/DAO/campaignCodes.db.spec.ts
 */
const url = process.env.CAMPAIGN_CODES_TEST_DB_URL;
const isLocal = !!url && /@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);

const KID = "990000000000033";
// Vipps_agreements.ID is VARCHAR(20)
const AGREEMENT_A = "agr_camptest_a";
const AGREEMENT_B = "agr_camptest_b";

(isLocal ? describe : describe.skip)(
  "Campaign codes against MySQL",
  { timeout: 30000 },
  function () {
    let pool: mysql.Pool;
    let originalPool: mysql.Pool | undefined;
    let donorID: number;

    beforeAll(async () => {
      pool = mysql.createPool({ uri: url!, connectionLimit: 2 });
      originalPool = DAO.dbPool;
      DAO.dbPool = pool;

      const [donor] = await pool.query<mysql.ResultSetHeader>(
        "INSERT INTO Donors (email, full_name) VALUES ('campaign-codes-db-spec@example.org', 'Test')",
      );
      donorID = donor.insertId;
      const [[owner]] = await pool.query<any[]>(
        "SELECT ID FROM Data_owner WHERE `default` = 1 LIMIT 1",
      );
      const ownerID =
        owner?.ID ??
        (
          await pool.query<mysql.ResultSetHeader>(
            "INSERT INTO Data_owner (owner, `default`) VALUES ('campaign-codes-db-spec', 1)",
          )
        )[0].insertId;
      await pool.query(
        "INSERT INTO Distributions (KID, Donor_ID, Tax_unit_ID, Meta_owner_ID) VALUES (?, ?, NULL, ?)",
        [KID, donorID, ownerID],
      );
    });

    afterAll(async () => {
      await pool.query("DELETE FROM Donation_referral_codes WHERE KID = ?", [KID]);
      await pool.query("DELETE FROM Vipps_agreements WHERE ID IN (?)", [
        [AGREEMENT_A, AGREEMENT_B],
      ]);
      await pool.query("DELETE FROM Distributions WHERE KID = ?", [KID]);
      await pool.query("DELETE FROM Donors WHERE ID = ?", [donorID]);
      await pool.end();
      DAO.dbPool = originalPool!;
    });

    it("keeps each agreement's claimed code off the other agreement sharing the KID", async () => {
      await DAO.donationReferralCodes.add(KID, "AUTUMN");
      await DAO.vipps.addAgreement(AGREEMENT_A, donorID, KID, 250, 15, "url-code-a");

      await DAO.donationReferralCodes.add(KID, "WINTER");
      await DAO.vipps.addAgreement(AGREEMENT_B, donorID, KID, 250, 15, "url-code-b");

      const { rows } = await DAO.agreements.getList({
        filter: { ids: [AGREEMENT_A, AGREEMENT_B] },
        sort: { id: "id", desc: false },
      });

      const byId = Object.fromEntries(rows.map((row) => [row.id, row.campaignCode]));
      expect(byId[AGREEMENT_A]).toBe("AUTUMN");
      expect(byId[AGREEMENT_B]).toBe("WINTER");
    });
  },
);
