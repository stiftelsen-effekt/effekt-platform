import type { AggregatedDonations, Donation, Donor } from "../../../models";
import { toNumber } from "../../../util/decimal";

// The donations page's figures from the donor's data, shared by the pages router's DonationsPage
// and the App Router's while Min Side moves over.

export const getYearlySum = (
  aggregated: AggregatedDonations[],
  years: number[],
): { year: string; sum: number }[] => {
  return years.map((year) => ({
    year: year.toString(),
    sum: aggregated.reduce(
      (acc, curr) => (curr.year == year ? acc + toNumber(curr.value) : acc),
      0,
    ),
  }));
};

export const getYears = (donor: Donor, donations: Donation[]) => {
  const registeredYear = new Date(donor.registered).getFullYear();
  const donationYears = donations.map((donation) => new Date(donation.timestamp).getFullYear());
  const minimumDonationYear =
    donationYears.length > 0 ? Math.min(...donationYears) : registeredYear;
  const minYear = Math.min(registeredYear, minimumDonationYear);
  const currentYear = new Date().getFullYear();
  const years: number[] = [];
  for (let i = minYear; i <= currentYear; i++) {
    years.push(i);
  }
  return years;
};

export const getDonationSum = (aggregatedDonations: AggregatedDonations[], year?: string) => {
  return Math.round(
    aggregatedDonations.reduce(
      (acc, curr) => (year === curr.year.toString() || !year ? acc + toNumber(curr.value) : acc),
      0,
    ),
  );
};
