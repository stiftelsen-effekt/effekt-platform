import { groq } from "next-sanity";
import type { MissingNameModalConfig } from "../../components/profile/layout/MissingNameModal/MissingNameModal";
import type { AggregatedImpactTableConfiguration } from "../../components/profile/donations/DonationsAggregateImpactTable/DonationsAggregateImpactTable";
import type { DonationDetailsConfiguration } from "../../components/profile/shared/lists/donationList/DonationDetails";
import type { DonationsListConfiguration } from "../../components/profile/shared/lists/donationList/DonationList";

// The donations page's Sanity content, shared by the pages router's DonationsPage and the App
// Router's (app/(minside)/minside-app/donations) while Min Side moves over.

export type DonationsPageData = {
  title: string;
  year_menu_total_title: string;
  sum_all_times_template_string?: string;
  sum_year_template_string?: string;
  aggregate_estimated_impact?: AggregatedImpactTableConfiguration;
  desktop_donations_table_configuration?: DonationsListConfiguration;
  mobile_donations_table_configuration?: DonationsListConfiguration;
  donations_details_configuration?: DonationDetailsConfiguration;
  slug?: { current?: string };
};

export type FetchDonationsPageResult = {
  settings: {
    main_currency: string;
    main_locale: string;
    title: string;
  }[];
  dashboard?: Array<{
    dashboard_slug?: { current?: string };
    missing_name_modal_configuration?: MissingNameModalConfig;
  }>;
  page: DonationsPageData | null;
  footer: any[];
  widget: any[];
};

export const fetchDonationsPage = groq`
{
  "settings": *[_type == "site_settings"] {
    main_currency,
    main_locale,
    title,
  },
  "dashboard": *[_id == "dashboard"] {
    dashboard_slug {
      current
    },
    missing_name_modal_configuration
  },
  "page": *[_id == "donations"][0] {
    ...,
    aggregate_estimated_impact->{
      ...,
      "currency": *[ _type == "site_settings"][0].main_currency,
      "locale": *[ _type == "site_settings"][0].main_locale,
    },
    desktop_donations_table_configuration,
    mobile_donations_table_configuration,
    donations_details_configuration {
      ...,
      cause_area_impact_estimates[] {
        ...,
      },
      impact_items_configuration {
        ...,
        "currency": *[ _type == "site_settings"][0].main_currency,
        "locale": *[ _type == "site_settings"][0].main_locale,
        impact_item_configuration {
          ...,
          "currency": *[ _type == "site_settings"][0].main_currency,
          "locale": *[ _type == "site_settings"][0].main_locale,
        }
      }
    },
    slug {
      current
    }
  },
}
`;
