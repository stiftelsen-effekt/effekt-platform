import { describe, it, expect } from "vitest";
import { parseSwedishSSN } from "../custom_modules/ssn";

describe("Swedish SSN Parser", () => {
  const currentYear = 2025;

  it("should parse a full SSN with dash correctly", () => {
    const result = parseSwedishSSN("19811216-0059", currentYear);
    expect(result.isValid).toBe(true);
    expect(result.fullYear).toBe(1981);
    expect(result.month).toBe("12");
    expect(result.day).toBe("16");
    expect(result.serialNumber).toBe("0059");
  });

  it("should parse a short SSN with dash correctly", () => {
    const result = parseSwedishSSN("811216-0059", currentYear);
    expect(result.isValid).toBe(true);
    expect(result.fullYear).toBe(1981);
    expect(result.month).toBe("12");
    expect(result.day).toBe("16");
    expect(result.serialNumber).toBe("0059");
  });

  it("should handle plus sign for people over 100 years old", () => {
    const result = parseSwedishSSN("231216+0059", currentYear);
    expect(result.isValid).toBe(true);
    expect(result.fullYear).toBe(1923);
  });

  it("should reject plus sign for people under 100 years old", () => {
    const result = parseSwedishSSN("19811216+0059", currentYear);
    expect(result.isValid).toBe(false);
  });

  it("should reject dash for people over 100 years old", () => {
    const result = parseSwedishSSN("19231216-0059", currentYear);
    expect(result.isValid).toBe(false);
  });

  it("should handle short format year threshold correctly", () => {
    // Should be interpreted as 2012 (not 1912)
    const result1 = parseSwedishSSN("121216-0059", currentYear);
    expect(result1.isValid).toBe(true);
    expect(result1.fullYear).toBe(2012);

    // Should be interpreted as 1989 (not 2089)
    const result2 = parseSwedishSSN("891216-0059", currentYear);
    expect(result2.isValid).toBe(true);
    expect(result2.fullYear).toBe(1989);
  });

  it("should reject invalid dates for personal numbers", () => {
    expect(parseSwedishSSN("19811231-0059", currentYear).isValid).toBe(true); // Valid date
    expect(parseSwedishSSN("19811200-0059", currentYear).isValid).toBe(false); // Invalid day
  });

  it("should return formatted SSN without separator", () => {
    const result = parseSwedishSSN("19811216-0059", currentYear);
    expect(result.formatted).toBe("198112160059");

    const result2 = parseSwedishSSN("811216-0059", currentYear);
    expect(result2.formatted).toBe("198112160059");

    const result3 = parseSwedishSSN("231216+0059", currentYear);
    expect(result3.formatted).toBe("192312160059");
  });

  it("should handle business identification numbers (month >= 20)", () => {
    // Short format with separator
    const result2 = parseSwedishSSN("559151-5100", currentYear);
    expect(result2.isValid).toBe(true);
    expect(result2.isBusiness).toBe(true);
    expect(result2.formatted).toBe("165591515100");

    // Short format without separator
    const result4 = parseSwedishSSN("5591515100", currentYear);
    expect(result4.isValid).toBe(true);
    expect(result4.isBusiness).toBe(true);
    expect(result4.formatted).toBe("165591515100");
  });

  it("should still handle personal SSNs correctly", () => {
    const result1 = parseSwedishSSN("198112160059", currentYear);
    expect(result1.isValid).toBe(true);
    expect(result1.fullYear).toBe(1981);
    expect(result1.formatted).toBe("198112160059");

    const result2 = parseSwedishSSN("8112160059", currentYear);
    expect(result2.isValid).toBe(true);
    expect(result2.fullYear).toBe(1981);
    expect(result2.formatted).toBe("198112160059");

    // Should interpret as 2012 since it's within the 100-year window
    const result3 = parseSwedishSSN("1212160059", currentYear);
    expect(result3.isValid).toBe(true);
    expect(result3.fullYear).toBe(2012);
    expect(result3.formatted).toBe("201212160059");
  });

  it("should reject malformed input", () => {
    expect(parseSwedishSSN("invalid", currentYear).isValid).toBe(false);
    expect(parseSwedishSSN("1981121-0059", currentYear).isValid).toBe(false); // Wrong format
    expect(parseSwedishSSN("19811216005", currentYear).isValid).toBe(false); // Too short
    expect(parseSwedishSSN("1981121600599", currentYear).isValid).toBe(false); // Too long
  });
});
