import type { SanityImageObject } from "@sanity/image-url";
import type { NavLink } from "../../../shared/components/Navbar/Navbar";

/** What giftcardProductQuery (_queries.ts) projects from a `giftcardproduct` document */

export type GiftcardImage = SanityImageObject & {
  alt?: string | null;
  asset?: { _id?: string; url?: string | null } | null;
};

export type GiftcardThankYouTexts = {
  sms_text?: string | null;
  pdf_text?: string | null;
  pending_text?: string | null;
  certificate_link_text?: string | null;
};

export type GiftcardPaymentMethod = {
  _type: string;
  selector_text: string | null;
  single_button_text?: string | null;
  button_text: string | null;
};

export type GiftcardPaymentConfiguration = {
  email_label?: string | null;
  tax_deduction_enabled?: boolean | null;
  tax_deduction?: {
    label?: string | null;
    tooltip_text?: string | null;
    ssn_label?: string | null;
    ssn_invalid_error_text?: string | null;
  } | null;
  newsletter_enabled?: boolean | null;
  newsletter?: { label?: string | null } | null;
  privacy_policy?: {
    text?: string | null;
    require_checkbox?: boolean | null;
    required_error_text?: string | null;
    privacy_policy_url?: NavLink | null;
  } | null;
  bank_account_details?: {
    account_number_prefix?: string | null;
    account_number?: string | null;
    kid_prefix?: string | null;
    transfer_delay_text?: string | null;
    account_owner_text?: string | null;
    bank_transfer_info?: string | null;
  } | null;
  payment_methods?: GiftcardPaymentMethod[] | null;
};

export type GiftcardDocument = {
  _id: string;
  title?: string | null;
  slug?: { current?: string } | null;
  price_label?: string | null;
  description?: string | null;
  images?: GiftcardImage[] | null;
  has_certificate?: boolean | null;
  delivery?: {
    question?: string | null;
    allow_sms?: boolean | null;
    sms_label?: string | null;
    allow_pdf?: boolean | null;
    pdf_label?: string | null;
    default_delivery?: "sms" | "pdf" | null;
    start_button_text?: string | null;
  } | null;
  amount_step?: {
    preset_units?: number[] | null;
    preset_label_template?: string | null;
    units_label?: string | null;
    total_label?: string | null;
  } | null;
  message_step?: {
    heading?: string | null;
    recipient_name_label?: string | null;
    message_label?: string | null;
    sender_name_label?: string | null;
  } | null;
  delivery_step?: {
    phone_label?: string | null;
    phone_help?: string | null;
    when_label?: string | null;
    date_label?: string | null;
    time_label?: string | null;
  } | null;
  summary_step?: {
    units_label?: string | null;
    price_label?: string | null;
    send_label?: string | null;
    format_label?: string | null;
    pdf_format_value?: string | null;
    sms_text?: string | null;
    pdf_text?: string | null;
  } | null;
  next_button_text?: string | null;
  payment_configuration?: GiftcardPaymentConfiguration | null;
  thank_you?: GiftcardThankYouTexts | null;
};

export type GiftcardReceiptDocument = Pick<
  GiftcardDocument,
  "_id" | "title" | "slug" | "has_certificate" | "summary_step" | "thank_you"
>;

/** sessionStorage key for what the purchase details block needs to ask the API about a purchase */
export const giftcardSessionKey = (kid: string) => `giftcard:${kid}`;
export type GiftcardSession = { registrationToken: string | null; product: string };
