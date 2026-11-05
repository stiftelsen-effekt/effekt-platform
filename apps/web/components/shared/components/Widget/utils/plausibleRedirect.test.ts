import { describe, expect, it } from "vitest";
import { withPlausibleParam } from "./plausibleRedirect";

const data = { revenue: "250", method: "dkbank", recurring: true, kid: "000012345678" };

const decode = (url: string) => {
  const param = new URL(url, "https://giveffektivt.dk").searchParams.get("plausible");
  return JSON.parse(Buffer.from(param ?? "", "base64").toString("utf-8"));
};

describe("withPlausibleParam", () => {
  it("adds the tracking data in the format PlausibleRevenueTracker decodes", () => {
    const url = withPlausibleParam("/tak", data);
    expect(url.startsWith("/tak?plausible=")).toBe(true);
    expect(decode(url)).toEqual(data);
  });

  it("keeps a query string the redirect already has", () => {
    const url = withPlausibleParam("/tak?kilde=bank", data);
    expect(new URL(url, "https://giveffektivt.dk").searchParams.get("kilde")).toBe("bank");
    expect(decode(url)).toEqual(data);
  });

  it("escapes base64 characters that have a meaning in a URL", () => {
    // This KID makes the base64 string contain "+" or "/", which must not reach the URL raw.
    const url = withPlausibleParam("/tak", { ...data, kid: "~~~>>>???" });
    expect(url.split("plausible=")[1]).not.toMatch(/[+/=]/);
    expect(decode(url).kid).toBe("~~~>>>???");
  });
});
