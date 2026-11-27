import { describe, it, beforeAll, afterAll, expect } from "vitest";
import type { Request, Response } from "express";
import * as mysql from "mysql2/promise";
import { DAO } from "../../custom_modules/DAO";
import { appRouter } from "../../trpc/router";
import { createCallerFactory } from "../../trpc/trpc";

/**
 * Moving a donation into and out of a fundraiser against a real MySQL: the KID copy (split, tax
 * unit, data owner), the fundraiser transaction and the fundraiser's totals. Skipped unless
 * FUNDRAISERS_TEST_DB_URL points at a local, migrated database with the seeded payment methods,
 * cause areas and organizations, e.g. the dev environment's:
 *
 *   FUNDRAISERS_TEST_DB_URL=mysql://root:effekt-local@127.0.0.1:3308/EffektDonasjonDB_Local \
 *     pnpm test src/__test__/DAO/fundraiserDonations.db.spec.ts
 *
 * The spec adds its own donor, fundraiser, distributions and donations, and deletes them again.
 */
const url = process.env.FUNDRAISERS_TEST_DB_URL;
const isLocal = !!url && /@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);

const createCaller = createCallerFactory(appRouter);
const fundraisers = () =>
  createCaller({
    req: {} as Request,
    res: {} as Response,
    auth: { permissions: ["admin"], email: "test@example.org", sub: "auth0|test" } as any,
  }).reports.fundraisers;

const SOURCE_KID = "990000000017";

