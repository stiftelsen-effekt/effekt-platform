import { groq } from "next-sanity";
import type { NavLink } from "../../components/Navbar/navbarStaticProps";
import type { LinkType } from "../../../main/blocks/Links/Links";
import { getClient } from "../../../../lib/sanity.client";
import { token } from "../../../../token";

// The footer's Sanity data, apart from the component so Server Components (Min Side on the App
// Router) can fetch it without importing the client component.

export type FooterItem = NavLink | LinkType;
export type FooterProps = {
  _key: string;
  links?: FooterItem[];
}[];

export type FooterQueryResult = {
  _id: string;
  footer_columns?: FooterProps;
  footer_to_top_label?: string;
  footer_newsletter_heading?: string;
  footer_newsletter_form_url?: string;
  footer_newsletter_send_label?: string;
  footer_email_label?: string;
  main_locale: string;
};

const footerQuery = groq`
  *[_type == "site_settings"][0] {
    _id,
    footer_columns[] {
      _key,
      links[] {
        _type == 'navitem' => @ {
          ...,
          "slug": page->slug.current
        },
        _type == 'link' => @ {
          ...
        },
      }
    },
    footer_to_top_label,
    footer_newsletter_heading,
    footer_newsletter_form_url,
    footer_newsletter_send_label,
    footer_email_label,
    main_locale,
  }
`;

export const getFooterStaticProps = async ({ draftMode = false }: { draftMode: boolean }) => {
  const result = await getClient(draftMode ? token : undefined).fetch<FooterQueryResult>(
    footerQuery,
  );

  return {
    data: {
      result,
      query: footerQuery,
    },
  };
};
