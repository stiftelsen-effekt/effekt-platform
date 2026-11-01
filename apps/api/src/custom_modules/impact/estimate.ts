import type { ImpactData, ImpactLanguage } from "./data";
import {
  effectiveEvaluation,
  effectiveGrant,
  grantSplit,
  interventionText,
  outputsFor,
} from "./rules";

/** One organization's part of a donation, 0..1 (cause area share × organization share) */
export type OrganizationShare = { organizationId: number; share: number };

/** What one part of a donation buys: one charity and intervention */
export type ImpactLine = {
  /** The organization the donor gave to (for a fund, the fund) */
  organizationId: number;
  /** The charity that does the work (for a fund, the grant's recipient) */
  charityId: number;
  charityName: string;
  interventionId: number;
  /** The intervention's short description in the requested language ("Myggnett") */
  unit: string;
  longDescription: string;
  /** The part of the donation, in the donation's currency */
  amount: number;
  outputs: number;
  /** USD cents per output */
  centsPerOutput: number;
  /** The evaluation or the fund grant allotment the figure comes from */
  basis: { kind: "evaluation" | "allotment"; id: number };
};

export type DonationEstimate = {
  lines: ImpactLine[];
  /** Parts of the donation with no estimate (no linked charity, no evaluation yet, AGF, Drift) */
  withoutEstimate: { organizationId: number; amount: number }[];
};

/**
 * What a donation buys, part by part (pure: no I/O).
 *
 * @param month the donation's month, YYYY-MM-01 (rules.monthOf)
 * @param amount the donation's sum
 * @param perUsd units of the donation's currency per USD on the donation's day
 * @param shares the donation's distribution
 */
export function estimateDonation(
  data: ImpactData,
  input: {
    month: string;
    amount: number;
    perUsd: number;
    shares: OrganizationShare[];
    language: ImpactLanguage;
  },
): DonationEstimate {
  const lines: ImpactLine[] = [];
  const withoutEstimate: DonationEstimate["withoutEstimate"] = [];

  for (const { organizationId, share } of input.shares) {
    const amount = input.amount * share;
    const fund = data.fundByOrganization.get(organizationId);
    if (fund) {
      const grant = effectiveGrant(data, fund, input.month);
      const parts = grant ? grantSplit(grant) : [];
      if (parts.length === 0) withoutEstimate.push({ organizationId, amount });
      for (const part of parts) {
        const intervention = data.interventions.get(part.allotment.interventionId)!;
        const text = interventionText(intervention, input.language);
        lines.push({
          organizationId,
          charityId: part.allotment.charityId,
          charityName: data.charities.get(part.allotment.charityId)?.name ?? "",
          interventionId: intervention.id,
          unit: text.shortDescription,
          longDescription: text.longDescription,
          amount: amount * part.share,
          outputs: outputsFor(amount * part.share, input.perUsd, part.centsPerOutput),
          centsPerOutput: part.centsPerOutput,
          basis: { kind: "allotment", id: part.allotment.id },
        });
      }
      continue;
    }

    const charity = data.charityByOrganization.get(organizationId);
    const evaluation = charity ? effectiveEvaluation(data, charity.id, input.month) : null;
    if (!charity || !evaluation) {
      withoutEstimate.push({ organizationId, amount });
      continue;
    }
    const intervention = data.interventions.get(evaluation.interventionId)!;
    const text = interventionText(intervention, input.language);
    lines.push({
      organizationId,
      charityId: charity.id,
      charityName: charity.name,
      interventionId: intervention.id,
      unit: text.shortDescription,
      longDescription: text.longDescription,
      amount,
      outputs: outputsFor(amount, input.perUsd, evaluation.centsPerOutput),
      centsPerOutput: evaluation.centsPerOutput,
      basis: { kind: "evaluation", id: evaluation.id },
    });
  }

  return { lines, withoutEstimate };
}

/**
 * One entry of a donation's `impact` in the Danish backend's shape (`minside.donations`,
 * apps/api/src/trpc/shared/minside.ts): `recipient` is the charity, `organization` the
 * organization's name as Min Side lists it, `unit` the output, `count` the number of outputs
 * (null: no estimate) and `amount` the part of the donation. `organizationId` (only our backend
 * sends it) is the organization's ID, so Min Side can tell money given through a fund from money
 * given directly without matching names.
 */
export type DonationImpactEntry = {
  recipient: string;
  unit: string | null;
  organization: string | null;
  organizationId: number;
  amount: number;
  count: number | null;
};

/**
 * The Danish shape of an estimate: one entry per (organization, charity, output), lines for the
 * same output merged (a fund grant can give the same charity two allotments), then one entry
 * without a count per organization with no estimate.
 */
export function toImpactEntries(
  data: ImpactData,
  estimate: DonationEstimate,
): DonationImpactEntry[] {
  const entries = new Map<string, DonationImpactEntry>();
  for (const line of estimate.lines) {
    const key = `${line.organizationId}:${line.charityId}:${line.interventionId}`;
    const entry = entries.get(key);
    if (entry) {
      entry.amount += line.amount;
      entry.count! += line.outputs;
    } else {
      entries.set(key, {
        recipient: line.charityName,
        unit: line.unit,
        organization: data.organizationNames.get(line.organizationId) ?? null,
        organizationId: line.organizationId,
        amount: line.amount,
        count: line.outputs,
      });
    }
  }
  const out = [...entries.values()];
  for (const { organizationId, amount } of estimate.withoutEstimate) {
    const name = data.organizationNames.get(organizationId) ?? null;
    out.push({
      recipient: name ?? "",
      unit: null,
      organization: name,
      organizationId,
      amount,
      count: null,
    });
  }
  return out;
}

/**
 * Sums entries of many donations (a donor's year, or all years): one entry per (organization,
 * recipient, unit), in first-seen order. Entries without a count stay without one.
 */
export function sumImpactEntries(entries: Iterable<DonationImpactEntry>): DonationImpactEntry[] {
  const sums = new Map<string, DonationImpactEntry>();
  for (const e of entries) {
    const key = `${e.organizationId}\u0000${e.recipient}\u0000${e.unit}`;
    const sum = sums.get(key);
    if (!sum) sums.set(key, { ...e });
    else {
      sum.amount += e.amount;
      if (sum.count !== null && e.count !== null) sum.count += e.count;
    }
  }
  return [...sums.values()];
}
