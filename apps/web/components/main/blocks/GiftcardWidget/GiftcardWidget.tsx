import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { TRPCClientError } from "@trpc/client";
import { validateOrg, validateSsn } from "@ssfbank/norwegian-id-validators";
import { GIFTCARD_MESSAGE_MAX, GIFTCARD_METHODS } from "@effekt/api/giftcard";
import { useMainLocale } from "../../../../context/MainLocaleContext";
import {
  isProcedureAvailable,
  publicTrpcFor,
  type RouterOutputs,
} from "../../../../lib/trpc/client";
import { EffektCheckbox } from "../../../shared/components/EffektCheckbox/EffektCheckbox";
import CharacterCountCircle from "../../../shared/components/CharacterCountCircle/CharacterCountCircle";
import { RadioButtonGroup } from "../../../shared/components/RadioButton/RadioButtonGroup";
import { Spinner } from "../../../shared/components/Spinner/Spinner";
import { getReferralCodeFromLocation, getStoredReferralCode } from "../../../../util/referralCode";
import { GiftcardPurchaseDetails } from "./GiftcardReceipt";
import {
  clampMessage,
  countMessage,
  DEFAULT_SEND_TIME,
  defaultSendDate,
  fillGiftcardText,
  formatKroner,
  formatOsloDateTime,
  GIFTCARD_ERROR_TEXT,
  giftcardErrorMessage,
  giftcardTotal,
  isGiftcardEmail,
  isSendTimeAhead,
  lastSendDate,
  osloDateTimeToIso,
  osloToday,
  presetLabel,
  SEND_TIMES,
  validateStep,
  type GiftcardDelivery,
  type GiftcardFormState,
} from "./giftcardForm";
import { giftcardSessionKey, type GiftcardDocument, type GiftcardSession } from "./types";
import styles from "./GiftcardWidget.module.scss";
import { AnimatedSteps, type StepDirection } from "./AnimatedSteps";
import { GiftcardCalendar } from "./GiftcardCalendar";
import { EffektSelect } from "../../../shared/components/EffektSelect/EffektSelect";

type Product = RouterOutputs["giftcard"]["products"][number];
type Step = "product" | "amount" | "message" | "delivery" | "summary" | "bank";

/**
 * Buying a gift card (gavekort): choose SMS or PDF, number of units, greeting, (for SMS) the
 * recipient's phone and when it is sent, then e-mail, tax deduction and payment. The price per
 * unit comes from the API (giftcard.products), never from Sanity, and the total isn't editable.
 */
