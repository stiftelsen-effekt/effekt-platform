import { describe, it, beforeEach, afterEach } from "vitest";
import { expect } from "chai";
import sinon from "sinon";
import { DAO } from "../custom_modules/DAO";
import {
  generateGiftcardCode,
  GIFTCARD_CODE_PATTERN,
  giftcardLink,
  normalizeNorwegianMobile,
  renderGiftcardSms,
} from "../custom_modules/giftcards/text";
import * as pending from "../custom_modules/pendingDonationRegistration";
import {
  getGiftForRecipient,
  GIFT_PAGE_DAYS,
  MAX_SEND_ATTEMPTS,
  registerGiftcard,
  sendDueGiftcardSms,
} from "../custom_modules/giftcards/service";
import type { Giftcard, GiftcardProduct } from "../custom_modules/DAO_modules/giftcards";
import { giftcardRegisterInput, GIFTCARD_MESSAGE_MAX } from "../trpc/shared/giftcard";

const product: GiftcardProduct = {
  id: 1,
  slug: "malaria",
  name: "Beskytt et barn mot malaria",
  organizationId: 7,
  causeAreaId: 1,
  unitPrice: 100,
  unitSingular: "barn",
  unitPlural: "barn",
  minUnits: 1,
  maxUnits: 1000,
  smsTemplate:
    "Kjære {recipientName}!\n\n{senderName}: {units} {unit}.\n\n{message}\n\nLes mer: {link}",
  active: true,
};

const giftcard = (over: Partial<Giftcard> = {}): Giftcard => ({
  id: 10,
  KID: "12345678",
  code: "kxbmtrwpzd",
  productId: 1,
  units: 3,
  amount: 300,
  delivery: "sms",
  recipientName: "Mia",
  senderName: "Ola",
  message: "God jul!",
  recipientPhone: "+4791234567",
  sendAt: new Date("2026-12-24T15:00:00Z"),
  status: "sending",
  paidAt: new Date("2026-12-01T10:00:00Z"),
  sentAt: null,
  sendAttempts: 1,
  smsProviderId: null,
  lastError: null,
  senderNotifiedAt: null,
  ...over,
});

const input = (over: Record<string, unknown> = {}) =>
  giftcardRegisterInput.parse({
    product: "malaria",
    units: 3,
    delivery: "sms",
    recipientName: "Mia",
    senderName: "Ola",
    message: "God jul!",
    recipientPhone: "912 34 567",
    sendAt: "2026-12-24T16:00:00+01:00",
    donor: { email: "buyer@example.com" },
    method: 6,
    ...over,
  });

describe("gift card text", () => {
  it("normalizes Norwegian mobile numbers", () => {
    expect(normalizeNorwegianMobile("912 34 567")).to.equal("+4791234567");
    expect(normalizeNorwegianMobile("+47 412 34 567")).to.equal("+4741234567");
    expect(normalizeNorwegianMobile("004791234567")).to.equal("+4791234567");
    expect(normalizeNorwegianMobile("22 33 44 55")).to.equal(null); // landline
    expect(normalizeNorwegianMobile("+4691234567")).to.equal(null);
  });

  it("renders the SMS and drops an empty greeting line", () => {
    const values = {
      recipientName: "Mia",
      senderName: "Ola",
      message: "God jul!",
      units: 1,
      unitSingular: "myggnett",
      unitPlural: "myggnett",
      link: "gieffektivt.no/gave/kxbmtrwpzd",
    };
    expect(renderGiftcardSms(product.smsTemplate, values)).to.equal(
      "Kjære Mia!\n\nOla: 1 myggnett.\n\nGod jul!\n\nLes mer: gieffektivt.no/gave/kxbmtrwpzd",
    );
    expect(renderGiftcardSms(product.smsTemplate, { ...values, message: null })).to.equal(
      "Kjære Mia!\n\nOla: 1 myggnett.\n\nLes mer: gieffektivt.no/gave/kxbmtrwpzd",
    );
  });

  it("makes random lower case consonant codes that match the pattern", () => {
    const codes = new Set(Array.from({ length: 200 }, generateGiftcardCode));
    expect(codes.size).to.equal(200);
    for (const code of codes) expect(GIFTCARD_CODE_PATTERN.test(code), code).to.equal(true);
    expect(GIFTCARD_CODE_PATTERN.test("KXBMTRWPZD")).to.equal(false);
    expect(GIFTCARD_CODE_PATTERN.test("kxbmtrwpza")).to.equal(false); // no vowels
    expect(GIFTCARD_CODE_PATTERN.test("kxbmtrwpz2")).to.equal(false); // no digits
  });

  it("links to the recipient page without https://", () => {
    expect(giftcardLink("https://gieffektivt.no/", "kxbmtrwpzd")).to.equal(
      "gieffektivt.no/gave/kxbmtrwpzd",
    );
    expect(giftcardLink(undefined, "kxbmtrwpzd")).to.equal("gieffektivt.no/gave/kxbmtrwpzd");
    expect(giftcardLink("http://localhost:3000", "kxbmtrwpzd")).to.equal(
      "http://localhost:3000/gave/kxbmtrwpzd",
    );
  });

  it("counts the greeting limit in characters, not bytes", () => {
    expect(() => input({ message: "ø".repeat(GIFTCARD_MESSAGE_MAX) })).not.to.throw();
    expect(() => input({ message: "a".repeat(GIFTCARD_MESSAGE_MAX + 1) })).to.throw();
  });

  it("requires phone and send time for SMS, not for PDF", () => {
    expect(() => input({ recipientPhone: null })).to.throw();
    expect(() => input({ delivery: "pdf", recipientPhone: null, sendAt: null })).not.to.throw();
  });
});

