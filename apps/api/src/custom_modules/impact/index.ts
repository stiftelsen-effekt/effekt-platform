/**
 * Impact figures (GiveWell cost per output) from our own tables: docs/impact-api-migration.md.
 *
 * - data.ts: the Impact_* tables, cached in memory
 * - rules.ts: which evaluation or fund grant applies to a month, cost per output, texts
 * - estimate.ts: what one donation buys, and the Danish `impact` shape for Min Side
 * - donations.ts: a donor's per-donation impact and sums (Min Side, phase 3)
 * - receipts.ts: the receipts' estimates (mail.ts)
 * - costs.ts: cost per output now, for the intervention widget (site.impactCosts)
 * - ../monthlyOutputs.ts: the results page's outputs per month
 * - remote.ts: the legacy impact API path, behind IMPACT_SOURCE=remote for one release
 */
export {
  clearImpactDataCache,
  getImpactData,
  IMPACT_LANGUAGES,
  type ImpactData,
  type ImpactFund,
  type ImpactLanguage,
} from "./data";
export {
  dayOf,
  effectiveEvaluation,
  effectiveGrant,
  grantSplit,
  interventionText,
  monthOf,
  outputsFor,
} from "./rules";
export {
  estimateDonation,
  sumImpactEntries,
  toImpactEntries,
  type DonationEstimate,
  type DonationImpactEntry,
  type ImpactLine,
  type OrganizationShare,
} from "./estimate";
export {
  donorImpact,
  getDonationImpacts,
  getDonorImpactSummary,
  type DonorImpactOptions,
} from "./donations";
export {
  distributionShares,
  getImpactEstimatesForDonationByOrg,
  receiptEstimates,
  type OrganizationImpactEstimate,
} from "./receipts";
export { impactSource } from "./source";
export { clearImpactCostsMemo, getImpactCosts, type ImpactCost } from "./costs";
