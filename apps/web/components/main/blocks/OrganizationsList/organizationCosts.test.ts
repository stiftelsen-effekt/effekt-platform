import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatCostPerOutput, withImpactCosts } from "./organizationCosts";

const cost = (abbreviation: string, costPerOutput: number, currency: string) => ({
  abbreviation,
  charityId: 1,
  charityName: abbreviation,
  interventionId: 2,
  shortDescription: "x",
  longDescription: "",
  centsPerOutput: 585,
  costPerOutput,
  currency,
  validFrom: "2023-01-01",
  exchangeRateDate: "2026-10-30",
});

const page = () => [
  {
    _type: "organizationslist",
    organizations: [
      { _id: "1", abbriviation: "AMF", invervention_cost: "kr 50" },
      { _id: "2", abbriviation: "XYZ", invervention_cost: "kr 99" },
      { _id: "3", invervention_cost: "kr 77" },
    ],
  },
  { _type: "paragraph" },
];

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const reply = (data: unknown[]) =>
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ result: { data } })));

describe("cost per result in the organizations list", () => {
  it("formats in the site's currency", () => {
    expect(formatCostPerOutput(58.5, "NOK", "no")).toMatch(/^(kr\s?)?59(\skr)?$|59/);
    expect(formatCostPerOutput(58.5, "DKK", "dk")).toContain("kr");
    expect(formatCostPerOutput(2.34, "SEK", "sv")).toMatch(/2,3/);
  });

  it.each([
    ["no", "NOK"],
    ["dk", "DKK"],
    ["sv", "SEK"],
  ])("asks for %s in %s and replaces the typed text", async (locale, currency) => {
    reply([cost("AMF", 58.5, currency)]);
    const content = page();
    await withImpactCosts(content, locale);

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    const input = JSON.parse(url.searchParams.get("input") ?? "{}");
    expect(JSON.stringify(input)).toContain(`"currency":"${currency}"`);

    const [amf] = content[0].organizations!;
    expect(amf.invervention_cost).not.toBe("kr 50");
    expect(amf.invervention_cost).toMatch(/59/);
  });

  it("keeps the typed text without an estimate or an abbreviation", async () => {
    reply([cost("AMF", 58.5, "NOK")]);
    const content = page();
    await withImpactCosts(content, "no");
    expect(content[0].organizations![1].invervention_cost).toBe("kr 99");
    expect(content[0].organizations![2].invervention_cost).toBe("kr 77");
  });

  it("keeps everything when the lookup fails", async () => {
    fetchMock.mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const content = page();
    await withImpactCosts(content, "no");
    expect(content[0].organizations![0].invervention_cost).toBe("kr 50");
  });

  it("makes no request for a page without an organizations list", async () => {
    await withImpactCosts([{ _type: "paragraph" }], "no");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
