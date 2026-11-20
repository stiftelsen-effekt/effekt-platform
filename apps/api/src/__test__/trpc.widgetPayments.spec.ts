import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import express, { type Request, type Response } from "express";
import request from "supertest";
import { DAO } from "../custom_modules/DAO";
import { mountTrpc, publicMutations } from "../trpc/express";
import { appRouter } from "../trpc/router";
import { createCallerFactory } from "../trpc/trpc";
import { donationHelpers } from "../custom_modules/donationHelpers";
import * as mail from "../custom_modules/mail";
import methods from "../enums/methods";
import {
  createRegistrationToken,
  REGISTRATION_TOKEN_TTL_MS,
} from "../custom_modules/registrationToken";
import { resetBankPendingMail } from "../custom_modules/bankPendingMail";

const vipps = require("../custom_modules/vipps");

const createCaller = createCallerFactory(appRouter);
const anonymous = () =>
  createCaller({ req: {} as Request, res: {} as Response, auth: undefined }).widget;

const expectTrpcError = async (promise: Promise<unknown>, code: string, message?: string) => {
  try {
    await promise;
    expect.unreachable(`expected ${code}`);
  } catch (err: any) {
    expect(err.code).toBe(code);
    if (message) expect(err.message).toBe(message);
  }
};

/** An app with the REST routers the widget used before, for parity checks */
const restApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/vipps", require("../routes/vipps"));
  app.use("/avtalegiro", require("../routes/avtalegiro"));
  return app;
};

const KID = "000123450012";

const tokenFor = (kid: string, method: number, amount = 300) =>
  createRegistrationToken({ kid, method, donorId: 42, amount });
const vippsToken = tokenFor(KID, methods.VIPPS);
const avtaleGiroToken = tokenFor(KID, methods.AVTALEGIRO);
const expiredToken = (method: number) =>
  createRegistrationToken(
    { kid: KID, method, donorId: 42, amount: 300 },
    Date.now() - REGISTRATION_TOKEN_TTL_MS - 1,
  );

/** Tokens that must not unlock a call for KID with the given method */
const wrongTokens = (method: number): Array<[string, string]> => [
  ["no token", ""],
  ["a token for another KID", tokenFor("999999990012", method)],
  [
    "a token for another method",
    tokenFor(KID, method === methods.BANK ? methods.VIPPS : methods.BANK),
  ],
  ["an expired token", expiredToken(method)],
  ["a forged token", `v1.${Buffer.from(JSON.stringify({ kid: KID })).toString("base64url")}.x`],
];

/** What the widget gets back from Vipps' draft call (vipps.draftAgreement) */
const vippsDraft = {
  agreementId: "agr_123",
  vippsConfirmationUrl: "https://api.vipps.no/v2/register/U6JUjQXq8HQmmV",
  chargeId: "chr_1",
  agreementUrlCode: "secretcode",
};

/** [what, input] pairs that must be refused before anything is called */
const vippsAttacks: Array<[string, unknown]> = [
  ["a numeric KID", { KID: 123, amount: 300, initialCharge: true, monthlyChargeDay: 5 }],
  ["a KID with letters", { KID: "12a", amount: 300, initialCharge: true, monthlyChargeDay: 5 }],
  [
    "a 33 digit KID",
    { KID: "1".repeat(33), amount: 300, initialCharge: true, monthlyChargeDay: 5 },
  ],
  ["a KID object", { KID: { $ne: "" }, amount: 300, initialCharge: true, monthlyChargeDay: 5 }],
  ["a string amount", { KID, amount: "300", initialCharge: true, monthlyChargeDay: 5 }],
  ["a negative amount", { KID, amount: -300, initialCharge: true, monthlyChargeDay: 5 }],
  ["a zero amount", { KID, amount: 0, initialCharge: true, monthlyChargeDay: 5 }],
  ["an infinite amount", { KID, amount: Infinity, initialCharge: true, monthlyChargeDay: 5 }],
  ["a huge amount", { KID, amount: 1e300, initialCharge: true, monthlyChargeDay: 5 }],
  [
    "an amount in fractions of øre",
    { KID, amount: 1.005, initialCharge: true, monthlyChargeDay: 5 },
  ],
  ["a string initialCharge", { KID, amount: 300, initialCharge: "true", monthlyChargeDay: 5 }],
  ["a fractional charge day", { KID, amount: 300, initialCharge: true, monthlyChargeDay: 5.5 }],
  ["a charge day of 32", { KID, amount: 300, initialCharge: true, monthlyChargeDay: 32 }],
  ["a negative charge day", { KID, amount: 300, initialCharge: true, monthlyChargeDay: -1 }],
  ["a missing charge day", { KID, amount: 300, initialCharge: true }],
  ["an extra field", { KID, amount: 300, initialCharge: true, monthlyChargeDay: 5, donorId: 1 }],
  ["no body", undefined],
];

