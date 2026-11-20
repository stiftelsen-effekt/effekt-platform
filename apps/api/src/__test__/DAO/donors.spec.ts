import { describe, it, afterEach, expect, vi } from "vitest";
import { DAO } from "../../custom_modules/DAO";
import { RequestLocale } from "../../middleware/locale";

describe("DAO donors", () => {
  describe("getAll", () => {
    const sort = { id: "id", desc: true };

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("uses the full donation amount when no organization filter is set", async () => {
      const queryStub = vi.spyOn(DAO, "query").mockResolvedValue([
        [
          {
            ID: 1,
            full_name: "Test Donor",
            email: "test@example.com",
            date_registered: new Date("2024-01-01"),
            newsletter: 1,
            last_donation_date: new Date("2024-06-01"),
            donations_count: 2,
            donations_sum: 1000,
            total_donors_count: 1,
            total_donations_sum: 1000,
            total_donations_count: 2,
          },
        ],
        [],
      ]);

      const result = await DAO.donors.getAll(sort, 0, 10, null, RequestLocale.NO);

      expect(queryStub).toHaveBeenCalledOnce();
      const sql = queryStub.mock.calls[0][0] as string;
      expect(sql).toContain("COALESCE(SUM(Dons.sum_confirmed), 0) as donations_sum");
      expect(sql).toContain("LEFT JOIN Donations Dons");
      expect(sql).toContain("LEFT JOIN DonorAggregates");
      expect(sql).not.toContain("selected_org_shares");
      expect(result.rows[0].donationsSum).toBe(1000);
      expect(result.statistics).toStrictEqual({
        totalDonors: 1,
        totalDonationSum: 1000,
        totalDonationCount: 2,
      });
    });

    it("prorates donor sums and stats by selected organization shares", async () => {
      const queryStub = vi.spyOn(DAO, "query").mockResolvedValue([
        [
          {
            ID: 1,
            full_name: "Test Donor",
            email: "test@example.com",
            date_registered: new Date("2024-01-01"),
            newsletter: 0,
            last_donation_date: new Date("2024-06-01"),
            donations_count: 1,
            donations_sum: 400,
            total_donors_count: 1,
            total_donations_sum: 400,
            total_donations_count: 1,
          },
        ],
        [],
      ]);

      const result = await DAO.donors.getAll(
        sort,
        0,
        10,
        { donorId: null, recipientOrgIDs: [12, 17] },
        RequestLocale.NO,
      );

      expect(queryStub).toHaveBeenCalledOnce();
      const sql = queryStub.mock.calls[0][0] as string;

      expect(sql).toContain("selected_org_shares AS");
      expect(sql).toContain("INNER JOIN selected_org_shares");
      expect(sql).toContain("INNER JOIN DonorAggregates");
      expect(sql).toContain(
        "COALESCE(SUM(ROUND(Dons.sum_confirmed * selected_org_shares.selected_share, 2)), 0)",
      );
      expect(sql).toContain("Distribution_cause_areas.Percentage_share / 100");
      expect(sql).toContain("Distribution_cause_area_organizations.Percentage_share / 100");
      expect(sql).toContain("Organization_ID IN (12,17)");
      expect(sql).not.toContain("EXISTS");

      expect(result.rows[0].donationsSum).toBe(400);
      expect(result.statistics).toStrictEqual({
        totalDonors: 1,
        totalDonationSum: 400,
        totalDonationCount: 1,
      });
    });

    it("returns empty statistics without querying when no organizations are selected", async () => {
      const queryStub = vi.spyOn(DAO, "query").mockReturnValue(undefined as any);

      const result = await DAO.donors.getAll(
        sort,
        0,
        10,
        { donorId: null, recipientOrgIDs: [] },
        RequestLocale.NO,
      );

      expect(queryStub).not.toHaveBeenCalled();
      expect(result).toStrictEqual({
        rows: [],
        statistics: {
          totalDonors: 0,
          totalDonationCount: 0,
          totalDonationSum: 0,
        },
        pages: 0,
      });
    });
  });
});
