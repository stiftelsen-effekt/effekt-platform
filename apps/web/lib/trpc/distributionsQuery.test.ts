import { describe, expect, it } from "vitest";
import { distributionsInput, distributionsQuery } from "./distributionsQuery";

describe("distributionsQuery", () => {
  it("fetches all of the donor's distributions at once from our API, without waiting for KIDs", () => {
    const key = distributionsQuery("trpc", 7, false, []);
    expect(key).toEqual(["minside.distributions", 7, "*"]);
    expect(distributionsInput(7, key![2])).toEqual({ donorId: 7 });
    // The same query (and cache entry) whatever KIDs the page has found by then
    expect(distributionsQuery("trpc", 7, true, ["111", "222"])).toEqual(key);
  });

  it("asks the Danish backend for the page's KIDs once they are known", () => {
    expect(distributionsQuery("rest", 7, false, [])).toBe(null);
    const key = distributionsQuery("rest", 7, true, ["111", "222"]);
    expect(key).toEqual(["minside.distributions", 7, "111,222"]);
    expect(distributionsInput(7, key![2])).toEqual({ donorId: 7, kids: ["111", "222"] });
  });

  it("waits for the login", () => {
    expect(distributionsQuery("trpc", null, true, ["111"])).toBe(null);
    expect(distributionsQuery("rest", null, true, ["111"])).toBe(null);
  });
});
