import { describe, it, beforeEach, afterEach, expect, vi, type Mock } from "vitest";
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
    expect(normalizeNorwegianMobile("912 34 567")).toBe("+4791234567");
    expect(normalizeNorwegianMobile("+47 412 34 567")).toBe("+4741234567");
    expect(normalizeNorwegianMobile("004791234567")).toBe("+4791234567");
    expect(normalizeNorwegianMobile("22 33 44 55")).toBe(null); // landline
    expect(normalizeNorwegianMobile("+4691234567")).toBe(null);
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
    expect(renderGiftcardSms(product.smsTemplate, values)).toBe(
      "Kjære Mia!\n\nOla: 1 myggnett.\n\nGod jul!\n\nLes mer: gieffektivt.no/gave/kxbmtrwpzd",
    );
    expect(renderGiftcardSms(product.smsTemplate, { ...values, message: null })).toBe(
      "Kjære Mia!\n\nOla: 1 myggnett.\n\nLes mer: gieffektivt.no/gave/kxbmtrwpzd",
    );
  });

  it("makes random lower case consonant codes that match the pattern", () => {
    const codes = new Set(Array.from({ length: 200 }, generateGiftcardCode));
    expect(codes.size).toBe(200);
    for (const code of codes) expect(GIFTCARD_CODE_PATTERN.test(code), code).toBe(true);
    expect(GIFTCARD_CODE_PATTERN.test("KXBMTRWPZD")).toBe(false);
    expect(GIFTCARD_CODE_PATTERN.test("kxbmtrwpza")).toBe(false); // no vowels
    expect(GIFTCARD_CODE_PATTERN.test("kxbmtrwpz2")).toBe(false); // no digits
  });

  it("links to the recipient page without https://", () => {
    expect(giftcardLink("https://gieffektivt.no/", "kxbmtrwpzd")).toBe(
      "gieffektivt.no/gave/kxbmtrwpzd",
    );
    expect(giftcardLink(undefined, "kxbmtrwpzd")).toBe("gieffektivt.no/gave/kxbmtrwpzd");
    expect(giftcardLink("http://localhost:3000", "kxbmtrwpzd")).toBe(
      "http://localhost:3000/gave/kxbmtrwpzd",
    );
  });

  it("counts the greeting limit in characters, not bytes", () => {
    expect(() => input({ message: "ø".repeat(GIFTCARD_MESSAGE_MAX) })).not.toThrow();
    expect(() => input({ message: "a".repeat(GIFTCARD_MESSAGE_MAX + 1) })).toThrow();
  });

  it("requires phone and send time for SMS, not for PDF", () => {
    expect(() => input({ recipientPhone: null })).toThrow();
    expect(() => input({ delivery: "pdf", recipientPhone: null, sendAt: null })).not.toThrow();
  });
});

