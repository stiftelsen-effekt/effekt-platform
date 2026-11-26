import { DateTime } from "luxon";

/**
 * The pledge signup form's state, its validation, and the request body for Giving What We Can's
 * PUT /v1/pledges/sign (api.givingwhatwecan.org/docs). Plain functions, shared by the form and
 * the /api/pledge route.
 */

export const EMPLOYMENT_STATUSES = ["employed", "student", "retired", "unemployed"] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export const PLEDGE_TYPES = ["ten_percent_pledge", "trial_pledge"] as const;
export type PledgeType = (typeof PLEDGE_TYPES)[number];

/**
 * The limits of GWWC's own pledge form: whole percentages up to 99, the 🔸10% Pledge from 10% of
 * income, the 🔹Trial Pledge from 1%, wealth from 1%. (Their API itself takes 0.5–99 % of
 * income with decimals.)
 */
export const TEN_PERCENT_MIN_INCOME = 10;
export const TRIAL_MIN_INCOME = 1;
export const MIN_WEALTH = 1;
export const MAX_PERCENTAGE = 99;

/** What the person fills in, as on givingwhatwecan.org/pledge */
export type PledgeForm = {
  employmentStatus: EmploymentStatus | null;
  pledgeType: PledgeType;
  /** Kept as typed, e.g. "10" or "12,5" */
  incomePercentage: string;
  /** Optional; empty means none */
  wealthPercentage: string;
  /** yyyy-mm-dd */
  startDate: string;
  /** Trial Pledge only */
  durationMonths: number;
  email: string;
  motivation: string;
  shareMotivation: boolean;
  firstName: string;
  lastName: string;
  acceptedTerms: boolean;
};

/** What we set per site in Sanity, not the person */
export type PledgeSettings = {
  /** GWWC's id for our club (e.g. "giv-effektivt"); GWWC gives it to us */
  clubName: string;
};

export const emptyPledgeForm = (today: string): PledgeForm => ({
  employmentStatus: null,
  pledgeType: "ten_percent_pledge",
  incomePercentage: String(TEN_PERCENT_MIN_INCOME),
  wealthPercentage: "",
  startDate: today,
  durationMonths: 12,
  email: "",
  motivation: "",
  shareMotivation: false,
  firstName: "",
  lastName: "",
  acceptedTerms: false,
});

/** A whole percentage, as GWWC's form takes; empty, decimals or not a number is null */
export const parsePercentage = (value: string): number | null => {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
};

export const minIncomeFor = (pledgeType: PledgeType) =>
  pledgeType === "ten_percent_pledge" ? TEN_PERCENT_MIN_INCOME : TRIAL_MIN_INCOME;

export type PledgeFormError =
  | "employment_required"
  | "income_invalid"
  | "wealth_invalid"
  | "start_date_invalid"
  | "email_invalid"
  | "first_name_required"
  | "last_name_required"
  | "terms_required";

export type PledgeFormErrors = Partial<Record<keyof PledgeForm, PledgeFormError>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validatePledgeForm = (form: PledgeForm): PledgeFormErrors => {
  const errors: PledgeFormErrors = {};
  if (!form.employmentStatus || !EMPLOYMENT_STATUSES.includes(form.employmentStatus)) {
    errors.employmentStatus = "employment_required";
  }
  const income = parsePercentage(form.incomePercentage);
  if (income === null || income < minIncomeFor(form.pledgeType) || income > MAX_PERCENTAGE) {
    errors.incomePercentage = "income_invalid";
  }
  if (form.wealthPercentage.trim() !== "") {
    const wealth = parsePercentage(form.wealthPercentage);
    if (wealth === null || wealth < MIN_WEALTH || wealth > MAX_PERCENTAGE) {
      errors.wealthPercentage = "wealth_invalid";
    }
  }
  if (!DateTime.fromISO(form.startDate).isValid || form.startDate.length !== 10) {
    errors.startDate = "start_date_invalid";
  }
  if (!EMAIL.test(form.email.trim())) errors.email = "email_invalid";
  if (!form.firstName.trim()) errors.firstName = "first_name_required";
  if (!form.lastName.trim()) errors.lastName = "last_name_required";
  if (!form.acceptedTerms) errors.acceptedTerms = "terms_required";
  return errors;
};

/** The Trial Pledge's last day: the day before the same date `months` later */
export const trialEndDate = (startDate: string, months: number) =>
  DateTime.fromISO(startDate).plus({ months }).minus({ days: 1 }).toISODate()!;

/** The JSON body of GWWC's PUT /v1/pledges/sign. Only call it with a valid form */
export const buildPledgeRequest = (form: PledgeForm, settings: PledgeSettings, today: string) => {
  const wealth = parsePercentage(form.wealthPercentage);
  const motivation = form.motivation.trim();
  return {
    person: {
      first_name: form.firstName.trim(),
      last_name: form.lastName.trim(),
      email: form.email.trim(),
    },
    pledge: {
      club_name: settings.clubName,
      pledge_type: form.pledgeType,
      pledge_start_date: form.startDate,
      pledge_end_date:
        form.pledgeType === "trial_pledge"
          ? trialEndDate(form.startDate, form.durationMonths)
          : null,
      pledge_sign_date: today,
      income_percentage: parsePercentage(form.incomePercentage)!,
      wealth_percentage: wealth,
      motivation: motivation || null,
      share_motivation: motivation ? form.shareMotivation : false,
      financial_situation: { employment_status: form.employmentStatus },
      // GWWC requires this to be true. Who verifies the address is an open question for GWWC
      email_verified: true as const,
    },
  };
};

export type PledgeRequest = ReturnType<typeof buildPledgeRequest>;

/** Fills {income}, {start_date}, {end_date} and {duration} in a text from Sanity */
export const fillPledgeText = (
  template: string,
  values: { income: string; startDate?: string; endDate?: string; duration?: string },
) =>
  template
    .replaceAll("{income}", values.income)
    .replaceAll("{start_date}", values.startDate ?? "")
    .replaceAll("{end_date}", values.endDate ?? "")
    .replaceAll("{duration}", values.duration ?? "");