describe("registerGiftcard", () => {
  const now = new Date("2026-12-01T12:00:00Z");
  let register: sinon.SinonStub;
  let add: sinon.SinonStub;

  beforeEach(() => {
    sinon.stub(DAO.giftcards, "getProductBySlug").resolves(product);
    add = sinon.stub(DAO.giftcards, "add").resolves(1);
    register = sinon.stub(pending, "registerPendingDonation").callsFake(async (_body, opts) => {
      await opts!.onNewKID!("87654321", 5);
      return {
        ok: true,
        content: {
          KID: "87654321",
          hasAnsweredReferral: false,
          registrationToken: "token",
          paymentProviderUrl: "https://vipps",
        },
      };
    });
  });
  afterEach(() => sinon.restore());

  it("prices on the server and gives 100 % to the product's organization on a new KID", async () => {
    const result = await registerGiftcard(input(), now);
    expect(result).to.deep.equal({
      ok: true,
      content: {
        KID: "87654321",
        amount: 300,
        registrationToken: "token",
        paymentProviderUrl: "https://vipps",
      },
    });
    const body = register.firstCall.args[0];
    expect(body.amount).to.equal(300);
    expect(body.recurring).to.equal(false);
    expect(body.distributionCauseAreas).to.deep.equal([
      {
        id: 1,
        percentageShare: "100",
        standardSplit: false,
        organizations: [{ id: 7, percentageShare: "100" }],
      },
    ]);
    expect(add.firstCall.args[0]).to.include({
      KID: "87654321",
      units: 3,
      amount: 300,
      recipientPhone: "+4791234567",
    });
    expect(add.firstCall.args[0].sendAt.toISOString()).to.equal("2026-12-24T15:00:00.000Z");
    expect(add.firstCall.args[0].code).to.match(GIFTCARD_CODE_PATTERN);
  });

  it("rejects unknown products, bad unit counts, bad phones and bad send times", async () => {
    expect(await registerGiftcard(input({ units: 1001 }), now)).to.deep.include({ ok: false });
    expect(await registerGiftcard(input({ recipientPhone: "22334455" }), now)).to.deep.include({
      ok: false,
    });
    expect(await registerGiftcard(input({ sendAt: "2026-11-01T12:00:00Z" }), now)).to.deep.include({
      ok: false,
    });
    expect(await registerGiftcard(input({ sendAt: "2028-01-01T12:00:00Z" }), now)).to.deep.include({
      ok: false,
    });
    (DAO.giftcards.getProductBySlug as sinon.SinonStub).resolves({ ...product, active: false });
    expect(await registerGiftcard(input(), now)).to.deep.include({ ok: false });
    expect(register.called).to.equal(false);
  });

  it("sends right away a send time a few minutes in the past", async () => {
    await registerGiftcard(input({ sendAt: "2026-12-01T11:55:00Z" }), now);
    expect(add.firstCall.args[0].sendAt).to.deep.equal(now);
  });

  it("stores no phone or send time for a PDF gift card", async () => {
    await registerGiftcard(input({ delivery: "pdf", recipientPhone: null, sendAt: null }), now);
    expect(add.firstCall.args[0]).to.include({ recipientPhone: null, sendAt: null });
  });
});

