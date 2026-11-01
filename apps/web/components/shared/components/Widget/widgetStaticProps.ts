import { groq } from "next-sanity";
import { getClient } from "../../../../lib/sanity.client";
import { token } from "../../../../token";
import type { PrefilledDistribution } from "../../../main/layout/WidgetPane/WidgetPane";
import { RecurringDonation } from "./types/Enums";
import type { WidgetProps } from "./types/WidgetProps";

// The widget's Sanity query and static props, apart from the widget component: the layouts (in
// every page's bundle) fetch these, and the widget's code is only loaded when its pane is opened.

export const widgetContentQuery = groq`
  ...,
  "locale": *[ _type == "site_settings"][0].main_locale,
  "donate_label": *[ _type == "site_settings"][0].donate_label,
  "accentColor": *[ _type == "site_settings"][0].accent_color,
  methods[@->_type in ["bank", "vipps", "avtalegiro", "quickpay_card", "quickpay_mobilepay", "dkbank"]] {
    _type == 'reference' => @->{
      _type == 'bank' => {
        ...,
        transaction_cost,
        completed_redirect -> {
          "slug": slug.current,
        },
        "locale": *[ _type == "site_settings"][0].main_locale,
      },
      _type == 'vipps' => {
        _id,
        selector_text,
        recurring_title,
        recurring_selector_earliest_text,
        recurring_selector_choose_date_text,
        recurring_selector_date_picker_configuration->,
        recurring_button_text,
        single_title,
        single_button_text,
        transaction_cost,
      },
      _type == 'avtalegiro' => {
        ...,
        transaction_cost,
        date_selector_configuration->
      },
      _type == 'quickpay_card' => {
        ...,
        transaction_cost,
      },
      _type == 'quickpay_mobilepay' => {
        ...,
        transaction_cost,
      },
      _type == 'dkbank' => {
        ...,
        transaction_cost,
      },
    },
  },
  nudges[]{
    _key,
    message,
    minimum_amount,
    recurring_type,
    from_method->{
      _id,
      selector_text
    },
    to_method->{
      _id,
      selector_text
    },
  },
  privacy_policy_link {
    ...,
    "slug": page->slug.current,
    "pagetype": page->_type,
  },
`;

export const widgetQuery = groq`
*[_type == "donationwidget"][0] {
  ${widgetContentQuery}
}
`;

export const getWidgetStaticProps = async ({
  draftMode,
  inline,
  prefilled,
  defaultPaymentType,
}: {
  draftMode: boolean;
  inline?: boolean;
  prefilled?: PrefilledDistribution;
  defaultPaymentType?: RecurringDonation;
}) => {
  const result = await getClient(draftMode ? token : undefined).fetch<WidgetProps>(widgetQuery);

  if (!result.methods?.length) {
    throw new Error("No payment methods found");
  }

  return {
    data: {
      result,
      query: widgetQuery,
    },
    inline: inline ?? false,
    prefilled: prefilled ?? null,
    defaultPaymentType: defaultPaymentType ?? RecurringDonation.NON_RECURRING,
  };
};

export type WidgetStaticProps = Awaited<ReturnType<typeof getWidgetStaticProps>>;