describe("registerGiftcard", () => {
  const now = new Date("2026-12-01T12:00:00Z");
  let register: Mock;
  let add: Mock;

  beforeEach(() => {
    vi.spyOn(DAO.giftcards, "getProductBySlug").mockResolvedValue(product);
    add = vi.spyOn(DAO.giftcards, "add").mockResolvedValue(1);
    register = vi
      .spyOn(pending, "registerPendingDonation")
      .mockImplementation(async (_body, opts) => {
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
  afterEach(() => vi.restoreAllMocks());

  it("prices on the server and gives 100 % to the product's organization on a new KID", async () => {
    const result = await registerGiftcard(input(), now);
    expect(result).toEqual({
      ok: true,
      content: {
        KID: "87654321",
        amount: 300,
        registrationToken: "token",
        paymentProviderUrl: "https://vipps",
      },
    });
    const body = register.mock.calls[0][0];
    expect(body.amount).toBe(300);
    expect(body.recurring).toBe(false);
    expect(body.distributionCauseAreas).toEqual([
      {
        id: 1,
        percentageShare: "100",
        standardSplit: false,
        organizations: [{ id: 7, percentageShare: "100" }],
      },
    ]);
    expect(add.mock.calls[0][0]).toMatchObject({
      KID: "87654321",
      units: 3,
      amount: 300,
      recipientPhone: "+4791234567",
    });
    expect(add.mock.calls[0][0].sendAt.toISOString()).toBe("2026-12-24T15:00:00.000Z");
    expect(add.mock.calls[0][0].code).toMatch(GIFTCARD_CODE_PATTERN);
  });

  it("rejects unknown products, bad unit counts, bad phones and bad send times", async () => {
    expect(await registerGiftcard(input({ units: 1001 }), now)).toMatchObject({ ok: false });
    expect(await registerGiftcard(input({ recipientPhone: "22334455" }), now)).toMatchObject({
      ok: false,
    });
    expect(await registerGiftcard(input({ sendAt: "2026-11-01T12:00:00Z" }), now)).toMatchObject({
      ok: false,
    });
    expect(await registerGiftcard(input({ sendAt: "2028-01-01T12:00:00Z" }), now)).toMatchObject({
      ok: false,
    });
    (DAO.giftcards.getProductBySlug as Mock).mockResolvedValue({ ...product, active: false });
    expect(await registerGiftcard(input(), now)).toMatchObject({ ok: false });
    expect(register.mock.calls.length).toBe(0);
  });

  it("sends right away a send time a few minutes in the past", async () => {
    await registerGiftcard(input({ sendAt: "2026-12-01T11:55:00Z" }), now);
    expect(add.mock.calls[0][0].sendAt).toEqual(now);
  });

  it("stores no phone or send time for a PDF gift card", async () => {
    await registerGiftcard(input({ delivery: "pdf", recipientPhone: null, sendAt: null }), now);
    expect(add.mock.calls[0][0]).toMatchObject({ recipientPhone: null, sendAt: null });
  });
});

describe("sendDueGiftcardSms", () => {
  const now = new Date("2026-12-24T15:01:00Z");
  let send: Mock;
  const provider = () => ({ name: "test", send });

  beforeEach(() => {
    send = vi.fn().mockResolvedValue({ id: "msg-1" });
    vi.spyOn(DAO.giftcards, "getProductByID").mockResolvedValue(product);
    vi.spyOn(DAO, "query").mockResolvedValue([[]] as any); // buyer lookup for the "sent" email
  });
  afterEach(() => vi.restoreAllMocks());

  it("sends each claimed gift card once and marks it sent", async () => {
    vi.spyOn(DAO.giftcards, "getDueSmsIDs").mockResolvedValue([10, 11]);
    vi.spyOn(DAO.giftcards, "claimForSending").mockImplementation(async (id) => id === 10);
    vi.spyOn(DAO.giftcards, "getByID").mockResolvedValue(giftcard());
    const markSent = vi.spyOn(DAO.giftcards, "markSent").mockResolvedValue();

    const summary = await sendDueGiftcardSms(now, provider());
    expect(summary).toEqual({ due: 2, sent: 1, retrying: 0, failed: 0, skipped: 1 });
    expect(send.mock.calls.length).toBe(1);
    expect(send.mock.calls[0][0]).toBe("+4791234567");
    expect(send.mock.calls[0][1]).toContain("Kjære Mia!");
    expect(send.mock.calls[0][1]).toMatch(/Les mer: \S+\/gave\/kxbmtrwpzd$/);
    expect(markSent.mock.calls[0].slice(0, 2)).toEqual([10, "msg-1"]);
  });

  it("retries a failed send and gives up after the last attempt", async () => {
    vi.spyOn(DAO.giftcards, "getDueSmsIDs").mockResolvedValue([10]);
    vi.spyOn(DAO.giftcards, "claimForSending").mockResolvedValue(true);
    const getByID = vi
      .spyOn(DAO.giftcards, "getByID")
      .mockResolvedValue(giftcard({ sendAttempts: 1 }));
    const markFailed = vi.spyOn(DAO.giftcards, "markSendFailed").mockResolvedValue();
    send.mockRejectedValue(new Error("provider down"));

    expect((await sendDueGiftcardSms(now, provider())).retrying).toBe(1);
    expect(markFailed.mock.lastCall!).toEqual([10, "provider down", false]);

    getByID.mockResolvedValue(giftcard({ sendAttempts: MAX_SEND_ATTEMPTS }));
    expect((await sendDueGiftcardSms(now, provider())).failed).toBe(1);
    expect(markFailed.mock.lastCall![2]).toBe(true);
  });

  it("does not need an SMS provider when nothing is due", async () => {
    vi.spyOn(DAO.giftcards, "getDueSmsIDs").mockResolvedValue([]);
    expect((await sendDueGiftcardSms(now)).due).toBe(0);
  });
});

describe("getGiftForRecipient", () => {
  const now = new Date("2026-12-25T10:00:00Z");
  afterEach(() => vi.restoreAllMocks());

  const lookup = (card: Giftcard | null) => {
    const getByCode = vi.spyOn(DAO.giftcards, "getByCode").mockResolvedValue(card);
    vi.spyOn(DAO.giftcards, "getProductByID").mockResolvedValue(product);
    return getByCode;
  };

  it("returns what the page shows, and nothing about the buyer or price", async () => {
    lookup(giftcard({ status: "sent", sentAt: new Date("2026-12-24T15:00:10Z") }));
    const gift = await getGiftForRecipient("kxbmtrwpzd", now);
    expect(gift).toEqual({
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
    expect(await getGiftForRecipient("kxbmtrwpzd", now)).toBe(null);
    getByCode.mockResolvedValue(giftcard({ status: "cancelled" }));
    expect(await getGiftForRecipient("kxbmtrwpzd", now)).toBe(null);
  });

  it("expires the page after GIFT_PAGE_DAYS", async () => {
    const sentAt = new Date("2026-12-24T15:00:00Z");
    lookup(giftcard({ status: "sent", sentAt }));
    const later = new Date(sentAt.getTime() + (GIFT_PAGE_DAYS + 1) * 24 * 60 * 60 * 1000);
    expect(await getGiftForRecipient("kxbmtrwpzd", later)).toBe(null);
  });

  it("doesn't query the database for codes that can't exist", async () => {
    const getByCode = lookup(null);
    expect(await getGiftForRecipient("KXBMTRWPZD", now)).toBe(null);
    expect(await getGiftForRecipient("' OR 1=1 --", now)).toBe(null);
    expect(getByCode.mock.calls.length).toBe(0);
  });
});