describe("sendDueGiftcardSms", () => {
  const now = new Date("2026-12-24T15:01:00Z");
  let send: sinon.SinonStub;
  const provider = () => ({ name: "test", send });

  beforeEach(() => {
    send = sinon.stub().resolves({ id: "msg-1" });
    sinon.stub(DAO.giftcards, "getProductByID").resolves(product);
    sinon.stub(DAO, "query").resolves([[]] as any); // buyer lookup for the "sent" email
  });
  afterEach(() => sinon.restore());

  it("sends each claimed gift card once and marks it sent", async () => {
    sinon.stub(DAO.giftcards, "getDueSmsIDs").resolves([10, 11]);
    sinon.stub(DAO.giftcards, "claimForSending").callsFake(async (id) => id === 10);
    sinon.stub(DAO.giftcards, "getByID").resolves(giftcard());
    const markSent = sinon.stub(DAO.giftcards, "markSent").resolves();

    const summary = await sendDueGiftcardSms(now, provider());
    expect(summary).to.deep.equal({ due: 2, sent: 1, retrying: 0, failed: 0, skipped: 1 });
    expect(send.callCount).to.equal(1);
    expect(send.firstCall.args[0]).to.equal("+4791234567");
    expect(send.firstCall.args[1]).to.contain("Kjære Mia!");
    expect(send.firstCall.args[1]).to.match(/Les mer: \S+\/gave\/kxbmtrwpzd$/);
    expect(markSent.firstCall.args.slice(0, 2)).to.deep.equal([10, "msg-1"]);
  });

  it("retries a failed send and gives up after the last attempt", async () => {
    sinon.stub(DAO.giftcards, "getDueSmsIDs").resolves([10]);
    sinon.stub(DAO.giftcards, "claimForSending").resolves(true);
    const getByID = sinon.stub(DAO.giftcards, "getByID").resolves(giftcard({ sendAttempts: 1 }));
    const markFailed = sinon.stub(DAO.giftcards, "markSendFailed").resolves();
    send.rejects(new Error("provider down"));

    expect((await sendDueGiftcardSms(now, provider())).retrying).to.equal(1);
    expect(markFailed.lastCall.args).to.deep.equal([10, "provider down", false]);

    getByID.resolves(giftcard({ sendAttempts: MAX_SEND_ATTEMPTS }));
    expect((await sendDueGiftcardSms(now, provider())).failed).to.equal(1);
    expect(markFailed.lastCall.args[2]).to.equal(true);
  });

  it("does not need an SMS provider when nothing is due", async () => {
    sinon.stub(DAO.giftcards, "getDueSmsIDs").resolves([]);
    expect((await sendDueGiftcardSms(now)).due).to.equal(0);
  });
});

describe("getGiftForRecipient", () => {
  const now = new Date("2026-12-25T10:00:00Z");
  afterEach(() => sinon.restore());

  const lookup = (card: Giftcard | null) => {
    const getByCode = sinon.stub(DAO.giftcards, "getByCode").resolves(card);
    sinon.stub(DAO.giftcards, "getProductByID").resolves(product);
    return getByCode;
  };

  it("returns what the page shows, and nothing about the buyer or price", async () => {
    lookup(giftcard({ status: "sent", sentAt: new Date("2026-12-24T15:00:10Z") }));
    const gift = await getGiftForRecipient("kxbmtrwpzd", now);
    expect(gift).to.deep.equal({
      product: "malaria",
      units: 3,
      unitSingular: "barn",
      unitPlural: "barn",
      recipientName: "Mia",
      senderName: "Ola",
      message: "God jul!",
      givenAt: "2026-12-24T15:00:10.000Z",
    });
  });

  it("hides unpaid and cancelled gift cards", async () => {
    const getByCode = lookup(giftcard({ status: "pending" }));
    expect(await getGiftForRecipient("kxbmtrwpzd", now)).to.equal(null);
    getByCode.resolves(giftcard({ status: "cancelled" }));
    expect(await getGiftForRecipient("kxbmtrwpzd", now)).to.equal(null);
  });

  it("expires the page after GIFT_PAGE_DAYS", async () => {
    const sentAt = new Date("2026-12-24T15:00:00Z");
    lookup(giftcard({ status: "sent", sentAt }));
    const later = new Date(sentAt.getTime() + (GIFT_PAGE_DAYS + 1) * 24 * 60 * 60 * 1000);
    expect(await getGiftForRecipient("kxbmtrwpzd", later)).to.equal(null);
  });

  it("doesn't query the database for codes that can't exist", async () => {
    const getByCode = lookup(null);
    expect(await getGiftForRecipient("KXBMTRWPZD", now)).to.equal(null);
    expect(await getGiftForRecipient("' OR 1=1 --", now)).to.equal(null);
    expect(getByCode.called).to.equal(false);
  });
});
