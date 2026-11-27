import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import { DAO } from "../custom_modules/DAO";
import * as avtalegiroDeletions from "../custom_modules/avtalegiro/deletions";

const mail = require("../custom_modules/mail");

describe("setAvtaleGiroStatus", () => {
  let setAvtaleGiroStatus: (KID: string, active: unknown) => Promise<unknown>;
  let setActiveStub: MockInstance;
  let requestDeletionStub: MockInstance;
  let restoreStub: MockInstance;
  let changeMailStub: MockInstance;

  beforeAll(() => {
    // These must be stubbed before importing the module
    setActiveStub = vi.spyOn(DAO.avtalegiroagreements, "setActive").mockResolvedValue(true);
    requestDeletionStub = vi
      .spyOn(avtalegiroDeletions, "requestDeletionOfUpcomingCharges")
      .mockReturnValue(undefined as any);
    restoreStub = vi
      .spyOn(DAO.avtalegirocharges, "restoreDeletionRequestsByKID")
      .mockResolvedValue(undefined);
    changeMailStub = vi.spyOn(mail, "sendAvtaleGiroChange").mockResolvedValue(false);
    vi.spyOn(console, "log").mockReturnValue(undefined);

    ({ setAvtaleGiroStatus } = require("../custom_modules/avtalegiro"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    requestDeletionStub.mockResolvedValue({ deletable: [], tooLate: [] });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("requests deletion of sent claims when the agreement is cancelled", async () => {
    requestDeletionStub.mockResolvedValue({
      deletable: [{ id: 9, KID: "111", amount: 50000, dueDate: "2026-10-27" }],
      tooLate: [],
    });

    const response = await setAvtaleGiroStatus("111", 0);

    expect(response).toBe(true);
    expect(setActiveStub).toHaveBeenCalledExactlyOnceWith("111", 0);
    expect(requestDeletionStub).toHaveBeenCalledOnce();
    expect(requestDeletionStub.mock.calls[0][0]).toBe("111");
    expect(changeMailStub).toHaveBeenCalledExactlyOnceWith("111", "CANCELLED");
    expect(restoreStub).not.toHaveBeenCalled();
  });

  it("deactivates the agreement before requesting deletions", async () => {
    await setAvtaleGiroStatus("111", 0);

    expect(setActiveStub).toHaveBeenCalledBefore(requestDeletionStub);
  });

  it("also requests deletions when cancelled with false", async () => {
    await setAvtaleGiroStatus("111", false);

    expect(requestDeletionStub).toHaveBeenCalledOnce();
  });

  it("still cancels the agreement when requesting deletions fails", async () => {
    requestDeletionStub.mockRejectedValue(new Error("Database is down"));
    const consoleStub = vi.spyOn(console, "error").mockReturnValue(undefined);

    const response = await setAvtaleGiroStatus("111", 0);

    consoleStub.mockRestore();
    expect(response).toBe(true);
    expect(setActiveStub).toHaveBeenCalledOnce();
    expect(changeMailStub).toHaveBeenCalledOnce();
  });

  it("keeps unsent deletions from going out when the agreement is reactivated", async () => {
    await setAvtaleGiroStatus("111", 1);

    expect(restoreStub).toHaveBeenCalledExactlyOnceWith("111");
    expect(requestDeletionStub).not.toHaveBeenCalled();
    expect(changeMailStub).not.toHaveBeenCalled();
  });

  it("does nothing with charges when the status is missing", async () => {
    await setAvtaleGiroStatus("111", undefined);

    expect(requestDeletionStub).not.toHaveBeenCalled();
    expect(restoreStub).not.toHaveBeenCalled();
  });
});
