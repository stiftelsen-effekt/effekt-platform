import { describe, it, beforeAll, afterAll, beforeEach, expect } from "vitest";
import * as mysql from "mysql2/promise";
import { DAO } from "../../custom_modules/DAO";

/**
 * Runs the gift card payment and SMS claim queries against a real MySQL. Skipped unless
 * GIFTCARD_TEST_DB_URL points at a local, migrated database, e.g. the dev environment's:
 *
 *   GIFTCARD_TEST_DB_URL=mysql://root:effekt-local@127.0.0.1:3307/EffektDonasjonDB_Local \
 *     pnpm test src/__test__/DAO/giftcards.db.spec.ts
 *
 * The session zone is +02:00 like production. The spec adds a donor, a product (slug
 * "db-spec-giftcard") and gift cards on KIDs starting with 9918, and deletes them again.
 */
const url = process.env.GIFTCARD_TEST_DB_URL;
const isLocal = !!url && /@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);

(isLocal ? describe : describe.skip)("gift cards against MySQL", { timeout: 30000 }, function () {
  let pool: mysql.Pool;
  let originalPool: mysql.Pool | undefined;
  let donorID: number;
  let productID: number;
  const KID = "991800000000011";
  const now = new Date();

  const status = async () => {
    const [[row]] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT ID, Status, Paid_at, Last_error FROM Giftcards WHERE KID = ?",
      [KID],
    );
    return row;
  };
  const donate = (sum: number, conn: mysql.Pool | mysql.PoolConnection = pool) =>
    conn.query(
      `INSERT INTO Donations (Donor_ID, Payment_ID, sum_confirmed, timestamp_confirmed, KID_fordeling)
       VALUES (?, 2, ?, ?, ?)`,
      [donorID, sum, now, KID],
    );

  beforeAll(async () => {
    pool = mysql.createPool({ uri: url!, timezone: "+00:00", connectionLimit: 3 });
    pool.on("connection", (conn) => {
      (conn as any).query("SET time_zone = '+02:00'");
    });
    originalPool = DAO.dbPool;
    DAO.dbPool = pool;

    await pool.query(
      `INSERT IGNORE INTO Payment (ID, payment_name, abbriv) VALUES (2, 'Bank', 'Bank')`,
    );
    const [donor] = await pool.query<mysql.ResultSetHeader>(
      "INSERT INTO Donors (email, full_name) VALUES ('giftcard-db-spec@example.org', 'Test')",
    );
    donorID = donor.insertId;
    const [[org]] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT ID FROM Organizations ORDER BY ID LIMIT 1",
    );
    const [product] = await pool.query<mysql.ResultSetHeader>(
      `INSERT INTO Giftcard_products
         (Slug, Name, Organization_ID, Unit_price, Unit_singular, Unit_plural, Sms_template)
       VALUES ('db-spec-giftcard', 'Spec', ?, 100, 'x', 'x', '{link}')`,
      [org.ID],
    );
    productID = product.insertId;
    await pool.query("INSERT INTO Distributions (KID, Donor_ID, Tax_unit_ID) VALUES (?, ?, NULL)", [
      KID,
      donorID,
    ]);
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query("DELETE FROM Giftcards WHERE KID = ?", [KID]);
    await pool.query("DELETE FROM Donations WHERE KID_fordeling = ?", [KID]);
    await pool.query("DELETE FROM Distributions WHERE KID = ?", [KID]);
    await pool.query("DELETE FROM Giftcard_products WHERE ID = ?", [productID]);
    await pool.query("DELETE FROM Donors WHERE ID = ?", [donorID]);
    DAO.dbPool = originalPool;
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM Giftcards WHERE KID = ?", [KID]);
    await pool.query("DELETE FROM Donations WHERE KID_fordeling = ?", [KID]);
    await DAO.giftcards.add({
      KID,
      code: null,
      productId: productID,
      units: 3,
      amount: 300,
      delivery: "sms",
      recipientName: "Mia",
      senderName: "Ola",
      message: null,
      recipientPhone: "+4791234567",
      sendAt: new Date(now.getTime() - 60_000),
    });
  });

  it("is paid only once the donations on the KID add up to its amount", async () => {
    await donate(100);
    expect(await DAO.giftcards.markPaid(KID, now)).toBe(false);
    expect((await status()).Status).toBe("pending");
    await donate(200);
    expect(await DAO.giftcards.markPaid(KID, now)).toBe(true);
    expect((await status()).Status).toBe("paid");
    await donate(300);
    expect(await DAO.giftcards.markPaid(KID, now)).toBe(false);
  });

  it("is not paid by a donation whose transaction is rolled back", async () => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await donate(300, conn);
      expect(await DAO.giftcards.markPaid(KID, now, conn)).toBe(true);
      await conn.rollback();
    } finally {
      conn.release();
    }
    expect((await status()).Status).toBe("pending");
  });

  it("claims a due gift card once, and not one rescheduled to later", async () => {
    await donate(300);
    await DAO.giftcards.markPaid(KID, now);
    const { ID } = await status();
    expect(await DAO.giftcards.getDueSmsIDs(now, 1000)).toContain(ID);
    await pool.query("UPDATE Giftcards SET Send_at = ? WHERE ID = ?", [
      new Date(now.getTime() + 3600_000),
      ID,
    ]);
    expect(await DAO.giftcards.claimForSending(ID, now)).toBe(false);
    // DATETIME(0) rounds to whole seconds, so a second before now
    await pool.query("UPDATE Giftcards SET Send_at = ? WHERE ID = ?", [
      new Date(now.getTime() - 1000),
      ID,
    ]);
    expect(await DAO.giftcards.claimForSending(ID, now)).toBe(true);
    expect(await DAO.giftcards.claimForSending(ID, now)).toBe(false);
    expect((await status()).Status).toBe("sending");
  });

  it("fails gift cards left sending by a crashed run, not ones being sent now", async () => {
    await pool.query("UPDATE Giftcards SET Status = 'sending' WHERE KID = ?", [KID]);
    await DAO.giftcards.failStaleSending(30);
    expect((await status()).Status).toBe("sending");
    // Last_updated is filled by MySQL (DB clock), so it is moved back with NOW()
    await pool.query(
      "UPDATE Giftcards SET Last_updated = NOW() - INTERVAL 31 MINUTE WHERE KID = ?",
      [KID],
    );
    expect(await DAO.giftcards.failStaleSending(30)).toBeGreaterThanOrEqual(1);
    const row = await status();
    expect(row.Status).toBe("failed");
    expect(row.Last_error).toMatch(/Interrupted/);
  });
});
