import { z } from "zod";

/**
 * Input and output schemas of the impact procedures (docs/impact-api-migration.md), shared with
 * apps/web through `@effekt/api/impact`. This file may only import zod.
 */

export const IMPACT_LANGUAGES = ["en", "no", "sv", "et", "dk"] as const;

/** The currency a language shows when none is given (the legacy impact API's defaults, plus dk) */
export const IMPACT_DEFAULT_CURRENCY = {
  en: "USD",
  no: "NOK",
  sv: "SEK",
  et: "EUR",
  dk: "DKK",
} as const;

/**
 * site.impactCosts: what one output costs now, per charity, for the intervention widget.
 * `abbreviations` are the charity abbreviations Sanity's widget blocks store (AMF, SS, ...), any
 * case. `at` (YYYY-MM-DD, default today) picks the evaluation and the exchange rate.
 */
export const siteImpactCostsInput = z.object({
  abbreviations: z.array(z.string().trim().min(1).max(10)).min(1).max(20),
  language: z.enum(IMPACT_LANGUAGES).default("no"),
  /** ISO 4217; default by language */
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/)
    .transform((c) => c.toUpperCase())
    .optional(),
  at: z.iso.date().optional(),
});

/** One entry per requested abbreviation that has an evaluation; unknown ones are left out */
export const siteImpactCostsOutput = z.array(
  z.object({
    /** As stored (upper case) */
    abbreviation: z.string(),
    charityId: z.number().int(),
    charityName: z.string(),
    interventionId: z.number().int(),
    shortDescription: z.string(),
    longDescription: z.string(),
    /** USD cents per output */
    centsPerOutput: z.number(),
    /** Cost per output in `currency` */
    costPerOutput: z.number(),
    currency: z.string(),
    /** The evaluation's first month, YYYY-MM-DD */
    validFrom: z.string(),
    /** The day of the exchange rate used, YYYY-MM-DD */
    exchangeRateDate: z.string(),
  }),
);