export const GiftcardWidget: React.FC<{ product: GiftcardDocument }> = ({ product: page }) => {
  const mainLocale = useMainLocale();
  const trpc = publicTrpcFor(mainLocale);
  const uid = useId();
  const slug = page.slug?.current ?? "";

  const allowSms = page.delivery?.allow_sms !== false;
  const allowPdf = page.delivery?.allow_pdf !== false;
  const initialDelivery: GiftcardDelivery =
    (page.delivery?.default_delivery === "pdf" && allowPdf) || !allowSms ? "pdf" : "sms";

  const paymentMethods = useMemo(
    () =>
      (page.payment_configuration?.payment_methods ?? []).filter(
        (m) => m._type === "vipps" || m._type === "bank",
      ),
    [page.payment_configuration?.payment_methods],
  );

  const [product, setProduct] = useState<Product | null | undefined>(undefined);
  const [startPending, setStartPending] = useState(false);
  useEffect(() => {
    // The Danish site's backend has no gift cards: show "not available" without asking it
    if (!isProcedureAvailable(mainLocale, "giftcard.products")) {
      setProduct(null);
      return;
    }
    let cancelled = false;
    trpc.giftcard.products
      .query()
      .then((products) => {
        if (!cancelled) setProduct(products.find((p) => p.slug === slug) ?? null);
      })
      .catch((err) => {
        console.error("Could not load gift card products", err);
        if (!cancelled) setProduct(null);
      });
    return () => {
      cancelled = true;
    };
  }, [trpc, slug, mainLocale]);

  const [form, setForm] = useState<GiftcardFormState>(() => ({
    delivery: initialDelivery,
    units: page.amount_step?.preset_units?.[0] ?? 1,
    recipientName: "",
    message: "",
    senderName: "",
    recipientPhone: "",
    sendDate: defaultSendDate(),
    sendTime: DEFAULT_SEND_TIME,
    email: "",
    name: "",
    taxDeduction: false,
    ssn: "",
    newsletter: false,
    method: (paymentMethods[0]?._type as "vipps" | "bank") ?? "vipps",
  }));
  const update = <K extends keyof GiftcardFormState>(key: K, value: GiftcardFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    // A field's error goes away as soon as it is changed (the send time is checked on both)
    const cleared = key === "sendDate" || key === "sendTime" ? "sendAt" : key;
    setErrors((prev) => {
      if (!(cleared in prev)) return prev;
      const { [cleared]: _removed, ...rest } = prev;
      return rest;
    });
  };
  const [privacyAccepted, setPrivacyAccepted] = useState(false);

  const steps: Step[] = [
    "product",
    "amount",
    "message",
    ...(form.delivery === "sms" ? (["delivery"] as Step[]) : []),
    "summary",
    "bank",
  ];
  const [step, setStep] = useState<Step>("product");
  const [direction, setDirection] = useState<StepDirection>("forward");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [registration, setRegistration] = useState<{ KID: string; amount: number } | null>(null);
  const inFlight = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Back from Vipps restores the page from the back/forward cache with the button spinning
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        inFlight.current = false;
        setSubmitting(false);
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const goTo = (next: Step) => {
    setErrors({});
    setDirection(steps.indexOf(next) < steps.indexOf(step) ? "backward" : "forward");
    setStep(next);
    panelRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  const index = steps.indexOf(step);
  const back = () => index > 0 && step !== "bank" && !submitting && goTo(steps[index - 1]);
  const next = () => {
    if (step === "amount" || step === "message" || step === "delivery") {
      const problems = validateStep(step, form, {
        minUnits: product?.minUnits ?? 1,
        maxUnits: product?.maxUnits ?? 1000,
      });
      if (Object.keys(problems).length > 0) {
        setErrors(problems);
        return;
      }
    }
    goTo(steps[index + 1]);
  };

  useEffect(() => {
    if (startPending && product) {
      setStartPending(false);
      next();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startPending, product]);

  const total = giftcardTotal(form.units, product?.unitPrice ?? 0);
  const sendAtIso =
    form.delivery === "sms" ? osloDateTimeToIso(form.sendDate, form.sendTime) : null;
  const sendAtText = sendAtIso ? formatOsloDateTime(sendAtIso) : "";
  const pay = page.payment_configuration;

  const submit = async () => {
    if (inFlight.current || !product) return;
    const problems: Record<string, string> = {};
    if (!isGiftcardEmail(form.email)) problems.email = "Skriv inn e-postadressen din";
    if (pay?.privacy_policy?.require_checkbox && !privacyAccepted) {
      problems.privacy =
        pay.privacy_policy.required_error_text || "Du må godta personvernerklæringen";
    }
    if (form.taxDeduction) {
      const ssn = form.ssn.trim();
      const valid =
        (ssn.length === 9 && validateOrg(ssn)) || (ssn.length === 11 && validateSsn(ssn));
      if (!valid) {
        problems.ssn = pay?.tax_deduction?.ssn_invalid_error_text || "Ugyldig fødselsnummer";
      }
    }
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      return;
    }
    // The send time was checked on the delivery step, but the buyer may have lingered since
    if (form.delivery === "sms" && !isSendTimeAhead(sendAtIso)) {
      goTo("delivery");
      setErrors({ sendAt: "Velg et tidspunkt fram i tid" });
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const referralCode = getReferralCodeFromLocation() ?? getStoredReferralCode();
      const result = await trpc.giftcard.register.mutate({
        product: product.slug,
        units: form.units!,
        delivery: form.delivery,
        recipientName: form.recipientName.trim(),
        senderName: form.senderName.trim(),
        message: form.message.trim() || null,
        recipientPhone: form.delivery === "sms" ? form.recipientPhone : null,
        sendAt: sendAtIso,
        donor: {
          email: form.email.trim(),
          name: form.name.trim() || form.senderName.trim() || null,
          ssn: form.taxDeduction ? form.ssn.trim() : null,
          newsletter: form.newsletter,
        },
        method: form.method === "vipps" ? GIFTCARD_METHODS.VIPPS : GIFTCARD_METHODS.BANK,
        referralCode: referralCode ?? null,
      });

      const session: GiftcardSession = {
        registrationToken: result.registrationToken,
        product: product.slug,
      };
      try {
        sessionStorage.setItem(giftcardSessionKey(result.KID), JSON.stringify(session));
      } catch {
        // Private mode: the thank-you page then shows its general text
      }

      if (form.method === "vipps") {
        // Without a Vipps link there is no way to pay; never show bank details for it instead
        if (!result.paymentProviderUrl) throw new Error("No Vipps payment link");
        // nosemgrep: javascript.browser.security.open-redirect-from-function.js-open-redirect-from-function -- the Vipps URL comes from our API
        window.location.href = result.paymentProviderUrl;
        return;
      }

      if (result.registrationToken) {
        await trpc.giftcard.registerBankPending
          .mutate({ KID: result.KID, registrationToken: result.registrationToken })
          .catch((err) => console.error("Could not send the bank details e-mail", err));
      }
      setRegistration({ KID: result.KID, amount: result.amount });
      inFlight.current = false;
      setSubmitting(false);
      goTo("bank");
    } catch (err) {
      console.error(err);
      inFlight.current = false;
      setSubmitting(false);
      const { text, field } =
        err instanceof TRPCClientError
          ? giftcardErrorMessage({
              message: err.message,
              httpStatus: err.data?.httpStatus,
              fieldErrors: err.data?.fieldErrors,
            })
          : { text: GIFTCARD_ERROR_TEXT };
      // A field on an earlier step: back there with the error next to the field
      const fieldStep: Partial<Record<string, Step>> = {
        units: "amount",
        message: "message",
        recipientPhone: "delivery",
        sendAt: "delivery",
      };
      const back = field ? fieldStep[field] : undefined;
      if (field && back && steps.includes(back)) {
        goTo(back);
        setErrors({ [field]: text });
      } else if (field === "email" || field === "ssn") {
        setErrors({
          [field]: field === "ssn" ? pay?.tax_deduction?.ssn_invalid_error_text || text : text,
        });
      } else {
        setSubmitError(text);
      }
    }
  };

  const flowSteps: Step[] = steps.filter((s) => s !== "product" && s !== "bank");
  const flowIndex = flowSteps.indexOf(step);
  // While the indicator closes (back to the start) it keeps showing the step it was on
  const [shownFlowIndex, setShownFlowIndex] = useState(0);
  useEffect(() => {
    if (flowIndex >= 0) setShownFlowIndex(flowIndex);
  }, [flowIndex]);
  const dotIndex = flowIndex >= 0 ? flowIndex : shownFlowIndex;
  const messageCount = countMessage(form.message);

  return (
    <div className={styles.widget} ref={panelRef} data-cy="giftcard-widget">
      <h2 className={styles.title}>{page.title}</h2>
      {page.price_label && <p className={styles.pricelabel}>{page.price_label}</p>}

      <AnimatedSteps
        stepKey={step}
        direction={direction}
        headerOpen={flowIndex >= 0}
        header={
          <div className={styles.nav}>
            <button
              type="button"
              className={styles.back}
              style={{ opacity: step === "bank" ? 0 : 1 }}
              onClick={back}
              aria-label="Tilbake"
              data-cy="giftcard-back"
            >
              ←
            </button>
            <ol className={styles.dots} aria-label={`Steg ${dotIndex + 1} av ${flowSteps.length}`}>
              {flowSteps.map((s, i) => (
                <li
                  key={s}
                  className={i <= dotIndex ? styles.dotactive : styles.dot}
                  aria-current={i === dotIndex ? "step" : undefined}
                />
              ))}
            </ol>
            <span />
          </div>
        }
      >
        {product === null && step !== "bank" && (
          <p className={styles.error} role="alert">
            Dette gavekortet er ikke tilgjengelig akkurat nå.
          </p>
        )}

        {step === "product" && (
          <div className={styles.step} data-cy="giftcard-step-product">
            {page.description && <p className={styles.description}>{page.description}</p>}
            {allowSms && allowPdf && (
              <div className={styles.field}>
                <span id="giftcard-delivery-label">
                  {page.delivery?.question || "Hvordan vil du gi gavekortet?"}
                </span>
                <EffektSelect<GiftcardDelivery>
                  label={page.delivery?.question || "Hvordan vil du gi gavekortet?"}
                  value={form.delivery}
                  onChange={(value) => update("delivery", value)}
                  options={[
                    { value: "sms", label: page.delivery?.sms_label || "Gavekort på SMS" },
                    {
                      value: "pdf",
                      label: page.delivery?.pdf_label || "Gavebevis til utskrift",
                    },
                  ]}
                  dataCy="giftcard-delivery-select"
                />
              </div>
            )}
            <button
              type="button"
              className={styles.button}
              // Same text while the price loads, so nothing changes on page load; a click
              // before it has loaded waits for it (the amount step needs the price)
              onClick={() => (product ? next() : setStartPending(true))}
              disabled={product === null}
              data-cy="giftcard-start"
            >
              {page.delivery?.start_button_text || "Gi et gavekort"}
            </button>
          </div>
        )}

        {step === "amount" && product && (
          <form
            className={styles.step}
            onSubmit={(e) => {
              e.preventDefault();
              next();
            }}
            data-cy="giftcard-step-amount"
          >
            <div className={styles.presets}>
              {(page.amount_step?.preset_units ?? [5, 15, 30]).map((units) => (
                <button
                  key={units}
                  type="button"
                  className={form.units === units ? styles.presetactive : styles.preset}
                  onClick={() => update("units", units)}
                  data-cy={`giftcard-preset-${units}`}
                >
                  {presetLabel(page.amount_step?.preset_label_template, units)}
                </button>
              ))}
            </div>
            <label className={styles.field}>
              <span>{page.amount_step?.units_label || "Hvor mange?"}</span>
              <input
                type="number"
                inputMode="numeric"
                min={product.minUnits}
                max={product.maxUnits}
                step={1}
                value={form.units ?? ""}
                onChange={(e) => {
                  const value = parseInt(e.target.value, 10);
                  update("units", Number.isNaN(value) ? null : value);
                }}
                aria-invalid={errors.units ? true : undefined}
                aria-describedby={errors.units ? `${uid}-units` : undefined}
                data-cy="giftcard-units-input"
              />
            </label>
            {errors.units && (
              <p className={styles.error} id={`${uid}-units`} role="alert">
                {errors.units}
              </p>
            )}
            <div className={styles.total} data-cy="giftcard-total">
              <span>{page.amount_step?.total_label || "Totalt"}</span>
              <span>{formatKroner(total)}</span>
            </div>
            <button type="submit" className={styles.button} data-cy="giftcard-next">
              {page.next_button_text || "Neste"}
            </button>
          </form>
        )}

        {step === "message" && (
          <form
            className={styles.step}
            onSubmit={(e) => {
              e.preventDefault();
              next();
            }}
            data-cy="giftcard-step-message"
          >
            {page.message_step?.heading && (
              <p className={styles.heading}>{page.message_step.heading}</p>
            )}
            <input
              className={styles.input}
              type="text"
              maxLength={100}
              placeholder={page.message_step?.recipient_name_label || "Navn på mottaker"}
              aria-label={page.message_step?.recipient_name_label || "Navn på mottaker"}
              value={form.recipientName}
              onChange={(e) => update("recipientName", e.target.value)}
              aria-invalid={errors.recipientName ? true : undefined}
              aria-describedby={errors.recipientName ? `${uid}-recipientName` : undefined}
              data-cy="giftcard-recipient-name"
            />
            {errors.recipientName && (
              <p className={styles.error} id={`${uid}-recipientName`} role="alert">
                {errors.recipientName}
              </p>
            )}
            <div className={styles.textarea}>
              <textarea
                rows={5}
                placeholder={page.message_step?.message_label || "En personlig hilsen (valgfritt)"}
                aria-label={page.message_step?.message_label || "En personlig hilsen (valgfritt)"}
                value={form.message}
                onChange={(e) => update("message", clampMessage(e.target.value))}
                aria-invalid={errors.message ? true : undefined}
                aria-describedby={errors.message ? `${uid}-message` : undefined}
                data-cy="giftcard-message"
              />
              <div
                className={messageCount.nearLimit ? styles.counterwarn : styles.counter}
                data-cy="giftcard-message-count"
              >
                {form.message.length > 0 && (
                  <CharacterCountCircle count={messageCount.count} max={GIFTCARD_MESSAGE_MAX} />
                )}
              </div>
            </div>
            {errors.message && (
              <p className={styles.error} id={`${uid}-message`} role="alert">
                {errors.message}
              </p>
            )}
            <input
              className={styles.input}
              type="text"
              maxLength={100}
              placeholder={page.message_step?.sender_name_label || "Navn på avsender"}
              aria-label={page.message_step?.sender_name_label || "Navn på avsender"}
              value={form.senderName}
              onChange={(e) => update("senderName", e.target.value)}
              aria-invalid={errors.senderName ? true : undefined}
              aria-describedby={errors.senderName ? `${uid}-senderName` : undefined}
              data-cy="giftcard-sender-name"
            />
            {errors.senderName && (
              <p className={styles.error} id={`${uid}-senderName`} role="alert">
                {errors.senderName}
              </p>
            )}
            <button type="submit" className={styles.button} data-cy="giftcard-next">
              {page.next_button_text || "Neste"}
            </button>
          </form>
        )}

        {step === "delivery" && (
          <form
            className={styles.step}
            onSubmit={(e) => {
              e.preventDefault();
              next();
            }}
            data-cy="giftcard-step-delivery"
          >
            <input
              className={styles.input}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder={page.delivery_step?.phone_label || "Mottakers telefonnummer"}
              aria-label={page.delivery_step?.phone_label || "Mottakers telefonnummer"}
              value={form.recipientPhone}
              onChange={(e) => update("recipientPhone", e.target.value)}
              aria-invalid={errors.recipientPhone ? true : undefined}
              aria-describedby={errors.recipientPhone ? `${uid}-recipientPhone` : undefined}
              data-cy="giftcard-phone"
            />
            {page.delivery_step?.phone_help && (
              <p className={styles.help}>{page.delivery_step.phone_help}</p>
            )}
            {errors.recipientPhone && (
              <p className={styles.error} id={`${uid}-recipientPhone`} role="alert">
                {errors.recipientPhone}
              </p>
            )}
            <p className={styles.label}>
              {page.delivery_step?.when_label || "Når skal SMS-en leveres?"}
            </p>
            <GiftcardCalendar
              label={page.delivery_step?.when_label || "Når skal SMS-en leveres?"}
              value={form.sendDate}
              min={osloToday()}
              max={lastSendDate()}
              onChange={(date) => update("sendDate", date)}
            />
            <EffektSelect
              inlineLabel
              label={page.delivery_step?.time_label || "Klokka"}
              value={form.sendTime}
              onChange={(time) => update("sendTime", time)}
              options={SEND_TIMES.map((t) => ({ value: t, label: t }))}
              dataCy="giftcard-time"
            />
            {errors.sendAt && (
              <p className={styles.error} id={`${uid}-sendAt`} role="alert">
                {errors.sendAt}
              </p>
            )}
            <button type="submit" className={styles.button} data-cy="giftcard-next">
              {page.next_button_text || "Neste"}
            </button>
          </form>
        )}

        {step === "summary" && product && (
          <form
            className={styles.step}
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            data-cy="giftcard-step-summary"
          >
            <dl className={styles.summary}>
              <div>
                <dt>{page.summary_step?.units_label || page.title}</dt>
                <dd>{form.units}</dd>
              </div>
              <div>
                <dt>{page.summary_step?.price_label || "Pris"}</dt>
                <dd>{formatKroner(total)}</dd>
              </div>
              {form.delivery === "sms" ? (
                <div>
                  <dt>{page.summary_step?.send_label || "Sendes"}</dt>
                  <dd>{sendAtText}</dd>
                </div>
              ) : (
                <div>
                  <dt>{page.summary_step?.format_label || "Gavetype"}</dt>
                  <dd>{page.summary_step?.pdf_format_value || "Gavebevis"}</dd>
                </div>
              )}
            </dl>
            <p className={styles.summarytext}>
              {form.delivery === "sms"
                ? fillGiftcardText(page.summary_step?.sms_text, {
                    dato: sendAtText,
                    mottaker: form.recipientName.trim(),
                  })
                : fillGiftcardText(page.summary_step?.pdf_text, {})}
            </p>
            <hr className={styles.divider} />

            {pay?.tax_deduction_enabled && pay.tax_deduction && (
              <div className={styles.checkbox}>
                <EffektCheckbox
                  checked={form.taxDeduction}
                  onChange={(checked) => update("taxDeduction", checked)}
                  dataCy="giftcard-tax-deduction"
                >
                  {pay.tax_deduction.label || "Jeg ønsker skattefradrag"}
                </EffektCheckbox>
              </div>
            )}
            {pay?.newsletter_enabled && pay.newsletter && (
              <div className={styles.checkbox}>
                <EffektCheckbox
                  checked={form.newsletter}
                  onChange={(checked) => update("newsletter", checked)}
                  dataCy="giftcard-newsletter"
                >
                  {pay.newsletter.label || "Jeg ønsker å melde meg på nyhetsbrevet"}
                </EffektCheckbox>
              </div>
            )}
            {form.taxDeduction && (
              <>
                <input
                  className={styles.input}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder={pay?.tax_deduction?.ssn_label || "Fødselsnummer"}
                  aria-label={pay?.tax_deduction?.ssn_label || "Fødselsnummer"}
                  value={form.ssn}
                  onChange={(e) => update("ssn", e.target.value)}
                  aria-invalid={errors.ssn ? true : undefined}
                  aria-describedby={errors.ssn ? `${uid}-ssn` : undefined}
                  data-cy="giftcard-ssn"
                />
                {errors.ssn && (
                  <p className={styles.error} id={`${uid}-ssn`} role="alert">
                    {errors.ssn}
                  </p>
                )}
                <input
                  className={styles.input}
                  type="text"
                  autoComplete="name"
                  placeholder="Fullt navn"
                  aria-label="Fullt navn"
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  data-cy="giftcard-donor-name"
                />
              </>
            )}
            <input
              className={styles.input}
              type="email"
              autoComplete="email"
              placeholder={pay?.email_label || "E-post"}
              aria-label={pay?.email_label || "E-post"}
              value={form.email}
              onChange={(e) => update("email", e.target.value)}
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? `${uid}-email` : undefined}
              data-cy="giftcard-email"
            />
            {errors.email && (
              <p className={styles.error} id={`${uid}-email`} role="alert">
                {errors.email}
              </p>
            )}

            {pay?.privacy_policy && (
              <PrivacyPolicy
                policy={pay.privacy_policy}
                accepted={privacyAccepted}
                onAccept={(accepted) => {
                  setPrivacyAccepted(accepted);
                  setErrors(({ privacy: _removed, ...rest }) => rest);
                }}
                error={errors.privacy}
              />
            )}

            {paymentMethods.length > 1 && (
              <div className={styles.methods}>
                <RadioButtonGroup
                  options={paymentMethods.map((m, i) => ({
                    title: m.selector_text || m._type,
                    value: i,
                    data_cy: `giftcard-method-${m._type}`,
                  }))}
                  selected={Math.max(
                    0,
                    paymentMethods.findIndex((m) => m._type === form.method),
                  )}
                  onSelect={(i: number) =>
                    update("method", paymentMethods[i]._type as "vipps" | "bank")
                  }
                />
              </div>
            )}

            <button
              type="submit"
              className={styles.button}
              disabled={submitting}
              aria-busy={submitting || undefined}
              data-cy="giftcard-submit"
            >
              {submitting ? (
                <Spinner className={styles.spinner} />
              ) : (
                paymentMethods.find((m) => m._type === form.method)?.single_button_text ||
                paymentMethods.find((m) => m._type === form.method)?.button_text ||
                (form.method === "vipps" ? "Gi med Vipps" : "Gi med bank")
              )}
            </button>
            {submitError && (
              <p className={styles.error} role="alert" data-cy="giftcard-submit-error">
                {submitError}
              </p>
            )}
          </form>
        )}

        {step === "bank" && registration && (
          <div className={styles.step} data-cy="giftcard-step-bank">
            {pay?.bank_account_details?.bank_transfer_info && (
              <p>
                {pay.bank_account_details.bank_transfer_info.replace(
                  /\{accountNumber\}/g,
                  pay.bank_account_details.account_number ?? "",
                )}
              </p>
            )}
            <div className={styles.account} data-cy="giftcard-bank-details">
              <p>
                <strong>
                  {pay?.bank_account_details?.account_number_prefix || "Kontonummer:"}
                </strong>{" "}
                {pay?.bank_account_details?.account_number}
              </p>
              <p data-cy="giftcard-kid">
                <strong>{pay?.bank_account_details?.kid_prefix || "KID:"}</strong>{" "}
                {registration.KID}
              </p>
              <p>
                <strong>Beløp:</strong> {formatKroner(registration.amount)}
              </p>
            </div>
            {pay?.bank_account_details?.transfer_delay_text && (
              <p>{pay.bank_account_details.transfer_delay_text}</p>
            )}
            <GiftcardPurchaseDetails
              product={page}
              status={{
                product: page.slug?.current ?? "",
                units: form.units ?? 0,
                amount: registration.amount,
                delivery: form.delivery,
                recipientName: form.recipientName.trim(),
                sendAt: sendAtIso,
                status: "pending",
              }}
            />
          </div>
        )}
      </AnimatedSteps>
    </div>
  );
};

