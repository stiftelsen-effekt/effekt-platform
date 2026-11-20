import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import { DAO } from "../../custom_modules/DAO";
import { Distribution, DistributionInput } from "../../schemas/types";

describe("DAO avtalegiroagreements", () => {
  describe("replaceDistribution", () => {
    const originalDistribution: Distribution = {
      kid: "123456789012345",
      donorId: 1,
      taxUnitId: 19,
      causeAreas: [
        {
          id: 1,
          standardSplit: false,
          percentageShare: "90",
          organizations: [
            {
              id: 1,
              percentageShare: "90",
            },
            {
              id: 2,
              percentageShare: "10",
            },
          ],
        },
        {
          id: 2,
          standardSplit: true,
          percentageShare: "10",
          organizations: [
            {
              id: 4,
              percentageShare: "50",
            },
            {
              id: 5,
              percentageShare: "50",
            },
          ],
        },
      ],
    };

    const newDistributionInput: DistributionInput = {
      donorId: 1,
      taxUnitId: 19,
      causeAreas: [
        {
          id: 1,
          standardSplit: false,
          percentageShare: "90.101",
          organizations: [
            {
              id: 1,
              percentageShare: "90",
            },
            {
              id: 2,
              percentageShare: "10",
            },
          ],
        },
        {
          id: 2,
          standardSplit: false,
          percentageShare: "9.899",
          organizations: [
            {
              id: 4,
              percentageShare: "90",
            },
            {
              id: 5,
              percentageShare: "10",
            },
          ],
        },
      ],
    };

    const newKid = "923456789012345";

    let metaStub;
    let queryStub;
    let startTransactionStub;
    let commitTransactionStub;
    let rollbackTransactionStub;
    let distributionAddStub;
    beforeEach(() => {
      queryStub = vi.spyOn(DAO, "query").mockReturnValue(undefined as any);
      metaStub = vi.spyOn(DAO.meta, "getDefaultOwnerID").mockReturnValue(undefined as any);

      // Create a fake mysql connection using sinon
      const connection = {
        query: queryStub,
      } as any;

      startTransactionStub = vi.spyOn(DAO, "startTransaction").mockResolvedValue(connection);
      commitTransactionStub = vi.spyOn(DAO, "commitTransaction").mockReturnValue(undefined as any);
      rollbackTransactionStub = vi
        .spyOn(DAO, "rollbackTransaction")
        .mockReturnValue(undefined as any);
      distributionAddStub = vi.spyOn(DAO.distributions, "add").mockReturnValue(undefined as any);
    });

    it("Should call get default owner ID if none is provided", async () => {
      await DAO.avtalegiroagreements.replaceDistribution(
        originalDistribution,
        newKid,
        newDistributionInput,
      );

      expect(metaStub).toHaveBeenCalledOnce();
    });

    it("Should not call get default owner ID if one is provided", async () => {
      await DAO.avtalegiroagreements.replaceDistribution(
        originalDistribution,
        newKid,
        newDistributionInput,
        1,
      );

      expect(metaStub).not.toHaveBeenCalled();
    });

    it("Should abort and rollback if updating KID fails", async () => {
      queryStub.mockRejectedValueOnce(new Error("Error"));

      try {
        await DAO.avtalegiroagreements.replaceDistribution(
          originalDistribution,
          newKid,
          newDistributionInput,
        );
      } catch (ex) {
        expect(ex).not.toBeUndefined();
        expect(startTransactionStub).toHaveBeenCalledOnce();
        expect(commitTransactionStub).not.toHaveBeenCalled();
        expect(rollbackTransactionStub).toHaveBeenCalledOnce();
      }
    });

    it("Should abort and rollback if updating donations fails", async () => {
      queryStub.mockRejectedValueOnce(new Error("Error"));

      try {
        await DAO.avtalegiroagreements.replaceDistribution(
          originalDistribution,
          newKid,
          newDistributionInput,
        );
      } catch (ex) {
        expect(ex).not.toBeUndefined();
        expect(startTransactionStub).toHaveBeenCalledOnce();
        expect(commitTransactionStub).not.toHaveBeenCalled();
        expect(rollbackTransactionStub).toHaveBeenCalledOnce();
      }
    });

    it("Should abort and rollback if adding new distribution fails", async () => {
      distributionAddStub.mockRejectedValue(new Error("Error"));

      try {
        await DAO.avtalegiroagreements.replaceDistribution(
          originalDistribution,
          newKid,
          newDistributionInput,
        );
      } catch (ex) {
        expect(ex).not.toBeUndefined();
        expect(startTransactionStub).toHaveBeenCalledOnce();
        expect(commitTransactionStub).not.toHaveBeenCalled();
        expect(rollbackTransactionStub).toHaveBeenCalledOnce();
      }
    });

    it("Should abort and rollback if adding link between old and new distribution fails", async () => {
      queryStub.mockRejectedValueOnce(new Error("Error"));

      try {
        await DAO.avtalegiroagreements.replaceDistribution(
          originalDistribution,
          newKid,
          newDistributionInput,
        );
      } catch (ex) {
        expect(ex).not.toBeUndefined();
        expect(startTransactionStub).toHaveBeenCalledOnce();
        expect(commitTransactionStub).not.toHaveBeenCalled();
        expect(rollbackTransactionStub).toHaveBeenCalledOnce();
      }
    });

    it("Should commit transaction if everything succeeds", async () => {
      await DAO.avtalegiroagreements.replaceDistribution(
        originalDistribution,
        newKid,
        newDistributionInput,
      );

      expect(startTransactionStub).toHaveBeenCalledOnce();
      expect(commitTransactionStub).toHaveBeenCalledOnce();
      expect(rollbackTransactionStub).not.toHaveBeenCalled();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });
  });

  describe("queries rewritten for the multiple cause area schema", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("getMissingForDate finds the donor through Distributions", async () => {
      const rows = [{ ID: 1, amount: 500 }];
      const queryStub = vi.spyOn(DAO, "query").mockResolvedValue([rows, []]);

      expect(await DAO.avtalegiroagreements.getMissingForDate(new Date(2024, 10, 19))).toBe(rows);

      const [sql, params] = queryStub.mock.calls[0];
      expect(sql).not.toMatch(/Combining_table|call /i);
      expect(sql).toContain("INNER JOIN Distributions");
      expect(params).toStrictEqual([
        ...Array(8).fill("2024-11-19"),
        ["CLAIMED", "COMPLETED"],
        "2024-11-19",
        "DELETED",
      ]);
    });

    it("getMissingForDate leaves out agreements claimed on another date that month", async () => {
      const queryStub = vi.spyOn(DAO, "query").mockResolvedValue([[], []]);

      await DAO.avtalegiroagreements.getMissingForDate(new Date(2024, 10, 19));

      const [sql] = queryStub.mock.calls[0];
      expect(sql).toContain("FROM Avtalegiro_agreement_charges AS C");
      expect(sql).toContain("C.due_date <> DATE(?)");
      expect(sql).toContain("C.status IN (?)");
    });

    it("getRecievedDonationsForDate maps donations", async () => {
      const queryStub = vi.spyOn(DAO, "query").mockResolvedValue([
        [
          {
            ID: 3,
            email: "a@b",
            full_name: "Ola",
            sum_confirmed: "400.00",
            transaction_cost: "2.00",
            KID_fordeling: "123",
            timestamp_confirmed: new Date(2024, 10, 19),
          },
        ],
        [],
      ]);

      const result = await DAO.avtalegiroagreements.getRecievedDonationsForDate(
        new Date(2024, 10, 19),
      );

      expect(queryStub.mock.calls[0][0]).not.toMatch(/Combining_table|call /i);
      expect(result).toStrictEqual([
        {
          id: 3,
          kid: "123",
          paymentMethod: "AvtaleGiro",
          email: "a@b",
          donor: "Ola",
          sum: "400.00",
          transactionCost: "2.00",
          timestamp: new Date(2024, 10, 19),
        },
      ]);
    });

    it("getAgreement returns the donor id separately from the agreement id", async () => {
      const queryStub = vi.spyOn(DAO, "query").mockResolvedValue([[{ ID: 7, donorId: 12 }], []]);
      expect(await DAO.avtalegiroagreements.getAgreement(7)).toStrictEqual({ ID: 7, donorId: 12 });
      expect(queryStub.mock.calls[0][0]).toContain("Donors.ID as donorId");
    });
  });
});
