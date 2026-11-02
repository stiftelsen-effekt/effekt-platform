import { describe, expect, it } from "vitest";
import { appRouteFor, pathSegments, type MinsidePaths } from "./routes";

const NO: MinsidePaths = {
  dashboard: ["min-side"],
  donations: ["min-side", "donasjoner"],
  agreements: ["min-side", "avtaler"],
  tax: ["min-side", "skatt"],
  profile: ["min-side", "profil"],
  vippsAnonymous: ["min-side", "vipps-anonym"],
};

const route = (path: string) => appRouteFor(pathSegments(path), NO);

describe("appRouteFor", () => {
  it("maps the donations, also by year", () => {
    expect(route("/min-side")).toEqual({ path: "/minside-app/donations", public: false });
    expect(route("/min-side/donasjoner")?.path).toBe("/minside-app/donations");
    expect(route("/min-side/donasjoner/2024")?.path).toBe("/minside-app/donations/2024");
  });

  it("maps the other pages", () => {
    expect(route("/min-side/avtaler")?.path).toBe("/minside-app/agreements");
    expect(route("/min-side/profil")?.path).toBe("/minside-app/profile");
    expect(route("/min-side/skatt")?.path).toBe("/minside-app/tax");
    expect(route("/min-side/skatt/arsoppgaver")?.path).toBe("/minside-app/tax/arsoppgaver");
  });

  it("serves the anonymous Vipps page without a login", () => {
    expect(route("/min-side/vipps-anonym")).toEqual({
      path: "/minside-app/vipps-anonymous",
      public: true,
    });
  });

  it("shows the donations for other paths below the dashboard, as the pages router did", () => {
    expect(route("/min-side/ukjent")?.path).toBe("/minside-app/donations");
    expect(route("/min-side/donasjoner/abc")?.path).toBe("/minside-app/donations");
    expect(route("/min-side/avtaler/x")?.path).toBe("/minside-app/donations");
  });

  it("leaves everything outside Min Side alone", () => {
    expect(route("/")).toBeNull();
    expect(route("/min-sidex")).toBeNull();
    expect(route("/om-oss")).toBeNull();
  });

  it("works with multi-segment slugs and missing pages", () => {
    const paths: MinsidePaths = {
      dashboard: ["da", "min-side"],
      donations: null,
      agreements: null,
      tax: null,
      profile: null,
      vippsAnonymous: null,
    };
    expect(appRouteFor(["da", "min-side"], paths)?.path).toBe("/minside-app/donations");
    expect(appRouteFor(["da"], paths)).toBeNull();
  });
});

describe("pathSegments", () => {
  it("drops empty segments and decodes", () => {
    expect(pathSegments("/min-side/donasjoner/")).toEqual(["min-side", "donasjoner"]);
    expect(pathSegments("/min-side/%C3%A5r")).toEqual(["min-side", "år"]);
    expect(pathSegments("/%E0%A4%A")).toEqual(["%E0%A4%A"]);
  });
});
