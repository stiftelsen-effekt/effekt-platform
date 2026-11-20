import { describe, it, afterEach, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { DAO } from "../custom_modules/DAO";
import type {
  Giftcard,
  GiftcardAdminRow,
  GiftcardProduct,
} from "../custom_modules/DAO_modules/giftcards";
import { maskPhone } from "../custom_modules/giftcards/text";
import { appRouter } from "../trpc/router";
import { createCallerFactory } from "../trpc/trpc";

const createCaller = createCallerFactory(appRouter);

const callerWith = (permissions?: string[]) =>
  createCaller({
    req: {} as Request,
    res: {} as Response,
    auth: permissions ? { permissions, sub: "auth0|admin" } : undefined,
  });

const admin = () => callerWith(["admin"]).giftcards;

const expectTrpcError = async (promise: Promise<unknown>, code: string, message?: string) => {
  try {
    await promise;
    expect.unreachable(`expected ${code}`);
  } catch (err: any) {
    expect(err.code).toBe(code);
    if (message) expect(err.message).toBe(message);
  }
};

const row: GiftcardAdminRow = {
  id: 3,
  KID: "000007100000013",
  code: "kxbmtrwpzd",
  productSlug: "malaria",
  productName: "Beskytt et barn mot malaria",
  units: 2,
  amount: "200.00",
  delivery: "sms",
  donorId: 7,
  donorName: "Kari Nordmann",
  donorEmail: "kari@example.com",
  recipientName: "Mia",
  recipientPhone: "+4791234567",
  senderName: "Kari",
  message: "God jul!",
  sendAt: new Date("2026-12-24T15:00:00Z"),
  status: "failed",
  paidAt: new Date("2026-12-01T10:00:00Z"),
  sentAt: null,
  sendAttempts: 3,
  lastError: "Provider timeout",
  smsProviderId: null,
  senderNotifiedAt: null,
  created: new Date("2026-12-01T09:58:00Z"),
  lastUpdated: new Date("2026-12-24T15:05:00Z"),
};

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
  smsTemplate: "Kjære {recipientName}!\n\n{message}\n\n{senderName}: {units} {unit}. {link}",
  active: true,
};

const stored = (over: Partial<Giftcard> = {}): Giftcard =>
  ({ id: 3, status: "sent", delivery: "sms", ...over }) as Giftcard;

describe("maskPhone", () => {
  it("keeps the country code, two first and two last digits", () => {
    expect(maskPhone("+4791234567")).toBe("+4791****67");
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone("12345")).toBe("*****");
  });
});

