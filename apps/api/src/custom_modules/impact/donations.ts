import { DateTime } from "luxon";
import { DAO } from "../DAO";
import { loadUsdRates, rateOn } from "../exchangeRates";
import { OSLO_ZONE } from "../osloDays";
import { getImpactData, type ImpactLanguage } from "./data";
import {
  estimateDonation,
  sumImpactEntries,
  toImpactEntries,
  type DonationImpactEntry,
  type OrganizationShare,
} from "./estimate";
import { dayOf, monthOf } from "./rules";

/**
 * A donor's impact for Min Side (docs/impact-api-migration.md, decision 4): the Danish
 * per-donation `impact` shape, and the sums over a year or all years, computed with two queries
 * (the donor's donations with their distributions, and the exchange rates of their days); the
 * impact tables come from the in-memory cache.
 */

type DonationShareRow = {
  ID: number;
  timestamp_confirmed: Date;
  sum_confirmed: string;
  Organization_ID: number;
  cause_area_share: string;
  organization_share: string;
};

/** The donor's donations (optionally in one Oslo calendar year) with their organization shares */
async function readDonorDonationShares(donorId: number, year?: number) {
  const params: unknown[] = [donorId];
  let range = "";
  if (year !== undefined) {
    const start = DateTime.fromObject({ year }, { zone: OSLO_ZONE });
    range = "AND D.timestamp_confirmed >= ? AND D.timestamp_confirmed < ?";
    params.push(start.toJSDate(), start.plus({ years: 1 }).toJSDate());
  }
  const [rows] = await DAO.query<DonationShareRow[]>(
    `SELECT D.ID, D.timestamp_confirmed, D.sum_confirmed, CAO.Organization_ID,
            CA.Percentage_share AS cause_area_share, CAO.Percentage_share AS organization_share
       FROM Donations AS D
       JOIN Distribution_cause_areas AS CA ON CA.Distribution_KID = D.KID_fordeling
       JOIN Distribution_cause_area_organizations AS CAO ON CAO.Distribution_cause_area_ID = CA.ID
      WHERE D.Donor_ID = ? ${range}
      ORDER BY D.ID, CA.ID, CAO.ID`,
    params,
  );

  const donations = new Map<
    number,
    { id: number; timestamp: Date; sum: number; shares: OrganizationShare[] }
  >();
  for (const row of rows) {
    let donation = donations.get(row.ID);
    if (!donation) {
      donation = {
        id: row.ID,
        timestamp: new Date(row.timestamp_confirmed),
        sum: Number(row.sum_confirmed),
        shares: [],
      };
      donations.set(row.ID, donation);
    }
    donation.shares.push({
      organizationId: row.Organization_ID,
      share: (Number(row.cause_area_share) / 100) * (Number(row.organization_share) / 100),
    });
  }
  return [...donations.values()];
}

export type DonorImpactOptions = {
  donorId: number;
  /** Oslo calendar year; all years if left out */
  year?: number;
  /** Intervention texts; default Norwegian */
  language?: ImpactLanguage;
  /** The donations' currency; default NOK (this database holds Norwegian donations) */
  currency?: string;
};

/**
 * Per-donation impact in the Danish `impact` shape, by donation ID. A donation whose day has no
 * exchange rate (none on or before it, as before the first backfill) is left out of the map, so
 * callers can tell "no figure yet" from "no estimate" (an entry with a null count).
 */
export async function getDonationImpacts(
  options: DonorImpactOptions,
): Promise<Map<number, DonationImpactEntry[]>> {
  const language = options.language ?? "no";
  const [data, donations] = await Promise.all([
    getImpactData(),
    readDonorDonationShares(options.donorId, options.year),
  ]);
  const result = new Map<number, DonationImpactEntry[]>();
  if (donations.length === 0) return result;

  const days = donations.map((d) => dayOf(d.timestamp)).sort();
  const rates = await loadUsdRates(options.currency ?? "NOK", days[0], days[days.length - 1]);

  for (const donation of donations) {
    const rate = rateOn(rates, dayOf(donation.timestamp));
    if (!rate) continue;
    const estimate = estimateDonation(data, {
      month: monthOf(donation.timestamp),
      amount: donation.sum,
      perUsd: rate.perUsd,
      shares: donation.shares,
      language,
    });
    result.set(donation.id, toImpactEntries(data, estimate));
  }
  return result;
}

/**
 * The functions Min Side's procedures call, on an object so the router's tests can stub them
 * without a database
 */
export const donorImpact = { getDonationImpacts };

/** The donor's impact summed over a year (or all years): one entry per organization, recipient and output */
export async function getDonorImpactSummary(
  options: DonorImpactOptions,
): Promise<DonationImpactEntry[]> {
  const perDonation = await getDonationImpacts(options);
  return sumImpactEntries([...perDonation.values()].flat());
}