const avtaleGiroAttacks: Array<[string, unknown]> = [
  ["a numeric KID", { KID: 123, amount: 300, dueDay: 5 }],
  ["a KID with letters", { KID: "12a", amount: 300, dueDay: 5 }],
  ["a string amount", { KID, amount: "300", dueDay: 5 }],
  ["a negative amount", { KID, amount: -1, dueDay: 5 }],
  ["a zero amount", { KID, amount: 0, dueDay: 5 }],
  ["a huge amount", { KID, amount: 1e9, dueDay: 5 }],
  ["an amount in fractions of øre", { KID, amount: 300.001, dueDay: 5 }],
  ["an infinite amount", { KID, amount: Infinity, dueDay: 5 }],
  ["a due day of 29", { KID, amount: 300, dueDay: 29 }],
  ["a fractional due day", { KID, amount: 300, dueDay: 1.5 }],
  ["a string due day", { KID, amount: 300, dueDay: "5" }],
  ["an extra field", { KID, amount: 300, dueDay: 5, active: 1 }],
];

describe("tRPC widget payment procedures", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("draftVippsAgreement", () => {
    let draftAgreement: MockInstance;

    beforeEach(() => {
      draftAgreement = vi.spyOn(vipps, "draftAgreement").mockResolvedValue({ ...vippsDraft });
    });

    for (const [what, input] of vippsAttacks) {
      it(`refuses ${what} without calling Vipps`, async () => {
        const withToken =
          input && typeof input === "object" && !("donorId" in input)
            ? { ...input, registrationToken: vippsToken }
            : input;
        await expectTrpcError(anonymous().draftVippsAgreement(withToken as any), "BAD_REQUEST");
        expect(draftAgreement).not.toHaveBeenCalled();
      });
    }

    for (const [what, registrationToken] of wrongTokens(methods.VIPPS)) {
      it(`refuses ${what} without calling Vipps`, async () => {
        await expectTrpcError(
          anonymous().draftVippsAgreement({
            KID,
            amount: 300,
            initialCharge: true,
            monthlyChargeDay: 5,
            registrationToken,
          }),
          "BAD_REQUEST",
        );
        expect(draftAgreement).not.toHaveBeenCalled();
      });
    }

    it("drafts the agreement and returns only the confirmation URL", async () => {
      const result = await anonymous().draftVippsAgreement({
        KID,
        amount: 300,
        initialCharge: true,
        monthlyChargeDay: 5,
        registrationToken: vippsToken,
      });
      expect(result).toStrictEqual({ vippsConfirmationUrl: vippsDraft.vippsConfirmationUrl });
      expect(draftAgreement.mock.calls[0]).toStrictEqual([KID, 300, true, 5]);
    });

    it("caps the charge day at 28, like REST", async () => {
      await anonymous().draftVippsAgreement({
        KID,
        amount: 300,
        initialCharge: false,
        monthlyChargeDay: 31,
        registrationToken: vippsToken,
      });
      expect(draftAgreement.mock.calls[0]).toStrictEqual([KID, 300, false, 28]);
    });

    it("has no unauthenticated REST route any more", async () => {
      const body = { KID, amount: 450, initialCharge: true, monthlyChargeDay: 30 };
      await request(restApp()).post("/vipps/agreement/draft").send(body).expect(404);
      expect(draftAgreement).not.toHaveBeenCalled();
    });

    it("fails when Vipps or the database refused the draft (REST answers 200 with false)", async () => {
      draftAgreement.mockResolvedValue(false);
      await expectTrpcError(
        anonymous().draftVippsAgreement({
          KID,
          amount: 300,
          initialCharge: true,
          monthlyChargeDay: 5,
          registrationToken: vippsToken,
        }),
        "INTERNAL_SERVER_ERROR",
        "Could not draft the Vipps agreement",
      );
    });
  });

  describe("draftAvtaleGiro", () => {
    let getDraftState: MockInstance;
    let addDraftIfNone: MockInstance;
    let updateDraft: MockInstance;
    let add: MockInstance;
    let setActive: MockInstance;

    beforeEach(() => {
      getDraftState = vi
        .spyOn(DAO.avtalegiroagreements, "getDraftState")
        .mockResolvedValue({ rows: 0, draft: false });
      addDraftIfNone = vi.spyOn(DAO.avtalegiroagreements, "addDraftIfNone").mockResolvedValue(true);
      updateDraft = vi.spyOn(DAO.avtalegiroagreements, "updateDraft").mockResolvedValue(true);
      add = vi.spyOn(DAO.avtalegiroagreements, "add").mockResolvedValue(undefined);
      setActive = vi
        .spyOn(DAO.avtalegiroagreements, "setActive")
        .mockResolvedValue(undefined as any);
    });

    const noWrites = () => {
      expect(addDraftIfNone).not.toHaveBeenCalled();
      expect(updateDraft).not.toHaveBeenCalled();
      expect(add).not.toHaveBeenCalled();
      expect(setActive).not.toHaveBeenCalled();
    };

    for (const [what, input] of avtaleGiroAttacks) {
      it(`refuses ${what} without touching the database`, async () => {
        await expectTrpcError(
          anonymous().draftAvtaleGiro({ ...(input as any), registrationToken: avtaleGiroToken }),
          "BAD_REQUEST",
        );
        expect(getDraftState).not.toHaveBeenCalled();
        noWrites();
      });
    }

    for (const [what, registrationToken] of wrongTokens(methods.AVTALEGIRO)) {
      it(`refuses ${what} without touching the database`, async () => {
        await expectTrpcError(
          anonymous().draftAvtaleGiro({ KID, amount: 300, dueDay: 5, registrationToken }),
          "BAD_REQUEST",
        );
        expect(getDraftState).not.toHaveBeenCalled();
        noWrites();
      });
    }

    it("drafts the agreement in øre, with notice", async () => {
      expect(
        await anonymous().draftAvtaleGiro({
          KID,
          amount: 300,
          dueDay: 20,
          registrationToken: avtaleGiroToken,
        }),
      ).toBe(true);
      expect(addDraftIfNone.mock.calls[0]).toStrictEqual([KID, 30000, 20]);
    });

    it("stores whole øre", async () => {
      await anonymous().draftAvtaleGiro({
        KID,
        amount: 125.55,
        dueDay: 20,
        registrationToken: avtaleGiroToken,
      });
      expect(addDraftIfNone.mock.calls[0]).toStrictEqual([KID, 12555, 20]);
    });

    it("uses the last day of the month without a due day", async () => {
      await anonymous().draftAvtaleGiro({ KID, amount: 300, registrationToken: avtaleGiroToken });
      expect(addDraftIfNone.mock.calls[0]).toStrictEqual([KID, 30000, 0]);
    });

    it("refuses a KID that has an active or ended agreement, without writing", async () => {
      for (const state of [
        { rows: 1, draft: false },
        { rows: 2, draft: false },
      ]) {
        getDraftState.mockResolvedValue(state);
        await expectTrpcError(
          anonymous().draftAvtaleGiro({ KID, amount: 300, registrationToken: avtaleGiroToken }),
          "BAD_REQUEST",
          "Invalid or expired registration",
        );
      }
      noWrites();
    });

    it("updates its own draft when the widget sends it again, never adding a second row", async () => {
      getDraftState.mockResolvedValue({ rows: 1, draft: true });
      const input = { KID, amount: 300, dueDay: 15, registrationToken: avtaleGiroToken };
      expect(await anonymous().draftAvtaleGiro(input)).toBe(true);
      expect(await anonymous().draftAvtaleGiro({ ...input, dueDay: 20 })).toBe(true);
      expect(updateDraft.getCalls().map((c) => c.args)).toStrictEqual([
        [KID, 30000, 15],
        [KID, 30000, 20],
      ]);
      expect(addDraftIfNone).not.toHaveBeenCalled();
      expect(add).not.toHaveBeenCalled();
    });

    it("treats losing a race with the same draft (a double click) as success", async () => {
      addDraftIfNone.mockResolvedValue(false);
      getDraftState.mockResolvedValueOnce({ rows: 1, draft: true });
      expect(
        await anonymous().draftAvtaleGiro({ KID, amount: 300, registrationToken: avtaleGiroToken }),
      ).toBe(true);
      expect(addDraftIfNone).toHaveBeenCalledOnce();
    });

    it("treats a lock conflict with a concurrent draft as success", async () => {
      addDraftIfNone.mockRejectedValue(
        Object.assign(new Error("Deadlock"), { code: "ER_LOCK_DEADLOCK" }),
      );
      getDraftState.mockResolvedValueOnce({ rows: 1, draft: true });
      expect(
        await anonymous().draftAvtaleGiro({ KID, amount: 300, registrationToken: avtaleGiroToken }),
      ).toBe(true);
    });

    it("has no unauthenticated REST route any more", async () => {
      await request(restApp())
        .post("/avtalegiro/draft")
        .send({ KID, amount: 300, dueDay: 20 })
        .expect(404);
      noWrites();
    });
  });

  describe("the widget flow: register, then draft or email", () => {
    beforeEach(() => {
      vi.spyOn(DAO.donors, "getIDbyEmail").mockResolvedValue(null);
      vi.spyOn(DAO.donors, "add").mockResolvedValue(42);
      vi.spyOn(DAO.distributions, "getStandardDistributionByCauseAreaID").mockResolvedValue([]);
      vi.spyOn(DAO.distributions, "getKIDbySplit").mockResolvedValue(null);
      vi.spyOn(DAO.distributions, "add").mockResolvedValue(undefined as any);
      vi.spyOn(DAO.initialpaymentmethod, "addPaymentIntent").mockResolvedValue(undefined);
      vi.spyOn(DAO.donationReferralCodes, "add").mockResolvedValue(undefined);
      vi.spyOn(donationHelpers, "createKID").mockResolvedValue("12345678");
      vi.spyOn(donationHelpers, "createAvtaleGiroKID").mockResolvedValue(KID);
    });

    afterEach(() => resetBankPendingMail());

    const register = (method: number, amount = 300) =>
      anonymous().registerDonation({
        distributionCauseAreas: [
          {
            id: 1,
            standardSplit: false,
            percentageShare: "100",
            organizations: [{ id: 1, percentageShare: "100" }],
          },
        ],
        donor: { email: "donor@example.com", name: "Dina Donor", newsletter: false, ssn: "" },
        method,
        amount,
        recurring: method === methods.BANK ? 0 : 1,
      });

    it("drafts the AvtaleGiro agreement for the KID it registered", async () => {
      vi.spyOn(DAO.avtalegiroagreements, "getDraftState").mockResolvedValue({
        rows: 0,
        draft: false,
      });
      const addDraftIfNone = vi
        .spyOn(DAO.avtalegiroagreements, "addDraftIfNone")
        .mockResolvedValue(true);

      const registered = await register(methods.AVTALEGIRO);
      expect(registered.KID).toBe(KID);
      await anonymous().draftAvtaleGiro({
        KID: registered.KID!,
        amount: 300,
        dueDay: 20,
        registrationToken: registered.registrationToken!,
      });
      expect(addDraftIfNone).toHaveBeenCalledExactlyOnceWith(KID, 30000, 20);

      // The same token is no good for any other KID
      await expectTrpcError(
        anonymous().draftAvtaleGiro({
          KID: "999999990012",
          amount: 300,
          registrationToken: registered.registrationToken!,
        }),
        "BAD_REQUEST",
      );
      expect(addDraftIfNone).toHaveBeenCalledOnce();
    });

    it("emails the bank details for the KID it registered", async () => {
      const send = vi.spyOn(mail, "sendDonationRegistered").mockResolvedValue(true);
      const registered = await register(methods.BANK, 350);
      await anonymous().registerBankPending({
        KID: registered.KID!,
        sum: 350,
        registrationToken: registered.registrationToken!,
      });
      expect(send).toHaveBeenCalledExactlyOnceWith("12345678", 350);
    });

    it("drafts the Vipps agreement for the KID it registered", async () => {
      const draftAgreement = vi.spyOn(vipps, "draftAgreement").mockResolvedValue({ ...vippsDraft });
      const registered = await register(methods.VIPPS);
      await anonymous().draftVippsAgreement({
        KID: registered.KID!,
        amount: 300,
        initialCharge: true,
        monthlyChargeDay: 5,
        registrationToken: registered.registrationToken!,
      });
      expect(draftAgreement).toHaveBeenCalledExactlyOnceWith("12345678", 300, true, 5);
    });
  });

  describe("over HTTP", () => {
    let app: express.Express;

    beforeEach(() => {
      app = express();
      mountTrpc(app);
    });

    it("counts every widget mutation as one that may not be batched", () => {
      expect([...publicMutations].sort()).toStrictEqual([
        "widget.draftAvtaleGiro",
        "widget.draftVippsAgreement",
        "widget.registerBankPending",
        "widget.registerDonation",
        "widget.submitReferral",
      ]);
    });

    it("refuses the drafts in a batch", async () => {
      const draftAgreement = vi.spyOn(vipps, "draftAgreement").mockResolvedValue({ ...vippsDraft });
      const add = vi.spyOn(DAO.avtalegiroagreements, "addDraftIfNone").mockResolvedValue(true);
      const vippsInput = {
        KID,
        amount: 300,
        initialCharge: true,
        monthlyChargeDay: 5,
        registrationToken: vippsToken,
      };
      await request(app)
        .post("/trpc/widget.draftVippsAgreement,widget.draftVippsAgreement?batch=1")
        .send({ 0: vippsInput, 1: vippsInput })
        .expect(400);
      await request(app)
        .post("/trpc/widget.draftAvtaleGiro%2Cwidget.draftAvtaleGiro?batch=1")
        .send({
          0: { KID, amount: 1, registrationToken: avtaleGiroToken },
          1: { KID, amount: 1, registrationToken: avtaleGiroToken },
        })
        .expect(400);
      expect(draftAgreement).not.toHaveBeenCalled();
      expect(add).not.toHaveBeenCalled();

      const res = await request(app)
        .post("/trpc/widget.draftVippsAgreement")
        .send(vippsInput)
        .expect(200);
      expect(res.body.result.data).toStrictEqual({
        vippsConfirmationUrl: vippsDraft.vippsConfirmationUrl,
      });
    });

    it("answers 400 to an invalid draft without calling Vipps", async () => {
      const draftAgreement = vi.spyOn(vipps, "draftAgreement").mockResolvedValue({ ...vippsDraft });
      await request(app)
        .post("/trpc/widget.draftVippsAgreement")
        .send({ KID: "1; DROP TABLE", amount: 1, initialCharge: true, monthlyChargeDay: 1 })
        .expect(400);
      expect(draftAgreement).not.toHaveBeenCalled();
    });
  });
});
