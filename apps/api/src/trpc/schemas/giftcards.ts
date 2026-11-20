import { z } from "zod";
import {
  giftcardDeliveries,
  giftcardSortColumns,
  giftcardStatuses,
} from "../../custom_modules/DAO_modules/giftcards";
import { idSchema, paginationFields, sortSchema } from "./common";

export const giftcardsFilter = z.strictObject({
  statuses: z.array(z.enum(giftcardStatuses)).min(1).optional(),
  deliveries: z.array(z.enum(giftcardDeliveries)).min(1).optional(),
  /** Product slugs */
  products: z.array(z.string().trim().min(1).max(64)).min(1).max(50).optional(),
  /** Recipient, sender or buyer name, buyer email; all digits also matches a KID */
  search: z.string().trim().min(1).max(255).optional(),
});

export const giftcardsListInput = z.strictObject({
  ...paginationFields,
  sort: sortSchema(giftcardSortColumns).optional(),
  filter: giftcardsFilter.optional(),
});

export const giftcardIdInput = z.strictObject({ id: idSchema });

export const giftcardRescheduleInput = z.strictObject({
  id: idSchema,
  /** The new send time, an instant with offset */
  sendAt: z.iso.datetime({ offset: true }),
});
