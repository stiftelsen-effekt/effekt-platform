import { groq } from "next-sanity";
import type { CauseAreaContext } from "../../components/shared/components/Widget/types/WidgetProps";

// The agreements page's Sanity content for the App Router
// (app/(minside)/minside-app/agreements), and its type, shared with the pages router's
// AgreementsPage while Min Side moves over.

export type AgreementsPageData = {
  title?: string;
  pending_agreements_box_configuration: {
    single_pending_agreement_title: string;
    multiple_pending_agreements_title_template: string;
    single_pending_agreement_text: string;
    multiple_pending_agreements_text_template: string;
  };
  active_list_configuration?: any;
  inactive_list_configuration?: any;
  slug?: { current?: string };
};

export type AgreementsPageContent = {
  page: AgreementsPageData | null;
  causeAreaContexts: CauseAreaContext[] | null;
};

export const agreementsPageQuery = groq`
{
  "causeAreaContexts": *[_type == "donationwidget"][0].cause_area_display_config.cause_area_contexts,
  "page": *[_id == "agreements"][0] {
    ...,
    active_list_configuration {
      ...,
      details_configuration {
        ...,
        date_selector_configuration->{
          ...,
        }
      }
    },
    slug {
      current
    }
  }
}
`;
