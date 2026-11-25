import { TRPCError } from "@trpc/server";
import { DAO } from "../../custom_modules/DAO";
import {
  getGiftcardStatus,
  getGiftForRecipient,
  registerGiftcard,
} from "../../custom_modules/giftcards/service";
import { registrationFor } from "../../custom_modules/registrationToken";
import { sendBankPendingOnce } from "../../custom_modules/bankPendingMail";
import methods from "../../enums/methods";
import { publicProcedure, router } from "../trpc";
import {
  giftcardGiftInput,
  giftcardGiftOutput,
  giftcardProductsOutput,
  giftcardRegisterInput,
  giftcardRegisterOutput,
  giftcardStatusInput,
  giftcardStatusOutput,
} from "../shared/giftcard";

const invalidRegistration = () =>
  new TRPCError({ code: "BAD_REQUEST", message: "Invalid or expired registration" });

/**
 * Gift cards (gavekort) on the website (no login): the products, buying one, and its status for
 * the thank-you page. Buying registers a normal pending donation on the gift card's own KID
 * (custom_modules/giftcards/service.ts); the payment is matched and receipted as any donation.
 */
export const giftcardRouter = router({
  /** Active products: price per unit and limits. Texts and pictures are in Sanity */
  products: publicProcedure.output(giftcardProductsOutput).query(async () => {
    const products = await DAO.giftcards.getActiveProducts();
    return products.map((p) => ({
      slug: p.slug,
      name: p.name,
      organizationId: p.organizationId,
      unitPrice: p.unitPrice,
      unitSingular: p.unitSingular,
      unitPlural: p.unitPlural,
      minUnits: p.minUnits,
      maxUnits: p.maxUnits,
    }));
  }),

  /** Registers the purchase; for Vipps, paymentProviderUrl is where to send the buyer */
  register: publicProcedure
    .input(giftcardRegisterInput)
    .output(giftcardRegisterOutput)
    .mutation(async ({ input }) => {
      const result = await registerGiftcard(input);
      if (!result.ok) throw new TRPCError({ code: "BAD_REQUEST", message: result.message });
      return result.content;
    }),

  /** Emails the bank payment details for a bank purchase just registered (as the widget does) */
  registerBankPending: publicProcedure.input(giftcardStatusInput).mutation(async ({ input }) => {
    const registration = registrationFor(input.registrationToken, input.KID, [methods.BANK]);
    if (!registration) throw invalidRegistration();
    return await sendBankPendingOnce(input.KID, registration.amount);
  }),

  /** The gift card registered by this browser (registrationToken), for the thank-you page */
  status: publicProcedure
    .input(giftcardStatusInput)
    .output(giftcardStatusOutput)
    .query(async ({ input }) => {
      const registration = registrationFor(input.registrationToken, input.KID, [
        methods.BANK,
        methods.VIPPS,
      ]);
      if (!registration) throw invalidRegistration();
      const status = await getGiftcardStatus(input.KID);
      if (!status) throw new TRPCError({ code: "NOT_FOUND", message: "No gift card" });
      return status;
    }),

  /**
   * The gift card behind a recipient's link (gieffektivt.no/gave/<code>), for that page. The code
   * is the only key (about 42 random bits); unpaid, cancelled, expired and unknown codes are all
   * NOT_FOUND. Called by the website's server, never cached by it.
   */
  gift: publicProcedure
    .input(giftcardGiftInput)
    .output(giftcardGiftOutput)
    .query(async ({ input }) => {
      const gift = await getGiftForRecipient(input.code);
      if (!gift) throw new TRPCError({ code: "NOT_FOUND", message: "No gift card" });
      return gift;
    }),
});
