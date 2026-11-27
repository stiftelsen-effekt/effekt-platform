import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import { DAO } from "../custom_modules/DAO";
import { normalizeDonorEmail } from "../custom_modules/donorEmail";

describe("normalizeDonorEmail", function () {
  it("strips surrounding whitespace", function () {
    expect(normalizeDonorEmail("jack@overlookhotel.com ")).toBe("jack@overlookhotel.com");
    expect(normalizeDonorEmail(" jack@overlookhotel.com")).toBe("jack@overlookhotel.com");
    expect(normalizeDonorEmail("\tjack@overlookhotel.com\n")).toBe("jack@overlookhotel.com");
  });

  it("leaves a clean address untouched", function () {
    expect(normalizeDonorEmail("jack@overlookhotel.com")).toBe("jack@overlookhotel.com");
  });

  it("passes through null and undefined", function () {
    expect(normalizeDonorEmail(null)).toBe(null);
    expect(normalizeDonorEmail(undefined)).toBe(undefined);
  });

  /**
   * The cases below are the point of the helper being this conservative. Each of
   * these transformations merges mailboxes that can belong to different people,
   * and a donor id is all it takes to read another donor's donations and tax
   * units, so none of them may creep in later.
   */
  it("does not change case", function () {
    expect(normalizeDonorEmail("Jack@OverlookHotel.com")).toBe("Jack@OverlookHotel.com");
  });

  it("does not strip dots from the local part", function () {
    expect(normalizeDonorEmail("j.torrance@overlookhotel.com")).toBe(
      "j.torrance@overlookhotel.com",
    );
  });

  it("does not strip subaddress tags", function () {
    expect(normalizeDonorEmail("jack+effekt@overlookhotel.com")).toBe(
      "jack+effekt@overlookhotel.com",
    );
  });

  it("does not touch whitespace inside a quoted local part", function () {
    expect(normalizeDonorEmail('"jack torrance"@overlookhotel.com')).toBe(
      '"jack torrance"@overlookhotel.com',
    );
  });
});

describe("donors DAO email normalization", function () {
  let executeStub: MockInstance;
  let queryStub: MockInstance;

  beforeEach(function () {
    executeStub = vi.spyOn(DAO, "execute").mockReturnValue(undefined as any);
    queryStub = vi.spyOn(DAO, "query").mockReturnValue(undefined as any);
  });

  afterEach(function () {
    vi.restoreAllMocks();
  });

  it("looks up donors by the trimmed address", async function () {
    executeStub.mockResolvedValue([[{ ID: 237 }]]);

    const id = await DAO.donors.getIDbyEmail("jack@overlookhotel.com ");

    expect(id).toBe(237);
    expect(executeStub.mock.calls[0][1]).toStrictEqual(["jack@overlookhotel.com"]);
  });

  it("stores new donors with the trimmed address", async function () {
    queryStub.mockResolvedValue([{ insertId: 237 }]);

    await DAO.donors.add({ email: " jack@overlookhotel.com ", full_name: "Jack Torrance" });

    expect(queryStub.mock.calls[0][1][0]).toBe("jack@overlookhotel.com");
  });

  it("stores updated donors with the trimmed address", async function () {
    queryStub.mockResolvedValue([{ affectedRows: 1 }]);

    await DAO.donors.update(237, "Jack Torrance", "jack@overlookhotel.com ", true, false);

    expect(queryStub.mock.calls[0][1][1]).toBe("jack@overlookhotel.com");
  });
});
