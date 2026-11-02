import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  vipps: vi.fn(),
  avtaleGiro: vi.fn(),
  distributions: vi.fn(),
  taxUnits: vi.fn(),
  causeAreas: vi.fn(),
  flavor: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./dal", () => ({
  verifySession: vi.fn().mockResolvedValue({ donorId: 123 }),
  donorTrpc: vi.fn().mockResolvedValue({
    minside: {
      vippsAgreements: { query: mocks.vipps },
      avtaleGiroAgreements: { query: mocks.avtaleGiro },
      distributions: { query: mocks.distributions },
      taxUnits: { query: mocks.taxUnits },
    },
  }),
}));
vi.mock("../auth0", () => ({
  auth0: { getAccessToken: vi.fn().mockResolvedValue({ token: "test" }) },
}));
vi.mock("./sanityPaths", () => ({ builtMinsidePaths: () => ({ dashboard: ["min-side"] }) }));
vi.mock("../trpc/client", () => ({
  apiFlavorFor: mocks.flavor,
  publicTrpcFor: () => ({ widget: { causeAreas: { query: mocks.causeAreas } } }),
}));

import { getAgreementsData } from "./agreements";

describe("agreements page data", () => {
  beforeEach(() => {
    mocks.flavor.mockReturnValue("trpc");
    mocks.vipps.mockResolvedValue([{ ID: "vipps" }]);
    mocks.avtaleGiro.mockResolvedValue([{ ID: 42 }]);
    mocks.distributions.mockResolvedValue([]);
    mocks.taxUnits.mockResolvedValue([]);
    mocks.causeAreas.mockResolvedValue([]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: [] }) }),
    );
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns the agreement lists if distribution and feedback services fail", async () => {
    mocks.distributions.mockRejectedValue(new Error("unavailable"));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unavailable")));
    const result = await getAgreementsData("no");
    expect(result).toMatchObject({
      site: "nordic",
      vipps: [{ ID: "vipps" }],
      avtaleGiro: [{ ID: 42 }],
      distributions: [],
    });
    expect(result.agreementFeedbackTypes).toBeUndefined();
  });

  it("still reports a failure when the agreement service itself fails", async () => {
    mocks.vipps.mockRejectedValue(new Error("agreements unavailable"));
    await expect(getAgreementsData("no")).rejects.toThrow("agreements unavailable");
  });

  it("returns Danish agreements when their distribution lookup fails", async () => {
    mocks.flavor.mockReturnValue("rest");
    mocks.distributions.mockRejectedValue(new Error("unavailable"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ kid: "123" }] }),
      }),
    );
    const result = await getAgreementsData("dk");
    expect(result).toMatchObject({ site: "dk", dkAgreements: [{ kid: "123" }], distributions: [] });
  });
});
