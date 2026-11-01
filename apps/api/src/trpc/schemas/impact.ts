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

//region Writes

const UINT_MAX = 4_294_967_295;

/** A month as its first day, YYYY-MM-01, from 2000 to two years ahead */
export const impactMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "Give the month's first day, YYYY-MM-01")
  .refine((month) => month >= "2000-01-01", "The month must be 2000 or later")
  .refine(
    (month) => month <= `${new Date().getUTCFullYear() + 2}-12-01`,
    "The month can be at most two years ahead",
  );

const centsSchema = z.number().int().positive("Must be more than 0").max(UINT_MAX);
const boundSchema = z.number().int().min(0).max(UINT_MAX);

const isHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

/** One or more http(s) URLs, one per line (old rows hold several), or empty */
export const impactSourceUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .refine(
    (value) => value === "" || value.split(/\s+/).every(isHttpUrl),
    "Give a full link starting with https://, one per line",
  );

const sourceFields = {
  sourceName: z.string().trim().max(1000),
  sourceUrl: impactSourceUrlSchema,
  comment: z.string().trim().max(5000).default(""),
};

/** lower ≤ value ≤ upper, where a lower bound of 0 and an upper bound of null mean "none" */
const boundsInOrder =
  (value: string, lower: string, upper: string) =>
  (input: Record<string, unknown>, ctx: z.core.$RefinementCtx) => {
    const v = input[value] as number | undefined;
    const lo = input[lower] as number | undefined;
    const hi = input[upper] as number | null | undefined;
    if (v === undefined) return;
    if (lo !== undefined && lo > v)
      ctx.addIssue({
        code: "custom",
        path: [lower],
        message: "The low end can't be above the estimate",
      });
    if (hi !== undefined && hi !== null && hi < v)
      ctx.addIssue({
        code: "custom",
        path: [upper],
        message: "The high end can't be below the estimate",
      });
  };

const estimateFields = {
  interventionId: idSchema,
  validFrom: impactMonthSchema,
  /** USD cents per output */
  centsPerOutput: centsSchema,
  centsPerOutputLowerBound: boundSchema.default(0),
  centsPerOutputUpperBound: boundSchema.nullable().default(null),
  ...sourceFields,
};
const estimateBounds = boundsInOrder(
  "centsPerOutput",
  "centsPerOutputLowerBound",
  "centsPerOutputUpperBound",
);
const sourceRequired = (
  input: { sourceName: string; sourceUrl: string },
  ctx: z.core.$RefinementCtx,
) => {
  if (!input.sourceName)
    ctx.addIssue({ code: "custom", path: ["sourceName"], message: "Name the source" });
  if (!input.sourceUrl)
    ctx.addIssue({ code: "custom", path: ["sourceUrl"], message: "Link to the source" });
};

/** A new estimate for a charity. A new GiveWell number is a new estimate, not an edit. */
export const impactEstimateCreateInput = z
  .strictObject({ charityId: idSchema, ...estimateFields })
  .superRefine(estimateBounds)
  .superRefine(sourceRequired);

/** Corrects an estimate. Its charity can't change (and no ID ever does). */
export const impactEstimateUpdateInput = z
  .strictObject({ id: idSchema, ...estimateFields })
  .superRefine(estimateBounds);

/**
 * What saving would change for donors: the months whose figure changes and the donations in
 * them. `id` for an edit (or with `remove` for a delete); without it, a new estimate.
 */
export const impactEstimatePreviewInput = z.union([
  z.strictObject({
    id: idSchema.optional(),
    charityId: idSchema,
    interventionId: idSchema,
    validFrom: impactMonthSchema,
    centsPerOutput: centsSchema,
  }),
  z.strictObject({ id: idSchema, remove: z.literal(true) }),
]);

const allotmentInput = z
  .strictObject({
    /** An existing allotment of this grant; none for a new one */
    id: idSchema.optional(),
    charityId: idSchema,
    interventionId: idSchema,
    /** USD cents */
    sumInCents: z.number().int().positive("Must be more than 0").max(Number.MAX_SAFE_INTEGER),
    numberOutputsPurchased: centsSchema,
    numberOutputsPurchasedLowerBound: boundSchema.default(0),
    numberOutputsPurchasedUpperBound: boundSchema.nullable().default(null),
    ...sourceFields,
  })
  .superRefine(
    boundsInOrder(
      "numberOutputsPurchased",
      "numberOutputsPurchasedLowerBound",
      "numberOutputsPurchasedUpperBound",
    ),
  );

/**
 * The split is each allotment's sum over the grant's total (custom_modules/impact grantSplit),
 * so the shares always add up to 100 %; what must hold is that every sum and output count is
 * above 0 (a 0 sum would be a 0 % share, 0 outputs an infinite cost per output).
 */
const allotmentsSchema = z
  .array(allotmentInput)
  .min(1, "A grant needs at least one allotment")
  .max(100)
  .superRefine((allotments, ctx) => {
    const ids = allotments.flatMap((a) => (a.id ? [a.id] : []));
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "An allotment is listed twice" });
    const total = allotments.reduce((sum, a) => sum + a.sumInCents, 0);
    if (total > Number.MAX_SAFE_INTEGER)
      ctx.addIssue({ code: "custom", message: "The grant's total is too large" });
  });

export const impactGrantCreateInput = z.strictObject({
  fund: impactFundSchema,
  validFrom: impactMonthSchema,
  allotments: allotmentsSchema,
});

/** Changes a grant's month and allotments. Its fund can't change. */
export const impactGrantUpdateInput = z.strictObject({
  id: idSchema,
  validFrom: impactMonthSchema,
  allotments: allotmentsSchema,
});

const abbreviationSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{1,10}$/, "1–10 letters or digits, like AMF"));

export const impactCharityCreateInput = z.strictObject({
  name: z.string().trim().min(1, "Give a name").max(200),
  abbreviation: abbreviationSchema,
  organizationId: idSchema.nullable(),
});

/** Name and organization link; the abbreviation is fixed once created (Sanity and others key on it) */
export const impactCharityUpdateInput = z.strictObject({
  id: idSchema,
  name: z.string().trim().min(1, "Give a name").max(200),
  organizationId: idSchema.nullable(),
});

const shortText = z.string().trim().min(1, "Give a short text").max(100);
const longText = z.string().trim().max(1000);
const textSchema = z.strictObject({ shortDescription: shortText, longDescription: longText });

const interventionFields = {
  /** English */
  shortDescription: shortText,
  longDescription: longText,
  /** Other languages; a language left out shows the English texts */
  texts: z
    .strictObject({
      no: textSchema.optional(),
      sv: textSchema.optional(),
      et: textSchema.optional(),
      dk: textSchema.optional(),
    })
    .default({}),
};

export const impactInterventionCreateInput = z.strictObject(interventionFields);
export const impactInterventionUpdateInput = z.strictObject({
  id: idSchema,
  ...interventionFields,
});

//endregion
