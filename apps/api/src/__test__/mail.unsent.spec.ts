import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import * as mail from "../custom_modules/mail";

/**
 * These three emails lost their mailgun implementation and never gained a
 * MailerSend template. They used to return true, so all 17 call sites believed
 * the mail had gone out. These tests pin the opposite: they must report failure
 * and say so in the log, until someone rebuilds them.
 *
 * When one is rebuilt, its case here should fail - that is the point. Move it
 * out of this list and test the real send instead.
 */
describe("emails with no MailerSend template", function () {
  let errorStub: MockInstance;

  beforeEach(function () {
    errorStub = vi.spyOn(console, "error").mockReturnValue(undefined);
  });

  afterEach(function () {
    vi.restoreAllMocks();
  });

  const cases: Array<[string, () => Promise<unknown>]> = [
    ["sendVippsAgreementChange", () => mail.sendVippsAgreementChange("code", "STOPPED")],
    ["sendAvtaleGiroChange", () => mail.sendAvtaleGiroChange("123", "AMOUNT", "500")],
    ["sendAvtalegiroRegistered", () => mail.sendAvtalegiroRegistered(null as any)],
  ];

  cases.forEach(([name, invoke]) => {
    it(`${name} reports failure rather than claiming success`, async function () {
      const result = await invoke();

      expect(result, "must not report success while sending nothing").toBe(false);
    });

    it(`${name} logs an error naming itself`, async function () {
      await invoke();

      expect(errorStub).toHaveBeenCalledOnce();
      const message = errorStub.mock.calls[0][0];
      expect(message).toContain("[unsent-email]");
      expect(message).toContain(name);
    });
  });
});
