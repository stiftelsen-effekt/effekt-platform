import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import { DAO } from "../custom_modules/DAO";
import paymentMethods from "../enums/paymentMethods";
import { utcDate } from "../custom_modules/utcDate";

const ocr = require("../custom_modules/ocr");

describe("OCR import links AvtaleGiro payments to charges", () => {
  const transaction = (overrides = {}) => ({
    KID: "002556289731589",
    paymentMethod: paymentMethods.avtalegiro,
    amount: 500,
    date: utcDate(2026, 10, 27),
    transactionID: "271026.123456789",
    ...overrides,
  });

  let addDonationStub: MockInstance;
  let openChargesStub: MockInstance;
  let markCompletedStub: MockInstance;

  beforeEach(() => {
    addDonationStub = vi.spyOn(DAO.donations, "add").mockResolvedValue(1234);
    openChargesStub = vi
      .spyOn(DAO.avtalegirocharges, "getOpenChargesByKID")
      .mockReturnValue(undefined as any);
    markCompletedStub = vi.spyOn(DAO.avtalegirocharges, "markCompleted").mockResolvedValue(true);
    vi.spyOn(console, "log").mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("links the payment to the charge for its due date", async () => {
    openChargesStub.mockResolvedValue([
      { id: 7, dueDate: "2026-09-27" },
      { id: 9, dueDate: "2026-10-27" },
    ]);

    const result = await ocr.addDonation(transaction(), 3);

    expect(result).toBe(1234);
    expect(openChargesStub).toHaveBeenCalledExactlyOnceWith("002556289731589");
    expect(markCompletedStub).toHaveBeenCalledExactlyOnceWith(9, 1234);
  });

  it("links a weekend due date paid on the next banking day", async () => {
    openChargesStub.mockResolvedValue([{ id: 9, dueDate: "2026-10-24" }]);

    await ocr.addDonation(transaction({ date: utcDate(2026, 10, 26) }), 3);

    expect(markCompletedStub).toHaveBeenCalledExactlyOnceWith(9, 1234);
  });

  it("leaves the payment unlinked when no charge is close enough", async () => {
    openChargesStub.mockResolvedValue([{ id: 7, dueDate: "2026-08-27" }]);

    const result = await ocr.addDonation(transaction(), 3);

    expect(result).toBe(1234);
    expect(markCompletedStub).not.toHaveBeenCalled();
  });

  it("leaves the payment unlinked when the KID has no open charges", async () => {
    openChargesStub.mockResolvedValue([]);

    const result = await ocr.addDonation(transaction(), 3);

    expect(result).toBe(1234);
    expect(markCompletedStub).not.toHaveBeenCalled();
  });

  it("does not look for charges for bank transfers", async () => {
    await ocr.addDonation(transaction({ paymentMethod: paymentMethods.bank }), 3);

    expect(openChargesStub).not.toHaveBeenCalled();
    expect(markCompletedStub).not.toHaveBeenCalled();
  });

  it("does not look for charges when the donation already exists", async () => {
    addDonationStub.mockRejectedValue(new Error("EXISTING_DONATION"));

    const result = await ocr.addDonation(transaction(), 3);

    expect(result).toBe(-1);
    expect(openChargesStub).not.toHaveBeenCalled();
  });

  it("still imports the donation when linking fails", async () => {
    openChargesStub.mockRejectedValue(new Error("Database is down"));
    vi.spyOn(console, "error").mockReturnValue(undefined);

    const result = await ocr.addDonation(transaction(), 3);

    expect(result).toBe(1234);
    expect(markCompletedStub).not.toHaveBeenCalled();
  });

  it("links every AvtaleGiro payment in a file", async () => {
    addDonationStub.mockResolvedValueOnce(1);
    addDonationStub.mockResolvedValueOnce(2);
    openChargesStub.withArgs("111").resolves([{ id: 11, dueDate: "2026-10-27" }]);
    openChargesStub.withArgs("222").resolves([{ id: 22, dueDate: "2026-10-27" }]);
    vi.spyOn(ocr, "sendReciepts").mockResolvedValue(undefined);

    const result = await ocr.addDonations(
      [transaction({ KID: "111" }), transaction({ KID: "222" })],
      3,
    );

    expect(result.valid).toBe(2);
    expect(markCompletedStub).toHaveBeenCalledWith(11, 1);
    expect(markCompletedStub).toHaveBeenCalledWith(22, 2);
  });
});
