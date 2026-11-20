import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import * as mail from "../custom_modules/mail";

/**
 * The two Vipps alerts go to staff rather than donors, so they are sent as
 * plain text and HTML with no MailerSend template behind them.
 *
 * The delivery itself is not covered here: the MailerSend client is
 * constructed inside the send, so exercising the happy path would mean a real
 * HTTP call. What is covered is the formatting, and the refusal to claim
 * success when the alert cannot be addressed.
 */
describe("internal alerts", function () {
  describe("formatInternalAlert", function () {
    it("renders every field in both text and html", function () {
      const { text, html } = mail.formatInternalAlert("Noe feilet", [
        ["Tidspunkt", "1. januar 2026"],
        ["Feiltype", "DRAFT"],
      ]);

      expect(text).toContain("Noe feilet");
      expect(text).toContain("Tidspunkt: 1. januar 2026");
      expect(text).toContain("Feiltype: DRAFT");

      expect(html).toContain("<strong>Noe feilet</strong>");
      expect(html).toContain("Tidspunkt:");
      expect(html).toContain("DRAFT");
    });

    it("escapes html so a donor message cannot inject markup", function () {
      const { html } = mail.formatInternalAlert("Rapport", [
        ["Melding", '<script>alert("x")</script> & "quoted"'],
      ]);

      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
      expect(html).toContain("&amp;");
      expect(html).toContain("&quot;");
    });

    it("keeps the plain text unescaped", function () {
      const { text } = mail.formatInternalAlert("Rapport", [["Melding", "a & b"]]);

      expect(text).toContain("a & b");
    });
  });

  /**
   * MAILERSEND_API_KEY is unset in the test environment, which is the branch
   * these assert - and which also keeps them off the network. Returning false
   * here is the whole point: the previous implementation returned true while
   * sending nothing.
   */
  describe("when MailerSend is not configured", function () {
    let errorStub: MockInstance;

    beforeEach(function () {
      errorStub = vi.spyOn(console, "error").mockReturnValue(undefined);
    });

    afterEach(function () {
      vi.restoreAllMocks();
    });

    it("sendVippsProblemReport reports failure and names the missing configuration", async function () {
      const result = await mail.sendVippsProblemReport("url", "a@b.no", "melding", null);

      expect(result).toBe(false);
      expect(errorStub).toHaveBeenCalledOnce();
      expect(errorStub.mock.calls[0][0]).toContain("sendVippsProblemReport");
      expect(errorStub.mock.calls[0][0]).toContain("MAILERSEND_API_KEY");
    });

    it("sendVippsErrorWarning reports failure and names the missing configuration", async function () {
      const result = await mail.sendVippsErrorWarning("DRAFT", "boom", { kid: "1" });

      expect(result).toBe(false);
      expect(errorStub).toHaveBeenCalledOnce();
      expect(errorStub.mock.calls[0][0]).toContain("sendVippsErrorWarning");
      expect(errorStub.mock.calls[0][0]).toContain("MAILERSEND_API_KEY");
    });
  });
});