describe("tRPC giftcards router (admin)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("rejects anonymous and non-admin callers", async () => {
    const getList = vi.spyOn(DAO.giftcards, "getAdminList").mockReturnValue(undefined as any);
    const cancel = vi.spyOn(DAO.giftcards, "cancel").mockResolvedValue(true);
    await expectTrpcError(callerWith().giftcards.list({ page: 0, limit: 10 }), "UNAUTHORIZED");
    await expectTrpcError(callerWith(["read:profile"]).giftcards.cancel({ id: 3 }), "FORBIDDEN");
    expect(getList).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("rejects invalid input", async () => {
    const getList = vi.spyOn(DAO.giftcards, "getAdminList").mockReturnValue(undefined as any);
    const invalid: unknown[] = [
      { page: 0, limit: 10, sort: { id: "Send_at; DROP TABLE Giftcards", desc: true } },
      { page: 0, limit: 10, filter: { statuses: ["waiting"] } },
      { page: 0, limit: 10, filter: { deliveries: ["email"] } },
      { page: 0, limit: 10, filter: { unknown: 1 } },
    ];
    for (const input of invalid) {
      await expectTrpcError(admin().list(input as any), "BAD_REQUEST");
    }
    await expectTrpcError(admin().reschedule({ id: 3, sendAt: "24.12.2026" }), "BAD_REQUEST");
    expect(getList).not.toHaveBeenCalled();
  });

  it("lists with filters and sort, masking the phone and leaving out the greeting", async () => {
    const getList = vi
      .spyOn(DAO.giftcards, "getAdminList")
      .mockResolvedValue({ rows: [row], count: 1, pages: 1 });
    const filter = {
      statuses: ["failed" as const, "paid" as const],
      deliveries: ["sms" as const],
      products: ["malaria"],
      search: "mia",
    };
    const result = await admin().list({
      page: 1,
      limit: 25,
      sort: { id: "sendAt", desc: false },
      filter,
    });
    expect(getList.mock.calls[0][0]).toStrictEqual({
      filter,
      sort: { id: "sendAt", desc: false },
      page: 1,
      limit: 25,
    });
    const listed = result.rows[0];
    expect(listed.recipientPhone).toBe("+4791****67");
    expect(listed).not.toHaveProperty("message");
    expect(listed).not.toHaveProperty("code");
    expect(listed.hasMessage).toBe(true);
    expect(listed.sendAt).toBe("2026-12-24T15:00:00.000Z");
    expect(listed.created).toBe("2026-12-01T09:58:00.000Z");

    await admin().list({ page: 0, limit: 10 });
    expect(getList.mock.calls[1][0].sort).toStrictEqual({ id: "created", desc: true });
    expect(getList.mock.calls[1][0].filter).toStrictEqual({});
  });

  it("gets one gift card with the SMS text, the recipient page and the donations", async () => {
    vi.spyOn(DAO.giftcards, "getAdminByID").mockResolvedValue(row);
    vi.spyOn(DAO.giftcards, "getProductBySlug").mockResolvedValue(product);
    vi.spyOn(DAO.donations, "getAllByKID").mockResolvedValue([
      {
        id: 99,
        sum: "200.00",
        timestamp: new Date("2026-12-01T10:00:00Z"),
        paymentMethod: "Vipps",
      } as any,
    ]);
    const giftcard = await admin().get({ id: 3 });
    expect(giftcard.recipientPhone).toBe("+4791234567");
    expect(giftcard.message).toBe("God jul!");
    expect(giftcard.recipientUrl).toMatch(/\/gave\/kxbmtrwpzd$/);
    expect(giftcard.recipientUrl).toMatch(/^https?:\/\//);
    expect(giftcard.smsText).toContain("Kjære Mia!\n\nGod jul!\n\nKari: 2 barn.");
    expect(giftcard.smsText).toContain("/gave/kxbmtrwpzd");
    expect(giftcard.unit).toBe("barn");
    expect(giftcard.donations).toStrictEqual([
      { id: 99, sum: "200.00", date: "2026-12-01T10:00:00.000Z", method: "Vipps" },
    ]);
  });

  it("has no SMS text for a PDF gift card, and NOT_FOUND for an unknown id", async () => {
    vi.spyOn(DAO.giftcards, "getAdminByID")
      .mockResolvedValueOnce({ ...row, delivery: "pdf", recipientPhone: null, sendAt: null })
      .mockResolvedValueOnce(null);
    vi.spyOn(DAO.giftcards, "getProductBySlug").mockResolvedValue(product);
    vi.spyOn(DAO.donations, "getAllByKID").mockResolvedValue([]);
    expect((await admin().get({ id: 3 })).smsText).toBeNull();
    await expectTrpcError(admin().get({ id: 4 }), "NOT_FOUND");
  });

  it("retries a failed SMS; anything else is a conflict naming its status", async () => {
    const retry = vi.spyOn(DAO.giftcards, "retrySending").mockResolvedValueOnce(true);
    expect(await admin().retry({ id: 3 })).toStrictEqual({ id: 3 });
    expect(retry).toHaveBeenCalledWith(3);

    retry.mockResolvedValue(false);
    const getByID = vi.spyOn(DAO.giftcards, "getByID").mockResolvedValueOnce(stored());
    await expectTrpcError(
      admin().retry({ id: 3 }),
      "CONFLICT",
      "Only failed SMS gift cards can be retried; this one is sent.",
    );
    getByID.mockResolvedValueOnce(null);
    await expectTrpcError(admin().retry({ id: 3 }), "NOT_FOUND");
  });

  it("reschedules to a time in the future within a year", async () => {
    vi.useFakeTimers({ now: new Date("2026-12-01T12:00:00Z") });
    const reschedule = vi.spyOn(DAO.giftcards, "reschedule").mockResolvedValue(true);

    expect(await admin().reschedule({ id: 3, sendAt: "2026-12-24T16:00:00+01:00" })).toStrictEqual({
      id: 3,
      sendAt: "2026-12-24T15:00:00.000Z",
    });
    expect(reschedule).toHaveBeenCalledWith(3, new Date("2026-12-24T15:00:00Z"));

    for (const sendAt of ["2026-12-01T11:59:00Z", "2028-01-01T00:00:00Z"]) {
      await expectTrpcError(admin().reschedule({ id: 3, sendAt }), "BAD_REQUEST");
    }
    expect(reschedule).toHaveBeenCalledOnce();

    reschedule.mockResolvedValue(false);
    vi.spyOn(DAO.giftcards, "getByID").mockResolvedValue(stored({ status: "sending" }));
    await expectTrpcError(
      admin().reschedule({ id: 3, sendAt: "2026-12-24T15:00:00Z" }),
      "CONFLICT",
      "Only SMS gift cards not sent yet can be rescheduled; this one is being sent.",
    );
  });

  it("cancels a gift card not sent yet without touching the donation", async () => {
    const cancel = vi.spyOn(DAO.giftcards, "cancel").mockResolvedValueOnce(true);
    const query = vi.spyOn(DAO, "query");
    expect(await admin().cancel({ id: 3 })).toStrictEqual({ id: 3 });
    expect(cancel).toHaveBeenCalledWith(3);
    expect(query).not.toHaveBeenCalled();

    cancel.mockResolvedValue(false);
    vi.spyOn(DAO.giftcards, "getByID").mockResolvedValue(stored({ status: "cancelled" }));
    await expectTrpcError(
      admin().cancel({ id: 3 }),
      "CONFLICT",
      "Only gift cards not sent yet can be cancelled; this one is cancelled.",
    );
  });

  it("summarises counts per status and SMS gift cards waiting to be sent", async () => {
    vi.spyOn(DAO.giftcards, "countByStatus").mockResolvedValue({
      byStatus: { pending: 1, paid: 3, sending: 0, sent: 5, failed: 1, cancelled: 2 },
      waiting: 2,
    });
    expect(await admin().summary()).toStrictEqual({
      pending: 1,
      paid: 3,
      sending: 0,
      sent: 5,
      failed: 1,
      cancelled: 2,
      waiting: 2,
    });
  });
});

