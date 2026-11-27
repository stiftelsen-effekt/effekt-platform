import { FormEvent, MouseEvent, ReactNode, useState } from "react";
import { PortableText } from "@portabletext/react";
import { DateTime } from "luxon";
import styles from "./PledgeSignup.module.scss";
import { RadioButtonGroup } from "../../../shared/components/RadioButton/RadioButtonGroup";
import { EffektTextInput } from "../../../shared/components/EffektTextInput/EffektTextInput";
import { EffektCheckbox } from "../../../shared/components/EffektCheckbox/EffektCheckbox";
import { EffektDropdown } from "../../../shared/components/EffektDropdown/EffektDropdown";
import { EffektButton } from "../../../shared/components/EffektButton/EffektButton";
import { Spinner } from "../../../shared/components/Spinner/Spinner";
import { customComponentRenderers } from "../Paragraph/Citation";
import { getFormattingLocale } from "../../../../util/formatting";
import {
  EMPLOYMENT_STATUSES,
  EmploymentStatus,
  PLEDGE_TYPES,
  PledgeForm,
  PledgeFormErrors,
  PledgeSettings,
  PledgeType,
  emptyPledgeForm,
  fillPledgeText,
  minIncomeFor,
  trialEndDate,
  validatePledgeForm,
} from "./pledgeRequest";

type Option = { title?: string; description?: string };
/** A pledge type: its name, the one-line commitment and the explanation, as on GWWC's cards */
type PledgeOption = Option & { summary?: string };

/** The block's fields in Sanity (studio/schemas/types/pledgesignup.ts) */
export type PledgeSignupConfig = {
  club_name?: string;
  employment_heading?: string;
  employment_question?: string;
  employed?: Option;
  student?: Option;
  retired?: Option;
  unemployed?: Option;
  pledge_heading?: string;
  pledge_description?: string;
  ten_percent?: PledgeOption;
  trial?: PledgeOption;
  income_label?: string;
  wealth_label?: string;
  wealth_help?: string;
  start_date_label?: string;
  duration_label?: string;
  duration_options?: { label?: string; months: number }[];
  contact_heading?: string;
  contact_description?: string;
  email_label?: string;
  sign_heading?: string;
  ten_percent_text?: string;
  trial_text?: string;
  motivation_label?: string;
  share_motivation_label?: string;
  signed_by_label?: string;
  first_name_label?: string;
  last_name_label?: string;
  terms_text?: any[];
  submit_label?: string;
  required_message?: string;
  income_invalid_message?: string;
  wealth_invalid_message?: string;
  email_invalid_message?: string;
  success_heading?: string;
  success_text?: string;
  failure_text?: string;
};

/** GWWC's own English wording (givingwhatwecan.org/pledge), for any text left empty in Sanity */
const DEFAULTS = {
  employment_heading: "Employment status",
  employment_question: "Which of the following best describes your current employment status?",
  employed: {
    title: "Employed",
    description: "Pledge a percentage of your income until you retire",
  },
  student: {
    title: "Student",
    description:
      "Pledge 1% of your spending money now and a percentage of your future income later",
  },
  retired: { title: "Retired", description: "Pledge a percentage of your retirement income" },
  unemployed: {
    title: "Unemployed",
    description:
      "Pledge 1% of your spending money now and a percentage of your future income later",
  },
  pledge_heading: "Pledge type",
  pledge_description: "Choose the standard 🔸10% Pledge or commit to a 🔹Trial Pledge.",
  ten_percent: {
    title: "The 🔸10% Pledge",
    summary: "Give a minimum of 10% of your income, until you retire.",
    description:
      "Give 10% of your income. You can also pledge a % of wealth (suggested at 2.5%), if that makes sense for you.",
  },
  trial: {
    title: "The 🔹Trial Pledge",
    summary: "Give a minimum of {income}% of your income for {duration}.",
    description:
      "You choose what % of income or what % of wealth you want to pledge and for how long (6 months - 5 years).",
  },
  income_label: "Income %",
  wealth_label: "Wealth % (optional)",
  wealth_help:
    "If you add an optional wealth percentage to your pledge, you're not required to give both income and wealth, just whichever amount is greater that year.",
  start_date_label: "Commencement date",
  duration_label: "Lasting for",
  duration_options: [
    { label: "6 months", months: 6 },
    { label: "1 year", months: 12 },
    { label: "2 years", months: 24 },
    { label: "3 years", months: 36 },
    { label: "4 years", months: 48 },
    { label: "5 years", months: 60 },
  ],
  contact_heading: "E-mail",
  contact_description: "Your pledge is registered with Giving What We Can under this address.",
  email_label: "E-mail",
  sign_heading: "Sign your pledge",
  ten_percent_text:
    "I recognise that I can use part of my income to do a significant amount of good. Since I can live well enough on a smaller income, I pledge that from {start_date} and for the rest of my life or until the day I retire, I shall give at least {income}% of what I earn to whichever organisations can most effectively use it to improve the lives of others. I make this pledge freely, openly, and sincerely.",
  trial_text:
    "I recognise that I can use part of my income to do a significant amount of good. I pledge that from {start_date} until {end_date}, I shall give at least {income}% of what I earn to whichever organisations can most effectively use it to improve the lives of others. I make this pledge freely, openly, and sincerely.",
  motivation_label: "I'm motivated to take this pledge today...",
  share_motivation_label: "I'm happy to share my motivation publicly",
  signed_by_label: "Signed on by:",
  first_name_label: "First name",
  last_name_label: "Last name",
  terms_fallback:
    "I have read and agree to the Giving What We Can Terms and Conditions and Privacy Policy",
  submit_label: "Sign the pledge",
  required_message: "This field is required",
  income_invalid_message: "Invalid income %",
  wealth_invalid_message: "Invalid wealth %",
  email_invalid_message: "Invalid e-mail",
  success_heading: "Thank you for taking the pledge!",
  success_text: "Your pledge is registered with Giving What We Can.",
  failure_text: "Something went wrong, and your pledge was not registered. Please try again.",
};

