import type { TaxUnit } from "../../../../../models";

type Deduction = NonNullable<TaxUnit["taxDeductions"]>[number];

export type DKDeductionSummary = {
  /** Years with donations, as the API returns them (newest first). */
  years: Deduction[];
  totals: { sumDonations: number; deduction: number; benefit: number };
};

/** The years a Danish tax unit gave in, and the sums over them, for the desktop and mobile lists. */
export function dkDeductionSummary(unit: Pick<TaxUnit, "taxDeductions">): DKDeductionSummary {
  const years = unit.taxDeductions?.filter((year) => year.sumDonations > 0) ?? [];
  const sum = (pick: (year: Deduction) => number) =>
    years.reduce((acc, year) => acc + pick(year), 0);
  return {
    years,
    totals: {
      sumDonations: sum((year) => year.sumDonations),
      deduction: sum((year) => year.deduction),
      benefit: sum((year) => year.benefit),
    },
  };
}

/** A CPR number as 010190-1234 and a CVR number as 1234 5678; anything else unchanged. */
export function formatDKTaxId(ssn: string): string {
  if (/^\d{10}$/.test(ssn)) return ssn.replace(/(\d{6})(\d{4})/, "$1-$2");
  if (/^\d{8}$/.test(ssn)) return ssn.replace(/(\d{4})(\d{4})/, "$1 $2");
  return ssn;
}
