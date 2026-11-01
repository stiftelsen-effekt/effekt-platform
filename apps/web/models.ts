import type { RouterOutputs } from "./lib/trpc/client";

/*
 * Min Side's data, as the procedures' output schemas (apps/api/src/trpc/shared/minside.ts) return
 * it, on every site: the Danish REST link validates with the same schemas.
 */
type Minside = RouterOutputs["minside"];
export type Donation = Minside["donations"][number];
/** One entry of a donation's impact (minside.donations; both backends send it) */
export type DonationImpactEntry = NonNullable<Donation["impact"]>[number];
export type AvtaleGiroAgreement = Minside["avtaleGiroAgreements"][number];
export type VippsAgreement = Minside["vippsAgreements"][number];
export type Distribution = Minside["distributions"][number];
export type DistributionCauseArea = Distribution["causeAreas"][number];
export type Donor = Minside["profile"];
export type AggregatedDonations = Minside["donationsAggregated"][number];
export type TaxUnit = Minside["taxUnits"][number];
export type TaxYearlyReport = Minside["taxReports"][number];
export type TaxYearlyReportUnits = TaxYearlyReport["units"][number];

export enum META_OWNER {
  EFFEKT = 1,
  EAN = 2,
  EFFEKTANDEAN = 3,
}

export type DKPaymentMethod = "MobilePay" | "Credit card" | "Bank transfer";

export type DKAgreement = {
  id: string;
  kid: string;
  bank_msg: string;
  membershipDisplayName?: string | null;
  cancelled: boolean;
  amount: number;
  chargeDay: number | null;
  createdAt: string;
  method: DKPaymentMethod;
  is_payment_expired: boolean;
};

export type DonationGraphData = {
  name: string;
};

export type SEOMeta = {
  title: string;
  titleTemplate?: string;
  description: string;
  imageAssetUrl?: string | null;
  canonicalurl?: string;
  keywords?: string;
  siteName: string;
  noIndex?: boolean;
};
