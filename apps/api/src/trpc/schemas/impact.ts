import { z } from "zod";
import { idSchema } from "./common";

/**
 * Inputs of the admin's impact router (docs/impact-api-migration.md, phase 4). The public
 * procedures' schemas (site.impactCosts, Min Side) live in ../shared/impact.ts.
 */

export const impactFundSchema = z.enum(["TCF", "AGF"]);

export const impactEstimatesListInput = z
  .strictObject({
    charityIds: z.array(idSchema).max(100).optional(),
    interventionIds: z.array(idSchema).max(100).optional(),
    /** Estimates that applied to some month of this year */
    year: z.number().int().min(2000).max(2100).optional(),
  })
  .default({});

export const impactCharityInput = z.strictObject({ charityId: idSchema });

export const impactGrantsListInput = z
  .strictObject({ fund: impactFundSchema.optional() })
  .default({});

export const impactByIdInput = z.strictObject({ id: idSchema });
