/**
 * IMPACT_SOURCE=remote switches the receipts and the results page back to the legacy impact API
 * (impact.gieffektivt.no) and Norges Bank, as before the move to local tables. Kept for one
 * release (docs/impact-api-migration.md, phase 2); anything else, or unset, means local.
 */
export function impactSource(): "local" | "remote" {
  return process.env.IMPACT_SOURCE === "remote" ? "remote" : "local";
}
