import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import type { Request, Response } from "express";
import { DAO } from "../custom_modules/DAO";
import type { ReviewQueueItemWithRaw } from "../custom_modules/DAO_modules/reviewqueue";
import * as donationsService from "../custom_modules/donationsService";
import { appRouter } from "../trpc/router";
import { createCallerFactory } from "../trpc/trpc";

const createCaller = createCallerFactory(appRouter);

const callerWith = (auth?: Record<string, unknown>) =>
  createCaller({ req: {} as Request, res: {} as Response, auth: auth as any });

const admin = (claims: Record<string, unknown> = { sub: "auth0|admin" }) =>
  callerWith({ permissions: ["admin"], ...claims }).reports.reviewQueue;

const expectTrpcError = async (promise: Promise<unknown>, code: string, message?: RegExp) => {
  try {
    await promise;
    expect.unreachable(`expected ${code}`);
  } catch (err: any) {
    expect(err.code).toBe(code);
    if (message) expect(err.message).toMatch(message);
  }
};

const item = (overrides: Partial<ReviewQueueItemWithRaw> = {}): ReviewQueueItemWithRaw => ({
  id: 5,
  source: "vipps",
  reason: "Could not find valid KID or matching parsing rule",
  KID: null,
  amount: "250.00",
  date: new Date("2026-10-01T10:00:00.000Z"),
  externalId: "vipps.123",
  paymentId: 4,
  message: "gave",
  name: "Ola",
  location: "Gi Effektivt.",
  importLogId: null,
  metaOwnerId: null,
  status: "open",
  resolvedBy: null,
  resolvedAt: null,
  note: null,
  donationId: null,
  created: new Date("2026-10-02T00:00:00.000Z"),
  raw: { transactionID: "vipps.123" },
  ...overrides,
});