/** The privacy line (or checkbox, when the payment configuration requires one) */
const PrivacyPolicy: React.FC<{
  policy: NonNullable<NonNullable<GiftcardDocument["payment_configuration"]>["privacy_policy"]>;
  accepted: boolean;
  onAccept: (accepted: boolean) => void;
  error?: string;
}> = ({ policy, accepted, onAccept, error }) => {
  const url = policy.privacy_policy_url?.slug ? `/${policy.privacy_policy_url.slug}` : null;
  const title = policy.privacy_policy_url?.title;
  // Without a link title the text itself is the link (it usually ends "... personvernerklæring")
  const text =
    url && !title ? (
      <Link href={url} target="_blank">
        {`${policy.text} ↗`}
      </Link>
    ) : (
      policy.text
    );
  const link =
    url && title ? (
      <Link href={url} target="_blank">
        {` ${title} ↗`}
      </Link>
    ) : null;

  if (policy.require_checkbox) {
    return (
      <>
        <div className={styles.checkbox}>
          <EffektCheckbox checked={accepted} onChange={onAccept} dataCy="giftcard-privacy">
            <>
              {text}
              {link}
            </>
          </EffektCheckbox>
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </>
    );
  }
  return (
    <p className={styles.privacy}>
      {text}
      {link}
    </p>
  );
};
