import { describe, expect, it } from "vitest";
import { originOf } from "./ConnectionHints";

describe("originOf", () => {
  it("takes the origin of a URL", () => {
    expect(originOf("https://data.gieffektivt.no")).toBe("https://data.gieffektivt.no");
    expect(originOf("https://data.gieffektivt.no/")).toBe("https://data.gieffektivt.no");
    expect(originOf("http://localhost:5150")).toBe("http://localhost:5150");
  });

  it("reads a bare host name (Auth0's domain setting) as https", () => {
    expect(originOf("login.gieffektivt.no")).toBe("https://login.gieffektivt.no");
  });

  it("gives nothing for a missing or broken setting", () => {
    expect(originOf(undefined)).toBe(null);
    expect(originOf("")).toBe(null);
    expect(originOf("http://")).toBe(null);
  });
});
