import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import * as mail from "../custom_modules/mail";
import { DAO } from "../custom_modules/DAO";
import { agreementType } from "../custom_modules/inflationadjustment";

const config = require("../config.js");

/**
 * Runs the real MailerSend SDK against a stubbed `fetch` (the SDK sends through gaxios on the
 * global fetch), so these pin what our send paths get back from it: the response on success,
 * and false - not a throw - on an API error or a network error. The callers depend on that:
 * the inflation round marks an offer sent only on `true`, and the receipts compare
 * `statusCode` with 202.
 */
describe("MailerSend transport", function () {
  let fetchStub: MockInstance;
  let errorStub: MockInstance;
  let savedApiKey: string | undefined;

  const accepted = () =>
    new Response(null, { status: 202, headers: { "x-message-id": "msg-123" } });
  const rejected = () =>
    new Response(JSON.stringify({ message: "The to.0.email must be a valid email address." }), {
      status: 422,
      headers: { "content-type": "application/json" },
    });

  /** The url, headers and JSON body of the n-th request the SDK made */
  const request = (n = 0) => {
    const [url, init] = fetchStub.mock.calls[n];
    return {
      url: String(url instanceof Request ? url.url : url),
      method: init?.method,
      headers: new Headers(init?.headers),
      body: JSON.parse(init?.body),
    };
  };

  beforeEach(function () {
    savedApiKey = config.mailersend_api_key;
    config.mailersend_api_key = "test-api-key";
    fetchStub = vi.spyOn(globalThis, "fetch").mockReturnValue(undefined as any);
    errorStub = vi.spyOn(console, "error").mockReturnValue(undefined);
  });

  afterEach(function () {
    config.mailersend_api_key = savedApiKey;
    vi.restoreAllMocks();
  });

  describe("template sends (sendSanitySecurityNotice)", function () {
    const notice = { fields: ["title"], document: "doc-1", sanityUser: "editor" } as any;

    it("posts the template, recipient, bcc and personalization, and returns the response", async function () {
      vi.spyOn(
        config,
        "mailersend_sanity_security_notification_template_id",
        "get",
      ).mockReturnValue("tmpl-1");
      fetchStub.mockResolvedValue(accepted());

      const result: any = await mail.sendSanitySecurityNotice(notice);

      expect(result.statusCode).toBe(202);
      expect(result.headers["x-message-id"]).toBe("msg-123");

      const sent = request();
      expect(sent.url).toBe("https://api.mailersend.com/v1/email");
      expect(sent.method).toBe("POST");
      expect(sent.headers.get("authorization")).toBe("Bearer test-api-key");
      expect(sent.body.to).toStrictEqual([{ email: "teknisk@gieffektivt.no" }]);
      expect(sent.body.template_id).toBe("tmpl-1");
      expect(sent.body.personalization).toStrictEqual([
        { email: "teknisk@gieffektivt.no", data: notice },
      ]);
      expect(sent.body.bcc).toBeInstanceOf(Array);
    });

    it("returns false on an API error", async function () {
      fetchStub.mockResolvedValue(rejected());

      expect(await mail.sendSanitySecurityNotice(notice)).toBe(false);
      expect(errorStub).toHaveBeenCalled();
    });

    it("returns false on a network error", async function () {
      fetchStub.mockRejectedValue(new TypeError("fetch failed"));

      expect(await mail.sendSanitySecurityNotice(notice)).toBe(false);
    });
  });

  describe("internal alerts (sendVippsErrorWarning)", function () {
    it("sends html and text from the technical inbox and returns true", async function () {
      fetchStub.mockResolvedValue(accepted());

      expect(await mail.sendVippsErrorWarning("DRAFT", "boom", { kid: "1" })).toBe(true);

      const { body } = request();
      expect(body.from).toStrictEqual({ email: "teknisk@gieffektivt.no", name: "Gi Effektivt" });
      expect(body.to).toStrictEqual([{ email: "teknisk@gieffektivt.no" }]);
      expect(body.subject).to.be.a("string").and.not.empty;
      expect(body.text).toContain("DRAFT");
      expect(body.html).toContain("DRAFT");
    });

    it("returns false on an API error", async function () {
      fetchStub.mockResolvedValue(rejected());

      expect(await mail.sendVippsErrorWarning("DRAFT", "boom", {})).toBe(false);
    });

    it("returns false on a network error", async function () {
      fetchStub.mockRejectedValue(new TypeError("fetch failed"));

      expect(await mail.sendVippsErrorWarning("DRAFT", "boom", {})).toBe(false);
    });
  });

  /** The inflation round counts an offer as sent only when this returns true */
  describe("inflation offers (sendAgreementInflationAdjustment)", function () {
    const adjustment = {
      agreement_type: agreementType.avtaleGiro,
      agreement_ID: "42",
      current_amount: 500,
      proposed_amount: 530,
      inflation_percentage: "0.06",
      token: "tok",
    } as any;

    beforeEach(function () {
      vi.spyOn(DAO.avtalegiroagreements, "getByID").mockResolvedValue({
        KID: "12345678",
        created: new Date("2024-01-15"),
      } as any);
      vi.spyOn(DAO.donors, "getByKID").mockResolvedValue({
        email: "donor@example.org",
        name: "Ola Nordmann",
      } as any);
      vi.spyOn(DAO.donations, "getAllByKID").mockResolvedValue([]);
    });

    it("returns true when MailerSend accepts the email", async function () {
      fetchStub.mockResolvedValue(accepted());

      expect(await mail.sendAgreementInflationAdjustment(adjustment)).toBe(true);

      const { body } = request();
      expect(body.to).toStrictEqual([{ email: "donor@example.org" }]);
      expect(body.personalization[0].data.firstName).toBe("Ola");
      expect(body.personalization[0].data.newAmount).toContain("530");
    });

    it("returns false on an API error", async function () {
      fetchStub.mockResolvedValue(rejected());

      expect(await mail.sendAgreementInflationAdjustment(adjustment)).toBe(false);
    });

    it("returns false on a network error", async function () {
      fetchStub.mockRejectedValue(new TypeError("fetch failed"));

      expect(await mail.sendAgreementInflationAdjustment(adjustment)).toBe(false);
    });
  });
});
