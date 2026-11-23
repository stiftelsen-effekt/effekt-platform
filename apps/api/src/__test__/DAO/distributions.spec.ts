import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import { DAO } from "../../custom_modules/DAO";

describe("DAO Distributions", () => {
  describe("getAll", () => {
    /**
     * getAll first fetches the active organizations used to build the pivot columns, then
     * runs two queries side by side: the page (second call), which picks the page and adds
     * donation totals and organization shares for its rows, and the row count over every
     * matching distribution (third call). Rows are mapped to donation_sum / donation_count
     * plus one column per active organization.
     */
    const mockActiveOrgs = [{ abbriv: "EFF" }, { abbriv: "AMF" }];

    const mockRow = (KID: string) => ({
      KID,
      full_name: "Test Testesen",
      email: "testæøå@test.com",
      donation_sum: 100,
      donation_count: 2,
      EFF: "60.000000000000",
      AMF: "40.000000000000",
    });

    /** The page rows (second call) and the count of every matching distribution (third) */
    const resolvePage = (rows: ReturnType<typeof mockRow>[], totalRows: number) => {
      queryStub.mockResolvedValueOnce([rows, []]);
      queryStub.mockResolvedValueOnce([[{ total_rows: totalRows }], []]);
    };
    const pageSql = () => queryStub.mock.calls[1][0] as string;
    const countSql = () => queryStub.mock.calls[2][0] as string;

    const expectedRow = (KID: string) => ({
      KID,
      full_name: "Test Testesen",
      email: "testæøå@test.com",
      donation_sum: 100,
      donation_count: 2,
      EFF: 60,
      AMF: 40,
    });

    let queryStub: MockInstance;

    beforeEach(() => {
      queryStub = vi.spyOn(DAO, "query").mockReturnValue(undefined as any);
      queryStub.mockResolvedValueOnce([mockActiveOrgs, []]);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("Gets all distributions with no filter", async () => {
      resolvePage([mockRow("123456789"), mockRow("987654321")], 2);

      const result = await DAO.distributions.getAll(0, 10, { id: "KID" }, null);

      expect(queryStub).toHaveBeenCalledTimes(3);
      expect(result).toStrictEqual({
        rows: [expectedRow("123456789"), expectedRow("987654321")],
        statistics: { numDistributions: 2 },
        pages: 1,
      });
      expect(queryStub.mock.calls[0][0]).toContain("FROM Organizations");
      // The filters are the only thing that puts a LIKE in the main query
      expect(pageSql()).not.toContain("LIKE");
      expect(pageSql()).toContain("LIMIT 10");
      expect(pageSql()).toContain("OFFSET 0");
      expect(countSql()).toContain("COUNT(*) as total_rows");
      expect(countSql()).not.toContain("LIKE");
      expect(countSql()).not.toContain("LIMIT");
    });

    it("Gets all distributions with filter", async () => {
      resolvePage([mockRow("123456789"), mockRow("987654321")], 2);

      const result = await DAO.distributions.getAll(
        0,
        10,
        { id: "KID" },
        { donor: "Test Testesen" },
      );

      expect(queryStub).toHaveBeenCalledTimes(3);
      expect(result).toStrictEqual({
        rows: [expectedRow("123456789"), expectedRow("987654321")],
        statistics: { numDistributions: 2 },
        pages: 1,
      });
      expect(pageSql()).toContain("WHERE");
      expect(pageSql()).toContain("Test Testesen");
      expect(pageSql()).toContain("LIKE");
      expect(pageSql()).toContain("LIMIT 10");
      expect(pageSql()).toContain("OFFSET 0");
      // The count applies the same filter to every distribution, not just the page
      expect(countSql()).toContain("COUNT(*) as total_rows");
      expect(countSql()).toContain("Test Testesen");
      expect(countSql()).toContain("LIKE");
      expect(countSql()).not.toContain("LIMIT");
    });

    it("Gets all distributions with filter and order", async () => {
      resolvePage([mockRow("123456789"), mockRow("987654321")], 2);

      const result = await DAO.distributions.getAll(
        0,
        10,
        { id: "sum", desc: true },
        { donor: "Test Testesen" },
      );

      expect(queryStub).toHaveBeenCalledTimes(3);
      expect(result).toStrictEqual({
        rows: [expectedRow("123456789"), expectedRow("987654321")],
        statistics: { numDistributions: 2 },
        pages: 1,
      });
      expect(pageSql()).toContain("WHERE");
      expect(pageSql()).toContain("Test Testesen");
      expect(pageSql()).toContain("LIKE");
      // "sum" maps to the donation_sum alias, not to a bare "sum" column
      expect(pageSql()).toContain("ORDER BY donation_sum DESC");
      expect(pageSql()).toContain("LIMIT 10");
      expect(pageSql()).toContain("OFFSET 0");
      expect(countSql()).toContain("Test Testesen");
      expect(countSql()).not.toContain("ORDER BY");
    });

    it("Gets all distributions with correct pages counter when there are more rows than the limit", async () => {
      resolvePage([mockRow("111111111"), mockRow("222222222"), mockRow("333333333")], 3);

      const result = await DAO.distributions.getAll(0, 1, { id: "KID" }, null);

      expect(queryStub).toHaveBeenCalledTimes(3);
      expect(result).toStrictEqual({
        rows: [expectedRow("111111111"), expectedRow("222222222"), expectedRow("333333333")],
        statistics: { numDistributions: 3 },
        pages: 3,
      });
      expect(pageSql()).not.toContain("LIKE");
      expect(pageSql()).toContain("LIMIT 1");
      expect(countSql()).toContain("COUNT(*) as total_rows");
      expect(pageSql()).toContain("OFFSET 0");
    });

    it("Rejects a sort column that is not in the mapping", async () => {
      try {
        await DAO.distributions.getAll(0, 10, { id: "ID" }, null);
        throw new Error("Promise did not reject as expected");
      } catch (ex) {
        expect(ex.message).toContain("Invalid sort column: ID");
      }
    });
  });

  describe("getAllByDonor", () => {
    it("Gets all distributions for a donor with a given ID", async () => {
      const queryStub = vi.spyOn(DAO, "query").mockReturnValue(undefined as any);

      const mockQueryResponse = [
        {
          KID: "000001333993788",
          Donor_ID: 1,
          Tax_unit_ID: 1,
          Meta_owner_ID: 3,
          Replaced_old_organizations: 0,
          inserted: "2023-02-28 12:22:44",
          last_updated: "2023-02-28 12:22:44",
          ID: 9,
          Distribution_KID: "000001333993788",
          Cause_area_ID: 3,
          Percentage_share: "100.000000000000",
          Standard_split: 1,
          Distribution_cause_area_ID: 5,
          Organization_ID: 20,
          Organization_percentage_share: "100.000000000000",
          Cause_area_percentage_share: "77.000000000000",
        },
        {
          KID: "000001333993788",
          Donor_ID: 1,
          Tax_unit_ID: 1,
          Meta_owner_ID: 3,
          Replaced_old_organizations: 0,
          inserted: "2023-02-28 12:22:44",
          last_updated: "2023-02-28 12:22:44",
          ID: 10,
          Distribution_KID: "000001333993788",
          Cause_area_ID: 2,
          Percentage_share: "50.000000000000",
          Standard_split: 1,
          Distribution_cause_area_ID: 6,
          Organization_ID: 17,
          Organization_percentage_share: "50.000000000000",
          Cause_area_percentage_share: "23.000000000000",
        },
        {
          KID: "000001333993788",
          Donor_ID: 1,
          Tax_unit_ID: 1,
          Meta_owner_ID: 3,
          Replaced_old_organizations: 0,
          inserted: "2023-02-28 12:22:44",
          last_updated: "2023-02-28 12:22:44",
          ID: 11,
          Distribution_KID: "000001333993788",
          Cause_area_ID: 2,
          Percentage_share: "50.000000000000",
          Standard_split: 1,
          Distribution_cause_area_ID: 6,
          Organization_ID: 18,
          Organization_percentage_share: "50.000000000000",
          Cause_area_percentage_share: "23.000000000000",
        },
        {
          KID: "000001557651286",
          Donor_ID: 1,
          Tax_unit_ID: 1,
          Meta_owner_ID: 3,
          Replaced_old_organizations: 0,
          inserted: "2023-05-10 21:48:20",
          last_updated: "2023-05-10 21:48:20",
          ID: 1,
          Distribution_KID: "000001557651286",
          Cause_area_ID: 3,
          Percentage_share: "61.000000000000",
          Standard_split: 0,
          Distribution_cause_area_ID: 1,
          Organization_ID: 21,
          Organization_percentage_share: "61.000000000000",
          Cause_area_percentage_share: "84.000000000000",
        },
        {
          KID: "000001557651286",
          Donor_ID: 1,
          Tax_unit_ID: 1,
          Meta_owner_ID: 3,
          Replaced_old_organizations: 0,
          inserted: "2023-05-10 21:48:20",
          last_updated: "2023-05-10 21:48:20",
          ID: 2,
          Distribution_KID: "000001557651286",
          Cause_area_ID: 3,
          Percentage_share: "29.000000000000",
          Standard_split: 0,
          Distribution_cause_area_ID: 1,
          Organization_ID: 23,
          Organization_percentage_share: "29.000000000000",
          Cause_area_percentage_share: "84.000000000000",
        },
        {
          KID: "000001557651286",
          Donor_ID: 1,
          Tax_unit_ID: 1,
          Meta_owner_ID: 3,
          Replaced_old_organizations: 0,
          inserted: "2023-05-10 21:48:20",
          last_updated: "2023-05-10 21:48:20",
          ID: 3,
          Distribution_KID: "000001557651286",
          Cause_area_ID: 3,
          Percentage_share: "10.000000000000",
          Standard_split: 0,
          Distribution_cause_area_ID: 1,
          Organization_ID: 22,
          Organization_percentage_share: "10.000000000000",
          Cause_area_percentage_share: "84.000000000000",
        },
        {
          KID: "000001557651286",
          Donor_ID: 1,
          Tax_unit_ID: 1,
          Meta_owner_ID: 3,
          Replaced_old_organizations: 0,
          inserted: "2023-05-10 21:48:20",
          last_updated: "2023-05-10 21:48:20",
          ID: 4,
          Distribution_KID: "000001557651286",
          Cause_area_ID: 2,
          Percentage_share: "50.000000000000",
          Standard_split: 1,
          Distribution_cause_area_ID: 2,
          Organization_ID: 17,
          Organization_percentage_share: "50.000000000000",
          Cause_area_percentage_share: "16.000000000000",
        },
        {
          KID: "000001557651286",
          Donor_ID: 1,
          Tax_unit_ID: 1,
          Meta_owner_ID: 3,
          Replaced_old_organizations: 0,
          inserted: "2023-05-10 21:48:20",
          last_updated: "2023-05-10 21:48:20",
          ID: 5,
          Distribution_KID: "000001557651286",
          Cause_area_ID: 2,
          Percentage_share: "50.000000000000",
          Standard_split: 1,
          Distribution_cause_area_ID: 2,
          Organization_ID: 18,
          Organization_percentage_share: "50.000000000000",
          Cause_area_percentage_share: "16.000000000000",
        },
        {
          KID: "000001793339258",
          Donor_ID: 1,
          Tax_unit_ID: 1,
          Meta_owner_ID: 3,
          Replaced_old_organizations: 0,
          inserted: "2023-02-06 17:47:55",
          last_updated: "2023-02-06 17:47:55",
          ID: 15,
          Distribution_KID: "000001793339258",
          Cause_area_ID: 2,
          Percentage_share: "100.000000000000",
          Standard_split: 0,
          Distribution_cause_area_ID: 9,
          Organization_ID: 18,
          Organization_percentage_share: "100.000000000000",
          Cause_area_percentage_share: "24.000000000000",
        },
        {
          KID: "000001793339258",
          Donor_ID: 1,
          Tax_unit_ID: 1,
          Meta_owner_ID: 3,
          Replaced_old_organizations: 0,
          inserted: "2023-02-06 17:47:55",
          last_updated: "2023-02-06 17:47:55",
          ID: 16,
          Distribution_KID: "000001793339258",
          Cause_area_ID: 3,
          Percentage_share: "54.000000000000",
          Standard_split: 0,
          Distribution_cause_area_ID: 10,
          Organization_ID: 22,
          Organization_percentage_share: "54.000000000000",
          Cause_area_percentage_share: "76.000000000000",
        },
        {
          KID: "000001793339258",
          Donor_ID: 1,
          Tax_unit_ID: 1,
          Meta_owner_ID: 3,
          Replaced_old_organizations: 0,
          inserted: "2023-02-06 17:47:55",
          last_updated: "2023-02-06 17:47:55",
          ID: 17,
          Distribution_KID: "000001793339258",
          Cause_area_ID: 3,
          Percentage_share: "46.000000000000",
          Standard_split: 0,
          Distribution_cause_area_ID: 10,
          Organization_ID: 20,
          Organization_percentage_share: "46.000000000000",
          Cause_area_percentage_share: "76.000000000000",
        },
        {
          KID: "000001794945871",
          Donor_ID: 1,
          Tax_unit_ID: 1,
          Meta_owner_ID: 3,
          Replaced_old_organizations: 0,
          inserted: "2023-02-18 06:24:14",
          last_updated: "2023-02-18 06:24:14",
          ID: 6,
          Distribution_KID: "000001794945871",
          Cause_area_ID: 3,
          Percentage_share: "100.000000000000",
          Standard_split: 0,
          Distribution_cause_area_ID: 3,
          Organization_ID: 22,
          Organization_percentage_share: "100.000000000000",
          Cause_area_percentage_share: "64.000000000000",
        },
        {
          KID: "000001794945871",
          Donor_ID: 1,
          Tax_unit_ID: 1,
          Meta_owner_ID: 3,
          Replaced_old_organizations: 0,
          inserted: "2023-02-18 06:24:14",
          last_updated: "2023-02-18 06:24:14",
          ID: 7,
          Distribution_KID: "000001794945871",
          Cause_area_ID: 2,
          Percentage_share: "50.000000000000",
          Standard_split: 1,
          Distribution_cause_area_ID: 4,
          Organization_ID: 17,
          Organization_percentage_share: "50.000000000000",
          Cause_area_percentage_share: "36.000000000000",
        },
        {
          KID: "000001794945871",
          Donor_ID: 1,
          Tax_unit_ID: 1,
          Meta_owner_ID: 3,
          Replaced_old_organizations: 0,
          inserted: "2023-02-18 06:24:14",
          last_updated: "2023-02-18 06:24:14",
          ID: 8,
          Distribution_KID: "000001794945871",
          Cause_area_ID: 2,
          Percentage_share: "50.000000000000",
          Standard_split: 1,
          Distribution_cause_area_ID: 4,
          Organization_ID: 18,
          Organization_percentage_share: "50.000000000000",
          Cause_area_percentage_share: "36.000000000000",
        },
        {
          KID: "000001798639637",
          Donor_ID: 1,
          Tax_unit_ID: 1,
          Meta_owner_ID: 3,
          Replaced_old_organizations: 0,
          inserted: "2023-03-04 02:32:13",
          last_updated: "2023-03-04 02:32:13",
          ID: 12,
          Distribution_KID: "000001798639637",
          Cause_area_ID: 2,
          Percentage_share: "50.000000000000",
          Standard_split: 1,
          Distribution_cause_area_ID: 7,
          Organization_ID: 17,
          Organization_percentage_share: "50.000000000000",
          Cause_area_percentage_share: "100.000000000000",
        },
        {
          KID: "000001798639637",
          Donor_ID: 1,
          Tax_unit_ID: 1,
          Meta_owner_ID: 3,
          Replaced_old_organizations: 0,
          inserted: "2023-03-04 02:32:13",
          last_updated: "2023-03-04 02:32:13",
          ID: 13,
          Distribution_KID: "000001798639637",
          Cause_area_ID: 2,
          Percentage_share: "50.000000000000",
          Standard_split: 1,
          Distribution_cause_area_ID: 7,
          Organization_ID: 18,
          Organization_percentage_share: "50.000000000000",
          Cause_area_percentage_share: "100.000000000000",
        },
        {
          KID: "000001798639637",
          Donor_ID: 1,
          Tax_unit_ID: 1,
          Meta_owner_ID: 3,
          Replaced_old_organizations: 0,
          inserted: "2023-03-04 02:32:13",
          last_updated: "2023-03-04 02:32:13",
          ID: 14,
          Distribution_KID: "000001798639637",
          Cause_area_ID: 3,
          Percentage_share: "100.000000000000",
          Standard_split: 1,
          Distribution_cause_area_ID: 8,
          Organization_ID: 20,
          Organization_percentage_share: "100.000000000000",
          Cause_area_percentage_share: "0.000000000000",
        },
        {
          KID: "000001881542474",
          Donor_ID: 1,
          Tax_unit_ID: 1,
          Meta_owner_ID: 3,
          Replaced_old_organizations: 0,
          inserted: "2023-05-19 11:42:09",
          last_updated: "2023-05-19 11:42:09",
          ID: 18,
          Distribution_KID: "000001881542474",
          Cause_area_ID: 2,
          Percentage_share: "50.000000000000",
          Standard_split: 1,
          Distribution_cause_area_ID: 11,
          Organization_ID: 17,
          Organization_percentage_share: "50.000000000000",
          Cause_area_percentage_share: "51.000000000000",
        },
        {
          KID: "000001881542474",
          Donor_ID: 1,
          Tax_unit_ID: 1,
          Meta_owner_ID: 3,
          Replaced_old_organizations: 0,
          inserted: "2023-05-19 11:42:09",
          last_updated: "2023-05-19 11:42:09",
          ID: 19,
          Distribution_KID: "000001881542474",
          Cause_area_ID: 2,
          Percentage_share: "50.000000000000",
          Standard_split: 1,
          Distribution_cause_area_ID: 11,
          Organization_ID: 18,
          Organization_percentage_share: "50.000000000000",
          Cause_area_percentage_share: "51.000000000000",
        },
        {
          KID: "000001881542474",
          Donor_ID: 1,
          Tax_unit_ID: 1,
          Meta_owner_ID: 3,
          Replaced_old_organizations: 0,
          inserted: "2023-05-19 11:42:09",
          last_updated: "2023-05-19 11:42:09",
          ID: 20,
          Distribution_KID: "000001881542474",
          Cause_area_ID: 3,
          Percentage_share: "61.000000000000",
          Standard_split: 0,
          Distribution_cause_area_ID: 12,
          Organization_ID: 20,
          Organization_percentage_share: "61.000000000000",
          Cause_area_percentage_share: "49.000000000000",
        },
        {
          KID: "000001881542474",
          Donor_ID: 1,
          Tax_unit_ID: 1,
          Meta_owner_ID: 3,
          Replaced_old_organizations: 0,
          inserted: "2023-05-19 11:42:09",
          last_updated: "2023-05-19 11:42:09",
          ID: 21,
          Distribution_KID: "000001881542474",
          Cause_area_ID: 3,
          Percentage_share: "32.000000000000",
          Standard_split: 0,
          Distribution_cause_area_ID: 12,
          Organization_ID: 21,
          Organization_percentage_share: "32.000000000000",
          Cause_area_percentage_share: "49.000000000000",
        },
        {
          KID: "000001881542474",
          Donor_ID: 1,
          Tax_unit_ID: 1,
          Meta_owner_ID: 3,
          Replaced_old_organizations: 0,
          inserted: "2023-05-19 11:42:09",
          last_updated: "2023-05-19 11:42:09",
          ID: 22,
          Distribution_KID: "000001881542474",
          Cause_area_ID: 3,
          Percentage_share: "7.000000000000",
          Standard_split: 0,
          Distribution_cause_area_ID: 12,
          Organization_ID: 23,
          Organization_percentage_share: "7.000000000000",
          Cause_area_percentage_share: "49.000000000000",
        },
      ];

      queryStub.mockResolvedValue([mockQueryResponse, []]);

      const result = await DAO.distributions.getAllByDonor(1);

      expect(queryStub).toHaveBeenCalledOnce();
      expect(queryStub.mock.calls[0][0]).toContain("WHERE");
      expect(queryStub.mock.calls[0][0]).toContain("Donor_ID = ?");
      expect(queryStub.mock.calls[0][1]).toStrictEqual([1]);

      expect(result.distributions.length).toBe(6);

      for (const distribution of result.distributions) {
        expect(distribution.donorId).toBe(1);

        // Expect cause area percentage shares to add up to 100
        expect(
          distribution.causeAreas.reduce((acc, curr) => acc + parseFloat(curr.percentageShare), 0),
        ).toBe(100);

        for (const causeArea of distribution.causeAreas) {
          // Expect organization percentage shares to add up to 100
          expect(
            causeArea.organizations.reduce(
              (acc, curr) => acc + parseFloat(curr.percentageShare),
              0,
            ),
          ).toBe(100);
        }
      }
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });
  });

  describe("getByDonorId", () => {
    it("Gets a distribution for a donor with a given ID", async () => {
      const queryStub = vi.spyOn(DAO, "query").mockReturnValue(undefined as any);

      const mockQueryResponse = [
        {
          KID: "000001333993788",
          full_name: "Helga Larsen",
          email: "helga@larsen.no",
          sum: 1300,
          count: 3,
        },
        {
          KID: "13903788",
          full_name: "Helga Larsen",
          email: "helga@larsen.no",
          sum: 40000,
          count: 1,
        },
      ];

      queryStub.mockResolvedValue([mockQueryResponse, []]);

      const result = await DAO.distributions.getByDonorId(1);

      expect(queryStub).toHaveBeenCalledOnce();
      expect(queryStub.mock.calls[0][0]).toContain("WHERE");
      expect(queryStub.mock.calls[0][0]).toContain("Donor_ID = ?");
      expect(queryStub.mock.calls[0][1]).toStrictEqual([1]);

      expect(result).toStrictEqual(mockQueryResponse);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });
  });

  describe("getSplitByKID", () => {
    it("Gets a distribution split for a KID", async () => {
      const queryStub = vi.spyOn(DAO, "query").mockReturnValue(undefined as any);

      const mockQueryResponse = [
        {
          KID: "000001333993788",
          Donor_ID: 1,
          Tax_unit_ID: 1,
          Meta_owner_ID: 3,
          Replaced_old_organizations: 0,
          inserted: "2023-02-28 12:22:44",
          last_updated: "2023-02-28 12:22:44",
          ID: 9,
          Distribution_KID: "000001333993788",
          Cause_area_ID: 3,
          Percentage_share: "100.000000000000",
          Standard_split: 1,
          Distribution_cause_area_ID: 5,
          Organization_ID: 20,
          Organization_percentage_share: "100.000000000000",
          Cause_area_percentage_share: "77.000000000000",
        },
        {
          KID: "000001333993788",
          Donor_ID: 1,
          Tax_unit_ID: 1,
          Meta_owner_ID: 3,
          Replaced_old_organizations: 0,
          inserted: "2023-02-28 12:22:44",
          last_updated: "2023-02-28 12:22:44",
          ID: 10,
          Distribution_KID: "000001333993788",
          Cause_area_ID: 2,
          Percentage_share: "50.000000000000",
          Standard_split: 1,
          Distribution_cause_area_ID: 6,
          Organization_ID: 17,
          Organization_percentage_share: "50.000000000000",
          Cause_area_percentage_share: "23.000000000000",
        },
        {
          KID: "000001333993788",
          Donor_ID: 1,
          Tax_unit_ID: 1,
          Meta_owner_ID: 3,
          Replaced_old_organizations: 0,
          inserted: "2023-02-28 12:22:44",
          last_updated: "2023-02-28 12:22:44",
          ID: 11,
          Distribution_KID: "000001333993788",
          Cause_area_ID: 2,
          Percentage_share: "50.000000000000",
          Standard_split: 1,
          Distribution_cause_area_ID: 6,
          Organization_ID: 18,
          Organization_percentage_share: "50.000000000000",
          Cause_area_percentage_share: "23.000000000000",
        },
      ];

      queryStub.mockResolvedValue([mockQueryResponse, []]);

      const result = await DAO.distributions.getSplitByKID("000001333993788");

      expect(queryStub).toHaveBeenCalledOnce();
      expect(queryStub.mock.calls[0][0]).toContain("WHERE");
      expect(queryStub.mock.calls[0][0]).toContain("KID = ?");
      expect(queryStub.mock.calls[0][1]).toStrictEqual(["000001333993788"]);
      expect(result.kid).toBe("000001333993788");
      expect(result.causeAreas.length).toBe(2);
      expect(result.causeAreas[0].percentageShare).toBe("77.000000000000");
      expect(result.causeAreas[0].organizations.length).toBe(1);
      expect(result.causeAreas[0].organizations[0].percentageShare).toBe("100.000000000000");
      expect(result.causeAreas[1].percentageShare).toBe("23.000000000000");
      expect(result.causeAreas[1].organizations.length).toBe(2);
      expect(result.causeAreas[1].organizations[0].percentageShare).toBe("50.000000000000");
      expect(result.causeAreas[1].organizations[1].percentageShare).toBe("50.000000000000");
    });

    it("Throws error if DB query returns multiple distributions", async () => {
      const queryStub = vi.spyOn(DAO, "query").mockReturnValue(undefined as any);

      const mockQueryResponse = [
        {
          KID: "000001333993788",
          Donor_ID: 1,
          Tax_unit_ID: 1,
          Meta_owner_ID: 3,
          Replaced_old_organizations: 0,
          inserted: "2023-02-28 12:22:44",
          last_updated: "2023-02-28 12:22:44",
          ID: 9,
          Distribution_KID: "000001333993788",
          Cause_area_ID: 3,
          Percentage_share: "100.000000000000",
          Standard_split: 1,
          Distribution_cause_area_ID: 5,
          Organization_ID: 20,
          Organization_percentage_share: "100.000000000000",
          Cause_area_percentage_share: "100.000000000000",
        },
        {
          KID: "000001333993789",
          Donor_ID: 1,
          Tax_unit_ID: 1,
          Meta_owner_ID: 3,
          Replaced_old_organizations: 0,
          inserted: "2023-02-28 12:22:44",
          last_updated: "2023-02-28 12:22:44",
          ID: 10,
          Distribution_KID: "000001333993788",
          Cause_area_ID: 2,
          Percentage_share: "50.000000000000",
          Standard_split: 1,
          Distribution_cause_area_ID: 6,
          Organization_ID: 17,
          Organization_percentage_share: "50.000000000000",
          Cause_area_percentage_share: "100.000000000000",
        },
        {
          KID: "000001333993789",
          Donor_ID: 1,
          Tax_unit_ID: 1,
          Meta_owner_ID: 3,
          Replaced_old_organizations: 0,
          inserted: "2023-02-28 12:22:44",
          last_updated: "2023-02-28 12:22:44",
          ID: 11,
          Distribution_KID: "000001333993788",
          Cause_area_ID: 2,
          Percentage_share: "50.000000000000",
          Standard_split: 1,
          Distribution_cause_area_ID: 6,
          Organization_ID: 18,
          Organization_percentage_share: "50.000000000000",
          Cause_area_percentage_share: "100.000000000000",
        },
      ];

      queryStub.mockResolvedValue([mockQueryResponse, []]);

      try {
        await DAO.distributions.getSplitByKID("000001333993788");
        throw new Error("Promise did not reject as expected");
      } catch (ex) {
        expect(ex.message).toContain("multiple distributions");
      }
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });
  });
});
