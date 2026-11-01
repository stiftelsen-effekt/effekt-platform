import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { impactApiUrl } from "../../../../lib/trpc/client";
import { fetchInterventionCosts, impactLanguage } from "./impactCosts";

const API = process.env.NEXT_PUBLIC_EFFEKT_API || "http://localhost:5050";

const cost = (abbreviation: string, costPerOutput: number, shortDescription: string) => ({
  abbreviation,
  charityId: 1,
  charityName: abbreviation,
  interventionId: 2,
  shortDescription,
  longDescription: "",
  centsPerOutput: 585,
  costPerOutput,
  currency: "NOK",
  validFrom: "2023-01-01",
  exchangeRateDate: "2026-10-30",
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("impact costs for the intervention widget", () => {
  it("asks the Norwegian API on every site", () => {
    expect(impactApiUrl("no")).toBe(API);
    expect(impactApiUrl("dk")).toBe("https://data.gieffektivt.no");
    expect(impactApiUrl("sv")).toBe("https://data.gieffektivt.no");
  });

  it("maps the site's locale to the impact API's languages", () => {
    expect(impactLanguage("no")).toBe("no");
    expect(impactLanguage("dk")).toBe("dk");
    expect(impactLanguage("sv")).toBe("sv");
    expect(impactLanguage("de")).toBe("en");
  });

  it("calls site.impactCosts once, unbatched, and maps the costs by abbreviation", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          result: { data: [cost("AMF", 58.5, "Myggnett"), cost("HKI", 20.3, "A-vitamintilskudd")] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const costs = await fetchInterventionCosts({
      abbreviations: ["AMF", "HKI", "AMF"],
      locale: "no",
      currency: "NOK",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/trpc/site.impactCosts");
    expect(url.searchParams.has("batch")).toBe(false);
    expect(JSON.parse(url.searchParams.get("input")!)).toEqual({
      abbreviations: ["AMF", "HKI"],
      language: "no",
      currency: "NOK",
    });
    expect(costs.get("AMF")).toEqual({ costPerOutput: 58.5, shortDescription: "Myggnett" });
    expect(costs.get("HKI")?.costPerOutput).toBe(20.3);
    expect(costs.has("NI")).toBe(false);
  });
});