/** Sanity's value, or the default when it's empty */
const pick = <T,>(value: T | undefined | null, fallback: T): T =>
  value === undefined || value === null || (value as unknown) === "" ? fallback : value;

const pickOption = (value: Option | undefined, fallback: Required<Option>) => ({
  title: pick(value?.title, fallback.title),
  description: pick(value?.description, fallback.description),
});

/** The site's link rendering, with paragraphs inline so the text sits next to the checkbox */
const termsRenderers = {
  ...customComponentRenderers,
  block: { normal: ({ children }: { children?: ReactNode }) => <span>{children}</span> },
};

const pickPledgeOption = (value: PledgeOption | undefined, fallback: Required<PledgeOption>) => ({
  ...pickOption(value, fallback),
  summary: pick(value?.summary, fallback.summary),
});

const Step: React.FC<{ number: number; heading: string; children: ReactNode }> = ({
  number,
  heading,
  children,
}) => (
  <fieldset className={styles.step}>
    <legend className={styles.stepLegend}>
      <span className={styles.stepNumber}>{number}</span>
      <span className={styles.stepHeading}>{heading}</span>
    </legend>
    <div className={styles.stepBody}>{children}</div>
  </fieldset>
);

const FieldError: React.FC<{ message?: string; dataCy: string }> = ({ message, dataCy }) =>
  message ? (
    <div className={styles.fieldError} role="alert" data-cy={dataCy}>
      {message}
    </div>
  ) : null;

