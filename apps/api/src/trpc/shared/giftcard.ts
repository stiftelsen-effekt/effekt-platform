import { z } from "zod";

/**
 * Schemas for the public gift card procedures (giftcard.*), shared with apps/web through
 * `@effekt/api/giftcard`. This file may only import zod.
 */

/** The longest personal greeting, in characters as people count them (code points) */
export const GIFTCARD_MESSAGE_MAX = 300;
export const GIFTCARD_NAME_MAX = 100;

/** Payment methods a gift card can be bought with (enums/paymentMethods: bank 2, vipps 6) */
export const GIFTCARD_METHODS = { BANK: 2, VIPPS: 6 } as const;

export const giftcardMessageLength = (message: string) => Array.from(message).length;

const name = z.string().trim().min(1).max(GIFTCARD_NAME_MAX);

export const giftcardProductOutput = z.object({
  slug: z.string(),
  name: z.string(),
  organizationId: z.number().int(),
  unitPrice: z.number(),
  unitSingular: z.string(),
  unitPlural: z.string(),
  minUnits: z.number().int(),
  maxUnits: z.number().int(),
});

export const giftcardProductsOutput = z.array(giftcardProductOutput);

export const giftcardRegisterInput = z
  .object({
    product: z.string().regex(/^[a-z0-9-]{1,64}$/, "Invalid product"),
    units: z.number().int().positive().max(100_000),
    delivery: z.enum(["sms", "pdf"]),
    recipientName: name,
    senderName: name,
    message: z
      .string()
      .trim()
      .max(GIFTCARD_MESSAGE_MAX * 4)
      .refine((m) => giftcardMessageLength(m) <= GIFTCARD_MESSAGE_MAX, "Message is too long")
      .nullish(),
    /** Norwegian mobile number, for delivery sms */
    recipientPhone: z.string().max(32).nullish(),
    /** When the SMS goes out (ISO 8601 with offset), for delivery sms */
    sendAt: z.iso.datetime({ offset: true }).nullish(),
    donor: z.object({
      email: z.email().max(320),
      name: z.string().trim().max(255).nullish(),
      ssn: z.string().trim().max(32).nullish(),
      newsletter: z.boolean().nullish(),
    }),
    method: z.union([z.literal(GIFTCARD_METHODS.BANK), z.literal(GIFTCARD_METHODS.VIPPS)]),
    referralCode: z.string().max(200).nullish(),
  })
  .superRefine((input, ctx) => {
    if (input.delivery === "sms") {
      if (!input.recipientPhone) {
        ctx.addIssue({ code: "custom", path: ["recipientPhone"], message: "Phone is required" });
      }
      if (!input.sendAt) {
        ctx.addIssue({ code: "custom", path: ["sendAt"], message: "Send time is required" });
      }
    }
  });

export type GiftcardRegisterInput = z.infer<typeof giftcardRegisterInput>;

export const giftcardRegisterOutput = z.object({
  KID: z.string(),
  amount: z.number(),
  registrationToken: z.string().nullable(),
  paymentProviderUrl: z.string(),
});

export const giftcardStatusInput = z.object({
  KID: z.string().max(32),
  registrationToken: z.string().max(2048),
});

export const giftcardStatusOutput = z.object({
  product: z.string(),
  units: z.number().int(),
  amount: z.number(),
  delivery: z.enum(["sms", "pdf"]),
  recipientName: z.string(),
  sendAt: z.string().nullable(),
  /** pending until the payment is received */
  status: z.enum(["pending", "paid", "sending", "sent", "failed", "cancelled"]),
});

/** The code in the recipient's link, gieffektivt.no/gave/<code> */
export const giftcardGiftInput = z.object({ code: z.string().max(32) });

export const giftcardGiftOutput = z.object({
  product: z.string(),
  units: z.number().int(),
  unitSingular: z.string(),
  unitPlural: z.string(),
  recipientName: z.string(),
  senderName: z.string(),
  message: z.string().nullable(),
  givenAt: z.string(),
});

export type GiftcardGift = z.infer<typeof giftcardGiftOutput>;
