import { describe, it, afterEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import { DAO } from "../../custom_modules/DAO";
import { RequestLocale } from "../../middleware/locale";

describe("DAO donations", () => {
  describe("getAll", () => {
    const sort = { id: "timestamp", desc: true };

    /**
     * getAll runs two queries side by side: the page (first call, with LIMIT/OFFSET params)
     * and the totals over every matching donation (second call).
     */
    const donationRow = (overrides: { sum_confirmed: number; campaign_codes?: string }) => ({
      ID: 1,
      full_name: "Test Donor",
      payment_name: "VIPPS",
      transaction_cost: 2,
      KID_fordeling: "123",
      timestamp_confirmed: new Date("2024-01-01"),
      tax_unit_type: "person",
      ...overrides,
    });
    const totalsRow = (row: { full_count: number; full_sum: number; full_avg: number }) => row;

    const stubPageAndTotals = (
      row: ReturnType<typeof donationRow>,
      totals: ReturnType<typeof totalsRow>,
    ) => {
      const queryStub = vi.spyOn(DAO, "query").mockReturnValue(undefined as any);
      queryStub.mockResolvedValueOnce([[row], []]);
      queryStub.mockResolvedValueOnce([[totals], []]);
      return queryStub;
    };

    const calls = (queryStub: MockInstance) => ({
      pageSql: queryStub.mock.calls[0][0] as string,
      pageParams: queryStub.mock.calls[0][1] as unknown[],
      totalsSql: queryStub.mock.calls[1][0] as string,
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("uses the full donation amount when no organization filter is set", async () => {
      const queryStub = stubPageAndTotals(
        donationRow({ sum_confirmed: 1000 }),
        totalsRow({ full_count: 1, full_sum: 1000, full_avg: 1000 }),
      );

      const result = await DAO.donations.getAll(sort, 0, 10, {}, RequestLocale.NO);

      expect(queryStub).toHaveBeenCalledTimes(2);
      const { pageSql, pageParams, totalsSql } = calls(queryStub);
      expect(pageSql).toContain("Donations.sum_confirmed as sum_confirmed");
      expect(pageSql).toMatch(
        /ORDER BY timestamp_confirmed DESC, Donations\.ID DESC\s+LIMIT \? OFFSET \?/,
      );
      expect(pageParams).toStrictEqual([10, 0]);
      expect(totalsSql).toContain("SUM(Donations.sum_confirmed) as full_sum");
      expect(totalsSql).not.toContain("LIMIT");
      for (const sql of [pageSql, totalsSql]) {
        expect(sql).not.toContain("selected_org_shares");
        expect(sql).not.toMatch(/ROUND\(Donations\.sum_confirmed \* selected_org_shares/);
      }
      expect(result.statistics).toStrictEqual({
        numDonations: 1,
        sumDonations: 1000,
        avgDonation: 1000,
      });
      expect(result.rows[0].sum).toBe(1000);
    });

    it("prorates table and stats amounts by selected organization shares", async () => {
      const queryStub = stubPageAndTotals(
        donationRow({ sum_confirmed: 400 }),
        totalsRow({ full_count: 1, full_sum: 400, full_avg: 400 }),
      );

      const result = await DAO.donations.getAll(
        sort,
        0,
        10,
        { organizationIDs: [12, 17] },
        RequestLocale.NO,
      );

      expect(queryStub).toHaveBeenCalledTimes(2);
      const { pageSql, pageParams, totalsSql } = calls(queryStub);
      const prorated = "ROUND(Donations.sum_confirmed * selected_org_shares.selected_share, 2)";

      // Both the table and the totals use the amount to the selected organizations
      expect(pageSql).toContain(`${prorated} as sum_confirmed`);
      expect(totalsSql).toContain(`SUM(${prorated}) as full_sum`);
      expect(totalsSql).toContain(`AVG(${prorated}) as full_avg`);
      expect(pageParams).toStrictEqual([10, 0]);
      for (const sql of [pageSql, totalsSql]) {
        expect(sql).toContain("selected_org_shares AS");
        expect(sql).toContain("INNER JOIN selected_org_shares");
        expect(sql).toContain("Distribution_cause_areas.Percentage_share / 100");
        expect(sql).toContain("Distribution_cause_area_organizations.Percentage_share / 100");
        expect(sql).toContain("Organization_ID IN (12,17)");
        expect(sql).not.toContain("SELECT DISTINCT");
        expect(sql).not.toContain("LEFT JOIN Distribution_cause_areas");
      }

      expect(result.rows[0].sum).toBe(400);
      expect(result.statistics).toStrictEqual({
        numDonations: 1,
        sumDonations: 400,
        avgDonation: 400,
      });
    });

    it("returns empty statistics without querying when no organizations are selected", async () => {
      const queryStub = vi.spyOn(DAO, "query").mockReturnValue(undefined as any);

      const result = await DAO.donations.getAll(
        sort,
        0,
        10,
        { organizationIDs: [] },
        RequestLocale.NO,
      );

      expect(queryStub).not.toHaveBeenCalled();
      expect(result).toStrictEqual({
        rows: [],
        statistics: {
          numDonations: 0,
          sumDonations: 0,
          avgDonation: 0,
        },
        pages: 0,
      });
    });

    it("filters on the donation data owner when data owners are selected", async () => {
      const queryStub = stubPageAndTotals(
        donationRow({ sum_confirmed: 1000 }),
        totalsRow({ full_count: 1, full_sum: 1000, full_avg: 1000 }),
      );

      await DAO.donations.getAll(sort, 0, 10, { dataOwnerIDs: [1, 3] }, RequestLocale.NO);

      expect(queryStub).toHaveBeenCalledTimes(2);
      const { pageSql, totalsSql } = calls(queryStub);
      expect(pageSql).toContain("Donations.Meta_owner_ID IN (1,3)");
      expect(totalsSql).toContain("Donations.Meta_owner_ID IN (1,3)");
    });

    it("joins and filters on campaign code", async () => {
      const queryStub = stubPageAndTotals(
        { ...donationRow({ sum_confirmed: 1000 }), campaign_codes: "AUTUMN26" },
        totalsRow({ full_count: 1, full_sum: 1000, full_avg: 1000 }),
      );

      const result = await DAO.donations.getAll(
        sort,
        0,
        10,
        { campaignCode: "autumn" },
        RequestLocale.NO,
      );

      const { pageSql } = calls(queryStub);
      expect(pageSql).toContain("FROM Donation_referral_codes");
      expect(pageSql).toContain("GROUP BY KID");
      expect(pageSql).toContain("CampaignCodes.campaign_codes");
      expect(pageSql).toContain("EXISTS (");
      expect(pageSql).toContain("DRC_F.Referral_code LIKE '%autumn%'");
      expect(result.rows[0].campaignCode).toBe("AUTUMN26");
    });

    it("is null when the donation's KID has no campaign code", async () => {
      stubPageAndTotals(
        donationRow({ sum_confirmed: 1000 }),
        totalsRow({ full_count: 1, full_sum: 1000, full_avg: 1000 }),
      );

      const result = await DAO.donations.getAll(sort, 0, 10, {}, RequestLocale.NO);

      expect(result.rows[0].campaignCode).toBeNull();
    });

    it("returns empty statistics without querying when no data owners are selected", async () => {
      const queryStub = vi.spyOn(DAO, "query").mockReturnValue(undefined as any);

      const result = await DAO.donations.getAll(
        sort,
        0,
        10,
        { dataOwnerIDs: [] },
        RequestLocale.NO,
      );

      expect(queryStub).not.toHaveBeenCalled();
      expect(result).toStrictEqual({
        rows: [],
        statistics: {
          numDonations: 0,
          sumDonations: 0,
          avgDonation: 0,
        },
        pages: 0,
      });
    });
  });

  describe("getEAFundsDonations", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("reads EA Norge (owner 2) donations from Donations with the tax unit from the distribution", async () => {
      const timestamp = new Date("2024-05-01");
      const queryStub = vi.spyOn(DAO, "query").mockResolvedValue([
        [
          {
            ID: 11,
            Donor_ID: 237,
            Tax_unit_ID: 10,
            sum_confirmed: "2000.00",
            timestamp_confirmed: timestamp,
            PaymentExternal_ID: "EAN.1",
          },
          {
            ID: 12,
            Donor_ID: 237,
            Tax_unit_ID: null,
            sum_confirmed: "500.00",
            timestamp_confirmed: timestamp,
            PaymentExternal_ID: "EAN.2",
          },
        ],
        [],
      ]);

      const result = await DAO.donations.getEAFundsDonations(237);

      expect(queryStub).toHaveBeenCalledOnce();
      const [sql, params] = queryStub.mock.calls[0] as unknown as [string, unknown[]];
      expect(sql).not.toContain("Funds_donations");
      expect(sql).toContain("FROM Donations");
      expect(sql).toContain("Distributions.Tax_unit_ID");
      expect(sql).toContain("Donations.Meta_owner_ID = ?");
      expect(params).toStrictEqual([237, 2]);
      expect(result).toStrictEqual([
        {
          id: 11,
          donorId: 237,
          taxUnitId: 10,
          sum: 2000,
          timestamp,
          paymentExternalId: "EAN.1",
        },
        {
          id: 12,
          donorId: 237,
          taxUnitId: null,
          sum: 500,
          timestamp,
          paymentExternalId: "EAN.2",
        },
      ]);
    });
  });

  describe("queries rewritten for the multiple cause area schema", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const expectCurrentSchema = (sql: string) => {
      expect(sql).not.toMatch(/Combining_table|JOIN Distribution\b|CALL/i);
      expect(sql).toContain("Distribution_cause_areas");
      expect(sql).toContain("Distribution_cause_area_organizations");
    };

    it("getAggregateByTime sums each organization's share of the cause area share", async () => {
      const rows = [
        { id: 1, orgName: "Org", chartColor: "chart-3", sum: "12.50" },
        { id: 2, orgName: "Other org", chartColor: "teal", sum: "1.00" },
      ];
      const queryStub = vi.spyOn(DAO, "query").mockResolvedValue([rows, []]);
      const from = new Date("2024-01-01");
      const to = new Date("2024-12-31");

      // Stored chart colours pass through; values outside the palette read as null.
      expect(await DAO.donations.getAggregateByTime(from, to)).toStrictEqual([
        rows[0],
        { ...rows[1], chartColor: null },
      ]);

      const [sql, params] = queryStub.mock.calls[0];
      expectCurrentSchema(sql);
      expect(sql).toMatch(/GROUP BY Organizations\.ID/);
      expect(params).toStrictEqual([from, to]);
    });

    it("getFromRange groups organization rows per donation, sorted by time", async () => {
      const row = (id: number, time: string, org: number, share: string, amount: string) => ({
        Donation_ID: id,
        timestamp_confirmed: new Date(time),
        Donor_ID: 7,
        transaction_cost: "2.00",
        donor_name: "Donor",
        sum_confirmed: "100.00",
        payment_name: "Bank",
        Org_ID: org,
        org_name: `Org ${org}`,
        percentage_share: share,
        actual_share: amount,
      });
      const queryStub = vi
        .spyOn(DAO, "query")
        .mockResolvedValue([
          [
            row(2, "2024-01-02", 1, "60.000000000000", "60.00"),
            row(2, "2024-01-02", 2, "40.000000000000", "40.00"),
            row(1, "2024-01-01", 1, "100.000000000000", "100.00"),
          ],
          [],
        ]);

      const result = await DAO.donations.getFromRange(
        new Date("2024-01-01"),
        new Date("2024-01-02"),
        [4],
      );

      expectCurrentSchema(queryStub.mock.calls[0][0]);
      expect(queryStub.mock.calls[0][0]).toContain("Donations.Payment_ID IN (?)");
      expect(result.map((d) => d.ID)).toStrictEqual([1, 2]);
      expect(result[1]).toEqual(
        expect.objectContaining({ sum: "100.00", transactionCost: "2.00", donorID: 7 }),
      );
      expect(result[1].split).toStrictEqual([
        { id: 1, name: "Org 1", percentage: "60.000000000000", amount: "60.00" },
        { id: 2, name: "Org 2", percentage: "40.000000000000", amount: "40.00" },
      ]);
    });

    it("externalRefExists checks every payment method", async () => {
      const queryStub = vi.spyOn(DAO, "query").mockResolvedValue([[{ ID: 1 }], []]);
      expect(await DAO.donations.externalRefExists("abc")).toBe(true);
      expect(queryStub.mock.calls[0][0]).not.toContain("Payment_ID");
      expect(queryStub.mock.calls[0][1]).toStrictEqual(["abc"]);
    });
  });

  describe("getTransactionCostsReport", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("keeps two decimals on the transaction cost sums", async () => {
      const report = {
        donationsCount: 3,
        costPrevMonth: "12.34",
        costPrevMonthPrevYear: "5.67",
        costCurrentMonthToDate: "8.90",
        costCurrentMonthToDatePrevYear: "1.23",
        costYTD: "45.60",
        costYTDPrevYear: "78.09",
      };
      const queryStub = vi.spyOn(DAO, "query").mockResolvedValue([[report], []]);

      const result = await DAO.donations.getTransactionCostsReport();

      expect(queryStub).toHaveBeenCalledOnce();
      const sql = queryStub.mock.calls[0][0] as string;
      expect(sql.match(/round\(sum\(transaction_cost\), 2\)/g)).toHaveLength(6);
      expect(sql).not.toMatch(/round\(sum\(transaction_cost\)\)/);
      expect(result).toStrictEqual(report);
    });
  });

  describe("getByDonorId", () => {
    afterEach(() => vi.restoreAllMocks());

    it("joins campaign codes by KID and maps them onto each donation", async () => {
      const queryStub = vi.spyOn(DAO, "query").mockResolvedValue([
        [
          {
            ID: 1,
            sum_confirmed: 1000,
            KID_fordeling: "123",
            transaction_cost: 2,
            timestamp_confirmed: new Date("2024-01-01"),
            Meta_owner_ID: 3,
            donorId: 7,
            full_name: "Test Donor",
            email: "test@example.com",
            payment_name: "VIPPS",
            Tax_unit_ID: 9,
            campaign_codes: "AUTUMN, SPRING",
          },
        ],
        [],
      ]);

      const result = await DAO.donations.getByDonorId(7);

      const sql = queryStub.mock.calls[0][0] as string;
      expect(sql).toContain("FROM Donation_referral_codes");
      expect(sql).toContain("GROUP BY KID");
      expect(sql).toContain("ON CampaignCodes.KID = Donation.KID_fordeling");
      expect(result[0].campaignCode).toBe("AUTUMN, SPRING");
    });

    it("is null when the KID has no campaign code", async () => {
      vi.spyOn(DAO, "query").mockResolvedValue([
        [
          {
            ID: 1,
            sum_confirmed: 1000,
            KID_fordeling: "123",
            transaction_cost: 2,
            timestamp_confirmed: new Date("2024-01-01"),
            Meta_owner_ID: 3,
            donorId: 7,
            full_name: "Test Donor",
            email: "test@example.com",
            payment_name: "VIPPS",
            Tax_unit_ID: 9,
            campaign_codes: null,
          },
        ],
        [],
      ]);

      const result = await DAO.donations.getByDonorId(7);

      expect(result[0].campaignCode).toBeNull();
    });
  });
});