export const PledgeSignup: React.FC<{ config?: PledgeSignupConfig; locale?: string }> = ({
  config = {},
  locale,
}) => {
  const [today] = useState(() => DateTime.now().toISODate()!);
  const [form, setForm] = useState<PledgeForm>(() => emptyPledgeForm(today));
  const [showErrors, setShowErrors] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "failed">("idle");

  const settings: PledgeSettings = {
    clubName: config.club_name ?? "",
  };
  const errors: PledgeFormErrors = showErrors ? validatePledgeForm(form) : {};

  const t = <K extends keyof typeof DEFAULTS & keyof PledgeSignupConfig>(key: K) =>
    pick(config[key] as (typeof DEFAULTS)[K] | undefined, DEFAULTS[key]);
  const employment: Record<EmploymentStatus, Required<Option>> = {
    employed: pickOption(config.employed, DEFAULTS.employed),
    student: pickOption(config.student, DEFAULTS.student),
    retired: pickOption(config.retired, DEFAULTS.retired),
    unemployed: pickOption(config.unemployed, DEFAULTS.unemployed),
  };
  const pledgeTypes: Record<PledgeType, Required<PledgeOption>> = {
    ten_percent_pledge: pickPledgeOption(config.ten_percent, DEFAULTS.ten_percent),
    trial_pledge: pickPledgeOption(config.trial, DEFAULTS.trial),
  };
  const durations = (
    config.duration_options?.length ? config.duration_options : DEFAULTS.duration_options
  ).map((d) => ({ months: d.months, label: d.label || `${d.months}` }));

  const update = <K extends keyof PledgeForm>(key: K, value: PledgeForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (status === "failed") setStatus("idle");
  };

  const formatDate = (isoDate: string) => {
    const date = DateTime.fromISO(isoDate);
    return date.isValid
      ? date.setLocale(getFormattingLocale(locale)).toLocaleString(DateTime.DATE_FULL)
      : "…";
  };
  const durationLabel =
    durations.find((d) => d.months === form.durationMonths)?.label ?? durations[0].label;
  const isTrial = form.pledgeType === "trial_pledge";
  const pledgeText = fillPledgeText(isTrial ? t("trial_text") : t("ten_percent_text"), {
    income: form.incomePercentage.trim() || "…",
    startDate: formatDate(form.startDate),
    endDate: isTrial ? formatDate(trialEndDate(form.startDate, form.durationMonths)) : undefined,
  });

  const message = (error: string | undefined) => {
    switch (error) {
      case undefined:
        return undefined;
      case "income_invalid":
        return t("income_invalid_message");
      case "wealth_invalid":
        return t("wealth_invalid_message");
      case "email_invalid":
        return t("email_invalid_message");
      default:
        return t("required_message");
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setShowErrors(true);
    if (Object.keys(validatePledgeForm(form)).length > 0) return;

    setStatus("submitting");
    try {
      const response = await fetch("/api/pledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ form, settings }),
      });
      setStatus(response.ok ? "done" : "failed");
    } catch (error) {
      console.error(error);
      setStatus("failed");
    }
  };

  /** Clicking a link in the terms text opens it without ticking the checkbox */
  const keepLinkClicks = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("a")) e.stopPropagation();
  };

  if (status === "done") {
    return (
      <div className={styles.pledgeSignup} data-cy="pledge-signup-success">
        <div className={styles.success}>
          <h3 className={styles.successHeading}>{t("success_heading")}</h3>
          <p>{t("success_text")}</p>
        </div>
      </div>
    );
  }

  const percentFields = (pledgeType: PledgeType) => (
    <div className={styles.pledgeFields}>
      <label className={styles.field}>
        <span className={styles.label}>
          {t("income_label")}
          <span className={styles.hint}> ≥ {minIncomeFor(pledgeType)} %</span>
        </span>
        <EffektTextInput
          value={form.incomePercentage}
          onChange={(value) => update("incomePercentage", value)}
          inputMode="numeric"
          denomination="%"
          required
          data-cy="pledge-income"
        />
        <FieldError message={message(errors.incomePercentage)} dataCy="pledge-income-error" />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>{t("wealth_label")}</span>
        <EffektTextInput
          value={form.wealthPercentage}
          onChange={(value) => update("wealthPercentage", value)}
          inputMode="numeric"
          denomination="%"
          data-cy="pledge-wealth"
        />
        <FieldError message={message(errors.wealthPercentage)} dataCy="pledge-wealth-error" />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>{t("start_date_label")}</span>
        <input
          type="date"
          className={styles.dateInput}
          value={form.startDate}
          min={today}
          onChange={(e) => update("startDate", e.target.value)}
          required
          data-cy="pledge-start-date"
        />
        <FieldError message={message(errors.startDate)} dataCy="pledge-start-date-error" />
      </label>
      {pledgeType === "trial_pledge" && (
        <div className={styles.field}>
          <span className={styles.label}>{t("duration_label")}</span>
          <EffektDropdown
            placeholder={t("duration_label")}
            options={durations.map((d) => d.label)}
            value={
              durations.find((d) => d.months === form.durationMonths)?.label ?? durations[0].label
            }
            onChange={(label) =>
              update("durationMonths", durations.find((d) => d.label === label)!.months)
            }
          />
        </div>
      )}
      <p className={styles.help}>{t("wealth_help")}</p>
    </div>
  );

  return (
    <div className={styles.pledgeSignup} data-cy="pledge-signup">
      <form onSubmit={handleSubmit} noValidate>
        <Step number={1} heading={t("employment_heading")}>
          <p className={styles.question}>{t("employment_question")}</p>
          <RadioButtonGroup
            options={EMPLOYMENT_STATUSES.map((status, i) => ({
              title: employment[status].title,
              value: i,
              data_cy: `pledge-employment-${status}`,
              content: <p className={styles.optionDescription}>{employment[status].description}</p>,
            }))}
            selected={
              form.employmentStatus ? EMPLOYMENT_STATUSES.indexOf(form.employmentStatus) : undefined
            }
            onSelect={(i) => update("employmentStatus", EMPLOYMENT_STATUSES[i])}
          />
          <FieldError message={message(errors.employmentStatus)} dataCy="pledge-employment-error" />
        </Step>

        <Step number={2} heading={t("pledge_heading")}>
          <p className={styles.question}>{t("pledge_description")}</p>
          <RadioButtonGroup
            options={PLEDGE_TYPES.map((pledgeType, i) => ({
              title: pledgeTypes[pledgeType].title,
              value: i,
              data_cy: `pledge-type-${pledgeType}`,
              content: (
                <>
                  <p className={styles.optionSummary} data-cy={`pledge-summary-${pledgeType}`}>
                    {fillPledgeText(pledgeTypes[pledgeType].summary, {
                      income: form.incomePercentage.trim() || "…",
                      duration: durationLabel,
                    })}
                  </p>
                  <p className={styles.optionDescription}>{pledgeTypes[pledgeType].description}</p>
                  {form.pledgeType === pledgeType && percentFields(pledgeType)}
                </>
              ),
            }))}
            selected={PLEDGE_TYPES.indexOf(form.pledgeType)}
            onSelect={(i) => {
              const pledgeType = PLEDGE_TYPES[i];
              setForm((prev) => ({
                ...prev,
                pledgeType,
                // Keep a typed percentage, but don't leave the 10% Pledge below its minimum
                incomePercentage:
                  pledgeType === "ten_percent_pledge" &&
                  Number(prev.incomePercentage.replace(",", ".")) < 10
                    ? "10"
                    : prev.incomePercentage,
              }));
            }}
          />
        </Step>

        <Step number={3} heading={t("contact_heading")}>
          <p className={styles.question}>{t("contact_description")}</p>
          <label className={styles.field}>
            <span className={styles.label}>{t("email_label")}</span>
            <EffektTextInput
              type="email"
              value={form.email}
              onChange={(value) => update("email", value)}
              autoComplete="email"
              required
              data-cy="pledge-email"
            />
            <FieldError message={message(errors.email)} dataCy="pledge-email-error" />
          </label>
        </Step>

        <Step number={4} heading={t("sign_heading")}>
          <blockquote className={styles.pledgeText} data-cy="pledge-text">
            {pledgeText}
          </blockquote>
          <label className={styles.field}>
            <textarea
              className={styles.textarea}
              value={form.motivation}
              onChange={(e) => update("motivation", e.target.value)}
              placeholder={t("motivation_label")}
              aria-label={t("motivation_label")}
              rows={3}
              maxLength={2048}
              data-cy="pledge-motivation"
            />
          </label>
          <EffektCheckbox
            checked={form.shareMotivation}
            onChange={(checked) => update("shareMotivation", checked)}
            dataCy="pledge-share-motivation"
          >
            {t("share_motivation_label")}
          </EffektCheckbox>

          <p className={styles.signedBy}>{t("signed_by_label")}</p>
          <div className={styles.names}>
            <label className={styles.field}>
              <span className={styles.label}>{t("first_name_label")}</span>
              <EffektTextInput
                value={form.firstName}
                onChange={(value) => update("firstName", value)}
                autoComplete="given-name"
                required
                data-cy="pledge-first-name"
              />
              <FieldError message={message(errors.firstName)} dataCy="pledge-first-name-error" />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>{t("last_name_label")}</span>
              <EffektTextInput
                value={form.lastName}
                onChange={(value) => update("lastName", value)}
                autoComplete="family-name"
                required
                data-cy="pledge-last-name"
              />
              <FieldError message={message(errors.lastName)} dataCy="pledge-last-name-error" />
            </label>
          </div>

          <div className={styles.terms}>
            <EffektCheckbox
              checked={form.acceptedTerms}
              onChange={(checked) => update("acceptedTerms", checked)}
              required
              dataCy="pledge-terms"
            >
              <span onClick={keepLinkClicks} className={styles.termsText}>
                {config.terms_text?.length ? (
                  <PortableText value={config.terms_text} components={termsRenderers} />
                ) : (
                  DEFAULTS.terms_fallback
                )}
              </span>
            </EffektCheckbox>
            <FieldError message={message(errors.acceptedTerms)} dataCy="pledge-terms-error" />
          </div>

          {status === "failed" && (
            <div className={styles.failure} role="alert" data-cy="pledge-failure">
              {t("failure_text")}
            </div>
          )}

          <EffektButton
            type="submit"
            disabled={status === "submitting"}
            className={styles.submit}
            data-cy="pledge-submit"
          >
            {status === "submitting" ? <Spinner className={styles.spinner} /> : t("submit_label")}
          </EffektButton>
        </Step>
      </form>
    </div>
  );
};
