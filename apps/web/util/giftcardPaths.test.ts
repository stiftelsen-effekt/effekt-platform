import { describe, expect, it } from "vitest";
import { giftcardCertificateHref, parseGiftcardCertificatePath } from "./giftcardPaths";

describe("parseGiftcardCertificatePath", () => {
  it("finds the product slug of a certificate path", () => {
    expect(parseGiftcardCertificatePath(["gavekort", "malaria", "gavebevis"])).toBe("malaria");
  });
  it("leaves other paths alone", () => {
    expect(parseGiftcardCertificatePath(["gavekort"])).toBeNull();
    expect(parseGiftcardCertificatePath(["gavekort", "takk"])).toBeNull();
    expect(parseGiftcardCertificatePath(["gavekort", "malaria", "noe"])).toBeNull();
    expect(parseGiftcardCertificatePath(["om", "malaria", "gavebevis"])).toBeNull();
    expect(parseGiftcardCertificatePath(["gavekort", "Ma laria", "gavebevis"])).toBeNull();
  });
  it("builds the link", () => {
    expect(giftcardCertificateHref("malaria")).toBe("/gavekort/malaria/gavebevis");
  });
});
