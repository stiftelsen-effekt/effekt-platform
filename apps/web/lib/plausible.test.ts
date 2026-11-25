import { describe, expect, it } from "vitest";
import { plausibleTransformRequest } from "./plausible";

describe("plausibleTransformRequest", () => {
  it("reports gift card recipient pages without their code", () => {
    expect(plausibleTransformRequest({ u: "https://gieffektivt.no/gave/dmgvmdsnrb" }).u).toBe(
      "https://gieffektivt.no/gave/[code]",
    );
    expect(
      plausibleTransformRequest({ u: "https://gieffektivt.no/gave/dmgvmdsnrb?utm_source=sms" }).u,
    ).toBe("https://gieffektivt.no/gave/[code]?utm_source=sms");
  });

  it("anonymises a gift page as the referrer too", () => {
    const payload = plausibleTransformRequest({
      u: "https://gieffektivt.no/gavekort",
      r: "https://gieffektivt.no/gave/dmgvmggntt",
    });
    expect(payload.r).toBe("https://gieffektivt.no/gave/[code]");
  });

  it("leaves other pages alone", () => {
    expect(plausibleTransformRequest({ u: "https://gieffektivt.no/gavekort/malaria" }).u).toBe(
      "https://gieffektivt.no/gavekort/malaria",
    );
    expect(plausibleTransformRequest({ u: "https://gieffektivt.no/" }).u).toBe(
      "https://gieffektivt.no/",
    );
  });

  it("is self-contained, so next-plausible can inline it", () => {
    // Serialised with String(fn) into an inline script: evaluating that copy must still work
    const inlined = new Function(`return (${String(plausibleTransformRequest)})`)();
    expect(inlined({ u: "https://gieffektivt.no/gave/abcdfghjkm" }).u).toBe(
      "https://gieffektivt.no/gave/[code]",
    );
  });
});
