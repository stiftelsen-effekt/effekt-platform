import { groq } from "next-sanity";
import type { LinksProps } from "../../components/main/blocks/Links/Links";
import type { AggregatedImpactTableConfiguration } from "../../components/profile/donations/DonationsAggregateImpactTable/DonationsAggregateImpactTable";
import { linksContentQuery } from "../../lib/sanity/linkQueries";

// The tax page's Sanity content and types, shared by the pages router's TaxPage and the App Router
// (app/(minside)/minside-app/tax) while Min Side moves over.

export type FetchTaxPageResult = {
  settings: Array<{
    main_currency?: string;
    title?: string;
  }>;
  page: {
    title?: string;
    features?: TaxPageFeature[];
    slug?: {
      current?: string;
    };
  };
  dashboard: Array<{ dashboard_slug?: { current?: string } }>;
};

export interface TaxFeatureProps {
  _type: string;
  title: string;
  slug: {
    current: string;
  };
}

export type TaxUnitsData = TaxFeatureProps & {
  _type: "taxunits";
  tax_units_title?: string;
  create_tax_unit_button_label?: string;
  empty_tax_units_description?: string;
  empty_tax_units_link_label?: string;
  number_of_donations_label?: string;
  sum_donations_label?: string;
  sum_tax_deductions_label?: string;
  sum_tax_benefit_label?: string;
};

export type TaxDeductionData = TaxFeatureProps & {
  _type: "abouttaxdeductions";
  about?: any[];
  links?: LinksProps;
};

export type TaxStatementsData = TaxFeatureProps & {
  _type: "taxstatements";
  aggregate_estimated_impact: AggregatedImpactTableConfiguration;
};

export type TaxPageFeature = TaxUnitsData | TaxDeductionData | TaxStatementsData;

/** The tab for the path's last segment; the tax units when there is none */
export const selectedTaxFeature = (features: TaxPageFeature[], tab: string | undefined) =>
  features.find((f) => f.slug.current === tab) ??
  features.find((f) => f._type === "taxunits") ??
  null;

export const fetchTaxPage = groq`
{
  "settings": *[_type == "site_settings"] {
    main_currency,
    title,
  },
  "dashboard": *[_id == "dashboard"] {
    dashboard_slug {
      current
    },
  },
  "page": *[_type == "tax"][0] {
    ...,
    title,
    features[] {
      ...,
      _type == "abouttaxdeductions" => {
        ...,
        links {
          ...,
          ${linksContentQuery}
        }
      },
      _type == "taxstatements" => {
        ...,
        aggregate_estimated_impact -> {
          ...,
          "currency": *[ _type == "site_settings"][0].main_currency,
          "locale": *[ _type == "site_settings"][0].main_locale,
        }
      },
    },
    slug {
      current
    },
  },
}
`;
