import { describe, it, beforeEach, afterEach } from "vitest";
import { expect } from "chai";
import sinon from "sinon";
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
  const sandbox = sinon.createSandbox();
  let fetchStub: sinon.SinonStub;
  let errorStub: sinon.SinonStub;
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
    const [url, init] = fetchStub.getCall(n).args;
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
    fetchStub = sandbox.stub(globalThis, "fetch");
    errorStub = sandbox.stub(console, "error");
  });

  afterEach(function () {
    config.mailersend_api_key = savedApiKey;
    sandbox.restore();
  });

  describe("template sends (sendSanitySecurityNotice)", function () {
    const notice = { fields: ["title"], document: "doc-1", sanityUser: "editor" } as any;

    it("posts the template, recipient, bcc and personalization, and returns the response", async function () {
      sandbox.stub(config, "mailersend_sanity_security_notification_template_id").value("tmpl-1");
      fetchStub.resolves(accepted());

      const result: any = await mail.sendSanitySecurityNotice(notice);

      expect(result.statusCode).to.equal(202);
      expect(result.headers["x-message-id"]).to.equal("msg-123");

      const sent = request();
      expect(sent.url).to.equal("https://api.mailersend.com/v1/email");
      expect(sent.method).to.equal("POST");
      expect(sent.headers.get("authorization")).to.equal("Bearer test-api-key");
      expect(sent.body.to).to.deep.equal([{ email: "teknisk@gieffektivt.no" }]);
      expect(sent.body.template_id).to.equal("tmpl-1");
      expect(sent.body.personalization).to.deep.equal([
        { email: "teknisk@gieffektivt.no", data: notice },
      ]);
      expect(sent.body.bcc).to.be.an("array");
    });

    it("returns false on an API error", async function () {
      fetchStub.resolves(rejected());

      expect(await mail.sendSanitySecurityNotice(notice)).to.equal(false);
      expect(errorStub.called).to.be.true;
    });

    it("returns false on a network error", async function () {
      fetchStub.rejects(new TypeError("fetch failed"));

      expect(await mail.sendSanitySecurityNotice(notice)).to.equal(false);
    });
  });

  describe("internal alerts (sendVippsErrorWarning)", function () {
    it("sends html and text from the technical inbox and returns true", async function () {
      fetchStub.resolves(accepted());

      expect(await mail.sendVippsErrorWarning("DRAFT", "boom", { kid: "1" })).to.equal(true);

      const { body } = request();
      expect(body.from).to.deep.equal({ email: "teknisk@gieffektivt.no", name: "Gi Effektivt" });
      expect(body.to).to.deep.equal([{ email: "teknisk@gieffektivt.no" }]);
      expect(body.subject).to.be.a("string").and.not.empty;
      expect(body.text).to.contain("DRAFT");
      expect(body.html).to.contain("DRAFT");
    });

    it("returns false on an API error", async function () {
      fetchStub.resolves(rejected());

      expect(await mail.sendVippsErrorWarning("DRAFT", "boom", {})).to.equal(false);
    });

    it("returns false on a network error", async function () {
      fetchStub.rejects(new TypeError("fetch failed"));

      expect(await mail.sendVippsErrorWarning("DRAFT", "boom", {})).to.equal(false);
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
      sandbox
        .stub(DAO.avtalegiroagreements, "getByID")
        .resolves({ KID: "12345678", created: new Date("2024-01-15") } as any);
      sandbox
        .stub(DAO.donors, "getByKID")
        .resolves({ email: "donor@example.org", name: "Ola Nordmann" } as any);
      sandbox.stub(DAO.donations, "getAllByKID").resolves([]);
    });

    it("returns true when MailerSend accepts the email", async function () {
      fetchStub.resolves(accepted());

      expect(await mail.sendAgreementInflationAdjustment(adjustment)).to.equal(true);

      const { body } = request();
      expect(body.to).to.deep.equal([{ email: "donor@example.org" }]);
      expect(body.personalization[0].data.firstName).to.equal("Ola");
      expect(body.personalization[0].data.newAmount).to.contain("530");
    });

    it("returns false on an API error", async function () {
      fetchStub.resolves(rejected());

      expect(await mail.sendAgreementInflationAdjustment(adjustment)).to.equal(false);
    });

    it("returns false on a network error", async function () {
      fetchStub.rejects(new TypeError("fetch failed"));

      expect(await mail.sendAgreementInflationAdjustment(adjustment)).to.equal(false);
    });
  });
});
