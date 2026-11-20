import { describe, it, expect } from "vitest";
import { giftAmountText } from "./giftAmountText";

describe("giftAmountText", () => {
  const templates = {
    gift_amount_text_template: "{name} ga {sum} kr",
    anonymous_gift_amount_text_template: "En gave på {sum} kr ble gitt",
    recurring_gift_amount_text_template: "{name} ga {sum} kr og startet en fast avtale",
    anonymous_recurring_gift_amount_text_template:
      "En gave på {sum} kr ble gitt med en fast avtale",
  };

  it("uses the ordinary template for a named, one-off gift", () => {
    expect(giftAmountText(templates, "Kari", "500", false)).to.equal("Kari ga 500 kr");
  });

  it("uses the ordinary anonymous template for an anonymous, one-off gift", () => {
    expect(giftAmountText(templates, null, "500", false)).to.equal("En gave på 500 kr ble gitt");
  });

  it("uses the recurring template for a named, recurring gift", () => {
    expect(giftAmountText(templates, "Kari", "500", true)).to.equal(
      "Kari ga 500 kr og startet en fast avtale",
    );
  });

  it("uses the anonymous recurring template for an anonymous, recurring gift", () => {
    expect(giftAmountText(templates, null, "500", true)).to.equal(
      "En gave på 500 kr ble gitt med en fast avtale",
    );
  });

  it("falls back to the ordinary templates when the recurring ones are not set", () => {
    const withoutRecurringTemplates = {
      gift_amount_text_template: templates.gift_amount_text_template,
      anonymous_gift_amount_text_template: templates.anonymous_gift_amount_text_template,
    };
    expect(giftAmountText(withoutRecurringTemplates, "Kari", "500", true)).to.equal(
      "Kari ga 500 kr",
    );
    expect(giftAmountText(withoutRecurringTemplates, null, "500", true)).to.equal(
      "En gave på 500 kr ble gitt",
    );
  });
});
