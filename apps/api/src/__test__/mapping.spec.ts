import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import { mapPureOrgSharesToDistributionInputCauseAreas } from "../custom_modules/mapping";
import { DAO } from "../custom_modules/DAO";

describe("mapPureOrgSharesToDistributionInputCauseAreas", () => {
  let getByIDStub: MockInstance;

  beforeEach(() => {
    getByIDStub = vi.spyOn(DAO.organizations, "getByID").mockReturnValue(undefined as any);
  });

  afterEach(() => {
    getByIDStub.mockRestore();
  });

  it("should map pure org shares to distribution input cause areas", async () => {
    // Stubbing the DAO requests
    getByIDStub.mockResolvedValue({ cause_area_ID: 1 });

    // Test data
    const shares = [
      { orgId: 1, percentageShare: 50 },
      { orgId: 2, percentageShare: 30 },
      { orgId: 3, percentageShare: 20 },
    ];

    // Expected result
    const expectedCauseAreas = [
      {
        id: 1,
        percentageShare: "100",
        standardSplit: false,
        organizations: [
          { id: 1, percentageShare: "50" },
          { id: 2, percentageShare: "30" },
          { id: 3, percentageShare: "20" },
        ],
      },
    ];

    // Call the function
    const result = await mapPureOrgSharesToDistributionInputCauseAreas(shares);

    // Assertions
    expect(result).toStrictEqual(expectedCauseAreas);
    expect(getByIDStub).toHaveBeenCalledTimes(3);
    expect(getByIDStub.mock.calls[0][0]).toBe(1);
    expect(getByIDStub.mock.calls[1][0]).toBe(2);
    expect(getByIDStub.mock.calls[2][0]).toBe(3);
  });

  it("should map pure org shares to distribution input cause areas with multiple cause areas", async () => {
    // Stubbing the DAO requests
    getByIDStub.mockResolvedValueOnce({ cause_area_ID: 1 });
    getByIDStub.mockResolvedValueOnce({ cause_area_ID: 2 });
    getByIDStub.mockResolvedValueOnce({ cause_area_ID: 2 });

    // Test data
    const shares = [
      { orgId: 1, percentageShare: 50 },
      { orgId: 2, percentageShare: 30 },
      { orgId: 3, percentageShare: 20 },
    ];

    // Expected result
    const expectedCauseAreas = [
      {
        id: 1,
        percentageShare: "50",
        standardSplit: false,
        organizations: [{ id: 1, percentageShare: "100" }],
      },
      {
        id: 2,
        percentageShare: "50",
        standardSplit: false,
        organizations: [
          { id: 2, percentageShare: "60" },
          { id: 3, percentageShare: "40" },
        ],
      },
    ];

    // Call the function
    const result = await mapPureOrgSharesToDistributionInputCauseAreas(shares);

    // Assertions
    expect(result).toStrictEqual(expectedCauseAreas);
    expect(getByIDStub).toHaveBeenCalledTimes(3);
    expect(getByIDStub.mock.calls[0][0]).toBe(1);
    expect(getByIDStub.mock.calls[1][0]).toBe(2);
    expect(getByIDStub.mock.calls[2][0]).toBe(3);
  });

  it("should throw an error if no shares are provided", async () => {
    // Test data
    const shares = [];

    // Call the function and expect it to throw an error
    try {
      await mapPureOrgSharesToDistributionInputCauseAreas(shares);
      throw new Error("Expected an error to be thrown");
    } catch (error) {
      expect(error.message).toBe("No shares");
    }
  });

  it("should throw an error if shares do not add up to 100", async () => {
    // Test data
    const shares = [
      { orgId: 1, percentageShare: 50 },
      { orgId: 2, percentageShare: 30 },
    ];

    // Call the function and expect it to throw an error
    try {
      await mapPureOrgSharesToDistributionInputCauseAreas(shares);
      throw new Error("Expected an error to be thrown");
    } catch (error) {
      expect(error.message).toBe("Shares do not add up to 100");
    }
  });

  it("should throw an error if organization is not found", async () => {
    // Stubbing the DAO requests
    getByIDStub.mockResolvedValue(null);

    // Test data
    const shares = [
      { orgId: 1, percentageShare: 50 },
      { orgId: 2, percentageShare: 50 },
    ];

    // Call the function and expect it to throw an error
    try {
      await mapPureOrgSharesToDistributionInputCauseAreas(shares);
      throw new Error("Expected an error to be thrown");
    } catch (error) {
      expect(error.message).toBe("Organization not found");
      expect(getByIDStub).toHaveBeenCalledExactlyOnceWith(1);
    }
  });
});