describe("DAO giftcards (admin)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("status changes are conditional on the status, so they can't race the sender", async () => {
    const query = vi.spyOn(DAO, "query").mockResolvedValue([{ affectedRows: 1 }, []] as any);
    const at = new Date("2026-12-24T15:00:00Z");

    expect(await DAO.giftcards.retrySending(3)).toBe(true);
    expect(await DAO.giftcards.reschedule(3, at)).toBe(true);
    expect(await DAO.giftcards.cancel(3)).toBe(true);

    const [retrySql, retryParams] = query.mock.calls[0] as [string, unknown[]];
    expect(retrySql).toMatch(
      /SET Status = 'paid', Send_attempts = 0\s+WHERE ID = \? AND Status = 'failed'/,
    );
    expect(retrySql).not.toContain("Last_error");
    expect(retryParams).toStrictEqual([3]);

    const [rescheduleSql, rescheduleParams] = query.mock.calls[1] as [string, unknown[]];
    expect(rescheduleSql).toContain("SET Send_at = ?");
    expect(rescheduleSql).toContain("Delivery = 'sms' AND Status IN (?)");
    expect(rescheduleParams).toStrictEqual([at, 3, ["pending", "paid"]]);

    const [cancelSql, cancelParams] = query.mock.calls[2] as [string, unknown[]];
    expect(cancelSql).toContain("SET Status = 'cancelled' WHERE ID = ? AND Status IN (?)");
    expect(cancelParams).toStrictEqual([3, ["pending", "paid"]]);

    query.mockResolvedValue([{ affectedRows: 0 }, []] as any);
    expect(await DAO.giftcards.cancel(3)).toBe(false);
  });

  it("filters, searches (a KID too) and pages the list in one query", async () => {
    const query = vi
      .spyOn(DAO, "query")
      .mockResolvedValue([[{ ...row, amount: "200.00", total: 41 }], []] as any);
    const result = await DAO.giftcards.getAdminList({
      filter: {
        statuses: ["failed"],
        deliveries: ["sms"],
        products: ["malaria"],
        search: "000007100000013",
      },
      sort: { id: "sendAt", desc: true },
      page: 1,
      limit: 20,
    });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("COUNT(*) OVER () AS total");
    expect(sql).toContain("G.Status IN (?) AND G.Delivery IN (?) AND P.Slug IN (?)");
    expect(sql).toContain("Dn.email LIKE ? OR G.KID = ?");
    expect(sql).toContain("ORDER BY G.Send_at DESC, G.ID DESC");
    expect(sql).toContain("CONVERT_TZ(G.Created, @@session.time_zone, '+00:00') AS created");
    const like = "%000007100000013%";
    expect(params).toStrictEqual([
      ["failed"],
      ["sms"],
      ["malaria"],
      like,
      like,
      like,
      like,
      "000007100000013",
      20,
      20,
    ]);
    expect(result.count).toBe(41);
    expect(result.pages).toBe(3);
    expect(result.rows[0]).not.toHaveProperty("total");
  });

  it("escapes LIKE wildcards and doesn't match a KID for text", async () => {
    const query = vi.spyOn(DAO, "query").mockResolvedValue([[], []] as any);
    await DAO.giftcards.getAdminList({
      filter: { search: "50%_off" },
      sort: { id: "created", desc: true },
      page: 0,
      limit: 20,
    });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain("G.KID = ?");
    expect(params[0]).toBe("%50\\%\\_off%");
  });
});