(isLocal ? describe : describe.skip)(
  "moving donations into and out of fundraisers against MySQL",
  { timeout: 30000 },
  function () {
    let pool: mysql.Pool;
    let originalPool: mysql.Pool | undefined;
    let donorId: number;
    let fundraiserId: number;
    let first: number;
    let second: number;
    let sql: (q: string, p?: unknown[]) => Promise<any>;

    /** Cause areas and organization shares of a KID, without row IDs */
    const splitOf = async (kid: string) =>
      sql(
        `SELECT CA.Cause_area_ID, CA.Percentage_share AS ca, CA.Standard_split,
                CAO.Organization_ID, CAO.Percentage_share AS org
         FROM Distribution_cause_areas CA
         JOIN Distribution_cause_area_organizations CAO ON CAO.Distribution_cause_area_ID = CA.ID
         WHERE CA.Distribution_KID = ? ORDER BY CA.Cause_area_ID, CAO.Organization_ID`,
        [kid],
      );
    const kidOf = async (donationId: number) =>
      (await sql("SELECT KID_fordeling FROM Donations WHERE ID = ?", [donationId]))[0]
        .KID_fordeling as string;

    beforeAll(async () => {
      pool = mysql.createPool({ uri: url!, timezone: "+00:00", connectionLimit: 3 });
      sql = async (q, p) => (await pool.query<any>(q, p))[0];
      originalPool = DAO.dbPool;
      DAO.dbPool = pool;

      const [organizations, [payment]] = [
        await sql("SELECT ID, cause_area_ID FROM Organizations WHERE cause_area_ID = 1 LIMIT 2"),
        await sql("SELECT ID FROM Payment ORDER BY ID LIMIT 1"),
      ];
      expect(organizations, "two seeded organizations in cause area 1").toHaveLength(2);

      donorId = (
        await sql("INSERT INTO Donors (full_name, email) VALUES (?, ?)", [
          "Fundraiser Spec",
          "fundraiser-spec@example.org",
        ])
      ).insertId;
      fundraiserId = (await sql("INSERT INTO Fundraisers (Donor_ID) VALUES (?)", [donorId]))
        .insertId;
      // Data owner 2 (not the default), so the copy is seen to keep it
      await sql(
        "INSERT INTO Distributions (KID, Donor_ID, Tax_unit_ID, Meta_owner_ID) VALUES (?, ?, NULL, 2)",
        [SOURCE_KID, donorId],
      );
      const causeArea = (
        await sql(
          `INSERT INTO Distribution_cause_areas
             (Distribution_KID, Cause_area_ID, Percentage_share, Standard_split)
           VALUES (?, 1, 100, 0)`,
          [SOURCE_KID],
        )
      ).insertId;
      await sql(
        `INSERT INTO Distribution_cause_area_organizations
           (Distribution_cause_area_ID, Organization_ID, Percentage_share)
         VALUES (?, ?, 60.5), (?, ?, 39.5)`,
        [causeArea, organizations[0].ID, causeArea, organizations[1].ID],
      );
      const addDonation = async (sum: number) =>
        (
          await sql(
            `INSERT INTO Donations (Donor_ID, Payment_ID, sum_confirmed, KID_fordeling, timestamp_confirmed)
             VALUES (?, ?, ?, ?, '2026-10-01 10:00:00')`,
            [donorId, payment.ID, sum, SOURCE_KID],
          )
        ).insertId;
      first = await addDonation(1500);
      second = await addDonation(700);
    });

    afterAll(async () => {
      if (donorId !== undefined) {
        await sql("DELETE FROM Donations WHERE Donor_ID = ?", [donorId]);
        await sql(
          `DELETE FT FROM Fundraiser_transactions FT
           JOIN Fundraisers F ON F.ID = FT.Fundraiser_ID WHERE F.Donor_ID = ?`,
          [donorId],
        );
        // Cascades to distributions (and their cause areas) and fundraisers
        await sql("DELETE FROM Donors WHERE ID = ?", [donorId]);
      }
      DAO.dbPool = originalPool!;
      await pool.end();
    });

    it("attach moves only that donation to a copy of its KID in the fundraiser", async () => {
      const result = await fundraisers().attachDonation({
        donationId: first,
        fundraiserId,
        message: "Lykke til!",
        messageSenderName: "Ola",
        showName: true,
      });

      expect(result.kid).not.toBe(SOURCE_KID);
      expect(await kidOf(first)).toBe(result.kid);
      expect(await kidOf(second), "the other donation on the KID stays").toBe(SOURCE_KID);

      const [distribution] = await sql(
        `SELECT D.Donor_ID, D.Tax_unit_ID, D.Meta_owner_ID, FT.Fundraiser_ID, FT.Message,
                FT.Message_sender_name, FT.Show_name
         FROM Distributions D JOIN Fundraiser_transactions FT ON FT.ID = D.Fundraiser_transaction_ID
         WHERE D.KID = ?`,
        [result.kid],
      );
      expect(distribution).toStrictEqual({
        Donor_ID: donorId,
        Tax_unit_ID: null,
        Meta_owner_ID: 2,
        Fundraiser_ID: fundraiserId,
        Message: "Lykke til!",
        Message_sender_name: "Ola",
        Show_name: 1,
      });
      expect(await splitOf(result.kid)).toStrictEqual(await splitOf(SOURCE_KID));

      const fundraiser = await fundraisers().get({ id: fundraiserId });
      expect(fundraiser.totalSum).toBe(1500);
      expect(fundraiser.donationCount).toBe(1);
      expect(fundraiser.transactions.map((t) => [t.name, t.message, t.amount])).toStrictEqual([
        ["Ola", "Lykke til!", 1500],
      ]);
      const donation = await createCaller({
        req: {} as Request,
        res: {} as Response,
        auth: { permissions: ["admin"] } as any,
      }).donations.get({ id: first });
      expect(donation.fundraiserId).toBe(fundraiserId);
    });

    it("detach moves the donation back to the KID with the same split", async () => {
      const result = await fundraisers().detachDonation({ donationId: first });

      expect(result).toStrictEqual({ donationId: first, fundraiserId, kid: SOURCE_KID });
      expect(await kidOf(first)).toBe(SOURCE_KID);
      const fundraiser = await fundraisers().get({ id: fundraiserId });
      expect(fundraiser.totalSum).toBe(0);
      expect(fundraiser.transactions).toStrictEqual([]);
    });

    it("detach copies the split to a new KID when no other KID has it", async () => {
      // Both donations in the fundraiser, then the original KID gone
      const { kid: firstKid } = await fundraisers().attachDonation({
        donationId: first,
        fundraiserId,
        message: "",
        messageSenderName: null,
        showName: false,
      });
      await fundraisers().attachDonation({
        donationId: second,
        fundraiserId,
        message: "",
        messageSenderName: null,
        showName: false,
      });
      const before = await splitOf(SOURCE_KID);
      await sql("DELETE FROM Distributions WHERE KID = ?", [SOURCE_KID]);
      expect((await fundraisers().get({ id: fundraiserId })).totalSum).toBe(2200);

      const result = await fundraisers().detachDonation({ donationId: first });

      expect([SOURCE_KID, firstKid]).not.toContain(result.kid);
      expect(await kidOf(first)).toBe(result.kid);
      const [distribution] = await sql(
        "SELECT Donor_ID, Fundraiser_transaction_ID, Meta_owner_ID FROM Distributions WHERE KID = ?",
        [result.kid],
      );
      expect(distribution).toStrictEqual({
        Donor_ID: donorId,
        Fundraiser_transaction_ID: null,
        Meta_owner_ID: 2,
      });
      expect(await splitOf(result.kid)).toStrictEqual(before);
      const fundraiser = await fundraisers().get({ id: fundraiserId });
      expect([fundraiser.totalSum, fundraiser.donationCount]).toStrictEqual([700, 1]);
    });
  },
);