describe("tRPC reports.reviewQueue", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("auth and validation", () => {
    it("rejects anonymous and non-admin callers", async () => {
      const counts = vi.spyOn(DAO.reviewqueue, "getCounts").mockReturnValue(undefined as any);
      await expectTrpcError(callerWith().reports.reviewQueue.counts(), "UNAUTHORIZED");
      await expectTrpcError(
        callerWith({ permissions: ["read:profile"] }).reports.reviewQueue.counts(),
        "FORBIDDEN",
      );
      expect(counts).not.toHaveBeenCalled();
    });

    it("rejects invalid input", async () => {
      const list = vi.spyOn(DAO.reviewqueue, "getList").mockReturnValue(undefined as any);
      await expectTrpcError(
        admin().list({ page: 0, limit: 10, filter: { statuses: ["done" as any] } }),
        "BAD_REQUEST",
      );
      await expectTrpcError(
        admin().list({ page: 0, limit: 10, sort: { id: "Reason" as any, desc: true } }),
        "BAD_REQUEST",
      );
      await expectTrpcError(
        admin().list({ page: 0, limit: 10, filter: { sources: [] } }),
        "BAD_REQUEST",
      );
      expect(list).not.toHaveBeenCalled();
      await expectTrpcError(
        admin().register({ id: 5, metaOwnerId: 3, sendReceipt: false } as any),
        "BAD_REQUEST",
        /either a KID or a distribution/,
      );
      await expectTrpcError(admin().ignore({ id: 5, note: "  " }), "BAD_REQUEST");
    });
  });

  describe("list, get and counts", () => {
    it("lists with filters, paging and default sort", async () => {
      const result = {
        rows: [item()],
        total: 1,
        pages: 1,
        counts: { open: 1, registered: 0, ignored: 0 },
      };
      const list = vi.spyOn(DAO.reviewqueue, "getList").mockResolvedValue(result);

      expect(
        await admin().list({
          page: 2,
          limit: 25,
          filter: { statuses: ["open"], sources: ["ocr"] },
        }),
      ).toStrictEqual(result);
      expect(list.mock.calls[0][0]).toStrictEqual({
        page: 2,
        limit: 25,
        statuses: ["open"],
        sources: ["ocr"],
        sort: { id: "id", desc: true },
      });

      await admin().list({ page: 0, limit: 10, sort: { id: "amount", desc: false } });
      expect(list.mock.calls[1][0]).toEqual(
        expect.objectContaining({
          statuses: undefined,
          sources: undefined,
          sort: { id: "amount", desc: false },
        }),
      );
    });

    it("returns counts per status", async () => {
      vi.spyOn(DAO.reviewqueue, "getCounts").mockResolvedValue({
        open: 3,
        registered: 2,
        ignored: 1,
      });
      expect(await admin().counts()).toStrictEqual({ open: 3, registered: 2, ignored: 1 });
    });

    it("gets an item, NOT_FOUND when missing", async () => {
      const getById = vi.spyOn(DAO.reviewqueue, "getById").mockReturnValue(undefined as any);
      getById.withArgs(5).resolves(item());
      getById.withArgs(6).resolves(null);
      expect(await admin().get({ id: 5 })).toStrictEqual(item());
      await expectTrpcError(admin().get({ id: 6 }), "NOT_FOUND");
    });
  });

  describe("DB-filled times", () => {
    it("reads Created and Resolved_at as UTC and sorts by the column", async () => {
      const query = vi.spyOn(DAO, "query").mockReturnValue(undefined as any);
      query.mockResolvedValueOnce([[], []] as any);
      query.mockResolvedValueOnce([[{ total: 0 }], []] as any);
      query.mockResolvedValueOnce([[], []] as any);
      await DAO.reviewqueue.getList({ page: 0, limit: 10, sort: { id: "created", desc: true } });
      const sql = query.mock.calls[0][0] as string;
      expect(sql).toContain("CONVERT_TZ(Created, @@session.time_zone, '+00:00') AS created");
      expect(sql).toContain("CONVERT_TZ(Resolved_at, @@session.time_zone, '+00:00') AS resolvedAt");
      expect(sql).toContain("ORDER BY Review_queue_items.Created DESC, ID DESC");
    });
  });

  describe("search", () => {
    it("passes the trimmed query and a default limit", async () => {
      const search = vi.spyOn(DAO.reviewqueue, "search").mockResolvedValue([item()]);
      expect(await admin().search({ query: "  Ola " })).toStrictEqual([item()]);
      expect(search.mock.calls[0]).toStrictEqual(["Ola", 10]);
      await admin().search({ query: "123", limit: 5 });
      expect(search.mock.calls[1]).toStrictEqual(["123", 5]);
    });

    it("rejects empty queries and large limits", async () => {
      const search = vi.spyOn(DAO.reviewqueue, "search").mockReturnValue(undefined as any);
      await expectTrpcError(admin().search({ query: "  " }), "BAD_REQUEST");
      await expectTrpcError(admin().search({ query: "a", limit: 51 }), "BAD_REQUEST");
      expect(search).not.toHaveBeenCalled();
    });

    it("matches the id exactly and the text columns with escaped LIKE patterns", async () => {
      const query = vi.spyOn(DAO, "query").mockResolvedValue([[], []] as any);
      await DAO.reviewqueue.search("12", 10);
      expect(query.mock.calls[0][0]).toMatch(
        /WHERE ID = \? OR KID LIKE \? OR External_ID LIKE \? OR Payer_name LIKE \? OR Message LIKE \?/,
      );
      expect(query.mock.calls[0][1]).toStrictEqual([12, "%12%", "%12%", "%12%", "%12%", 12, 10]);

      await DAO.reviewqueue.search("50%_off\\", 3);
      expect(query.mock.calls[1][1]).toStrictEqual([
        null,
        "%50\\%\\_off\\\\%",
        "%50\\%\\_off\\\\%",
        "%50\\%\\_off\\\\%",
        "%50\\%\\_off\\\\%",
        null,
        3,
      ]);
    });
  });

  describe("register", () => {
    let getById: MockInstance;
    let claim: MockInstance;
    let release: MockInstance;
    let setDonation: MockInstance;
    let confirm: MockInstance;

    beforeEach(() => {
      getById = vi.spyOn(DAO.reviewqueue, "getById").mockResolvedValue(item());
      claim = vi.spyOn(DAO.reviewqueue, "claimForRegistration").mockResolvedValue(true);
      release = vi.spyOn(DAO.reviewqueue, "releaseRegistrationClaim").mockResolvedValue(undefined);
      setDonation = vi.spyOn(DAO.reviewqueue, "setDonation").mockResolvedValue(undefined);
      vi.spyOn(DAO.payment, "getMethods").mockResolvedValue([{ id: 4 }, { id: 5 }] as any);
      vi.spyOn(DAO.meta, "getDataOwners").mockResolvedValue([{ id: 3 }] as any);
      vi.spyOn(DAO.donations, "externalRefExists").mockResolvedValue(false);
      confirm = vi.spyOn(donationsService, "confirmDonation").mockResolvedValue(99);
    });

    it("registers a donation from the item's values and marks the item", async () => {
      getById.mockResolvedValueOnce(
        item({ status: "registered", donationId: 99, resolvedBy: "admin@example.org" }),
      );

      const result = await admin({
        sub: "auth0|1",
        "https://example.org/email": "admin@example.org",
      }).register({ id: 5, KID: "12345678", metaOwnerId: 3, sendReceipt: true });

      expect(claim.mock.calls[0]).toStrictEqual([5, "admin@example.org"]);
      expect(confirm.mock.calls[0][0]).toStrictEqual({
        KID: "12345678",
        paymentMethodId: 4,
        sum: 250,
        timestamp: new Date("2026-10-01T10:00:00.000Z"),
        externalRef: "vipps.123",
        metaOwnerId: 3,
        sendReceipt: true,
      });
      expect(setDonation.mock.calls[0]).toStrictEqual([5, 99]);
      expect(release).not.toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({ donationId: 99, KID: "12345678", newDistribution: false }),
      );
      expect(result.item.status).toBe("registered");
    });

    it("uses overrides and the token subject without an email claim", async () => {
      await admin({ sub: "auth0|2" }).register({
        id: 5,
        KID: "12345678",
        sum: 300,
        timestamp: "2026-10-03",
        paymentId: 5,
        paymentExternalRef: null,
        metaOwnerId: 3,
        sendReceipt: false,
      });
      expect(claim.mock.calls[0][1]).toBe("auth0|2");
      expect(confirm.mock.calls[0][0]).to.deep.include({
        paymentMethodId: 5,
        sum: 300,
        externalRef: null,
        timestamp: new Date("2026-10-03"),
      });
    });

    it("defaults the data owner to the item's, then the default owner", async () => {
      vi.spyOn(DAO.meta, "getDefaultOwnerID").mockResolvedValue(1);
      vi.mocked(DAO.meta.getDataOwners).mockResolvedValue([{ id: 1 }, { id: 3 }] as any);

      getById.mockResolvedValue(item({ metaOwnerId: 3 }));
      await admin().register({ id: 5, KID: "12345678", sendReceipt: false });
      expect(confirm.mock.calls[0][0]).to.deep.include({ metaOwnerId: 3 });

      getById.mockResolvedValue(item({ metaOwnerId: null }));
      await admin().register({ id: 5, KID: "12345678", sendReceipt: false });
      expect(confirm.mock.calls[1][0]).to.deep.include({ metaOwnerId: 1 });

      getById.mockResolvedValue(item({ metaOwnerId: 3 }));
      await admin().register({ id: 5, KID: "12345678", metaOwnerId: 1, sendReceipt: false });
      expect(confirm.mock.calls[2][0]).to.deep.include({ metaOwnerId: 1 });
    });

    it("creates a distribution like donations.register", async () => {
      vi.spyOn(DAO.donors, "getByID").mockResolvedValue({ id: 7 } as any);
      vi.spyOn(DAO.organizations, "getByIDs").mockResolvedValue([
        { ID: 1, cause_area_ID: 1 },
      ] as any);
      const create = vi
        .spyOn(donationsService, "createDistribution")
        .mockResolvedValue({ KID: "87654321", newDistribution: true });

      const result = await admin().register({
        id: 5,
        distribution: {
          donorId: 7,
          taxUnitId: null,
          causeAreas: [
            {
              id: 1,
              percentageShare: "100",
              standardSplit: false,
              organizations: [{ id: 1, percentageShare: "100" }],
            },
          ],
        },
        metaOwnerId: 3,
        sendReceipt: false,
      });

      expect(create).toHaveBeenCalledOnce();
      expect(confirm.mock.calls[0][0].KID).toBe("87654321");
      expect(result).toEqual(expect.objectContaining({ KID: "87654321", newDistribution: true }));
    });

    it("rejects already resolved items with CONFLICT", async () => {
      getById.mockResolvedValue(item({ status: "ignored" }));
      await expectTrpcError(
        admin().register({ id: 5, KID: "1", metaOwnerId: 3, sendReceipt: false }),
        "CONFLICT",
        /already ignored/,
      );
      expect(claim).not.toHaveBeenCalled();
      expect(confirm).not.toHaveBeenCalled();
    });

    it("rejects with CONFLICT when another admin claims the item first", async () => {
      claim.mockResolvedValue(false);
      getById.mockResolvedValueOnce(item({ status: "registered" }));
      await expectTrpcError(
        admin().register({ id: 5, KID: "1", metaOwnerId: 3, sendReceipt: false }),
        "CONFLICT",
        /already registered/,
      );
      expect(confirm).not.toHaveBeenCalled();
    });

    it("releases the claim when registering fails", async () => {
      confirm.mockRejectedValue(new Error("NO_KID: KID 1 does not exist"));
      await expectTrpcError(
        admin().register({ id: 5, KID: "1", metaOwnerId: 3, sendReceipt: false }),
        "BAD_REQUEST",
        /NO_KID/,
      );
      expect(release).toHaveBeenCalledExactlyOnceWith(5);
      expect(setDonation).not.toHaveBeenCalled();
    });

    it("releases the claim when the external reference is taken", async () => {
      vi.mocked(DAO.donations.externalRefExists).mockResolvedValue(true);
      await expectTrpcError(
        admin().register({ id: 5, KID: "1", metaOwnerId: 3, sendReceipt: false }),
        "CONFLICT",
        /vipps.123 already exists/,
      );
      expect(release).toHaveBeenCalledExactlyOnceWith(5);
      expect(confirm).not.toHaveBeenCalled();
    });

    it("asks for values the item can't provide", async () => {
      getById.mockResolvedValue(item({ date: null }));
      await expectTrpcError(
        admin().register({ id: 5, KID: "1", metaOwnerId: 3, sendReceipt: false }),
        "BAD_REQUEST",
        /no date/,
      );
      getById.mockResolvedValue(item({ amount: "-10.00" }));
      await expectTrpcError(
        admin().register({ id: 5, KID: "1", metaOwnerId: 3, sendReceipt: false }),
        "BAD_REQUEST",
        /provide a sum/,
      );
      getById.mockResolvedValue(item({ externalId: "x".repeat(40) }));
      await expectTrpcError(
        admin().register({ id: 5, KID: "1", metaOwnerId: 3, sendReceipt: false }),
        "BAD_REQUEST",
        /paymentExternalRef/,
      );
      expect(claim).not.toHaveBeenCalled();
    });

    it("returns NOT_FOUND for unknown items", async () => {
      getById.mockResolvedValue(null);
      await expectTrpcError(
        admin().register({ id: 5, KID: "1", metaOwnerId: 3, sendReceipt: false }),
        "NOT_FOUND",
      );
    });
  });

  describe("ignore and reopen", () => {
    it("ignores an open item with a note", async () => {
      const ignore = vi.spyOn(DAO.reviewqueue, "ignore").mockResolvedValue(true);
      vi.spyOn(DAO.reviewqueue, "getById").mockResolvedValue(
        item({ status: "ignored", note: "test" }),
      );

      const result = await admin({ email: "a@example.org" }).ignore({ id: 5, note: " test " });

      expect(ignore.mock.calls[0]).toStrictEqual([5, "a@example.org", "test"]);
      expect(result.status).toBe("ignored");
    });

    it("ignores without a note", async () => {
      const ignore = vi.spyOn(DAO.reviewqueue, "ignore").mockResolvedValue(true);
      vi.spyOn(DAO.reviewqueue, "getById").mockResolvedValue(item({ status: "ignored" }));
      await admin().ignore({ id: 5 });
      expect(ignore.mock.calls[0]).toStrictEqual([5, "auth0|admin", null]);
    });

    it("rejects ignoring resolved or unknown items", async () => {
      vi.spyOn(DAO.reviewqueue, "ignore").mockResolvedValue(false);
      const getById = vi.spyOn(DAO.reviewqueue, "getById").mockReturnValue(undefined as any);
      getById.withArgs(5).resolves(item({ status: "registered" }));
      getById.withArgs(6).resolves(null);
      await expectTrpcError(admin().ignore({ id: 5 }), "CONFLICT", /already registered/);
      await expectTrpcError(admin().ignore({ id: 6 }), "NOT_FOUND");
    });

    it("reopens an ignored item", async () => {
      const reopen = vi.spyOn(DAO.reviewqueue, "reopen").mockResolvedValue(true);
      vi.spyOn(DAO.reviewqueue, "getById").mockResolvedValue(item());
      expect((await admin().reopen({ id: 5 })).status).toBe("open");
      expect(reopen).toHaveBeenCalledExactlyOnceWith(5);
    });

    it("clears the resolver and the ignore note when reopening", async () => {
      const query = vi.spyOn(DAO, "query").mockResolvedValue([{ affectedRows: 1 }, []] as any);
      expect(await DAO.reviewqueue.reopen(5)).toBe(true);
      expect(query.mock.calls[0][0]).toContain(
        "SET Status = 'open', Resolved_by = NULL, Resolved_at = NULL, Note = NULL",
      );
    });

    it("refuses to reopen open items and items whose donation exists", async () => {
      vi.spyOn(DAO.reviewqueue, "reopen").mockResolvedValue(false);
      const getById = vi.spyOn(DAO.reviewqueue, "getById").mockReturnValue(undefined as any);
      getById.withArgs(5).resolves(item());
      getById.withArgs(6).resolves(item({ id: 6, status: "registered", donationId: 99 }));
      await expectTrpcError(admin().reopen({ id: 5 }), "CONFLICT", /already open/);
      await expectTrpcError(admin().reopen({ id: 6 }), "CONFLICT", /donation 99/);
    });
  });
});
