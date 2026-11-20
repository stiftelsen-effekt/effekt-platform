import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import { getFundraiserRedirectUrl } from "../custom_modules/fundraiserRedirect";

const config = require("../config");

describe("getFundraiserRedirectUrl", () => {
  let fetchStub: MockInstance;

  beforeEach(() => {
    vi.spyOn(config, "revalidate_token", "get").mockReturnValue("tok3n");
    fetchStub = vi.spyOn(globalThis, "fetch").mockReturnValue(undefined as any);
  });
  afterEach(() => vi.restoreAllMocks());

  it("revalidates server-side and returns the fundraiser page URL without the token", async () => {
    fetchStub.mockResolvedValue(
      new Response(null, {
        status: 307,
        headers: { location: "/innsamling/my-page?plausible=abc" },
      }),
    );

    const url = await getFundraiserRedirectUrl(12, "abc", "https://gieffektivt.no/fallback");

    expect(url).toBe("https://gieffektivt.no/innsamling/my-page?plausible=abc");
    expect(url).not.toContain("tok3n");
    const calledUrl: string = fetchStub.mock.calls[0][0];
    expect(calledUrl).toContain(
      "/api/fundraiser/redirect?fundraiserId=12&secret=tok3n&plausible=abc",
    );
    expect(fetchStub.mock.calls[0][1].redirect).toBe("manual");
  });

  it("falls back when revalidation fails", async () => {
    fetchStub.mockResolvedValue(new Response("Invalid token", { status: 401 }));
    expect(await getFundraiserRedirectUrl(12, "abc", "https://gieffektivt.no/fallback")).toBe(
      "https://gieffektivt.no/fallback",
    );

    fetchStub.mockRejectedValue(new Error("network"));
    expect(await getFundraiserRedirectUrl(12, "abc", "https://gieffektivt.no/fallback")).toBe(
      "https://gieffektivt.no/fallback",
    );
  });

  it("does not redirect to other origins", async () => {
    fetchStub.mockResolvedValue(
      new Response(null, { status: 307, headers: { location: "https://evil.example/x" } }),
    );
    expect(await getFundraiserRedirectUrl(12, "abc", "https://gieffektivt.no/fallback")).toBe(
      "https://gieffektivt.no/fallback",
    );
  });
});
