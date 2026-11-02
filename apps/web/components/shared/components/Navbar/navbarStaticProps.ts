import { groq } from "next-sanity";
import type { SanityImageObject } from "@sanity/image-url";
import { getClient } from "../../../../lib/sanity.client";
import { token } from "../../../../token";

// The navbar's Sanity data, apart from the component so Server Components (Min Side on the App
// Router) can fetch it without importing the client component.

export type NavLink = {
  _type: "navitem";
  _key: string;
  title?: string | null;
  pagetype?: string;
  slug?: string | null;
};

export type MainNavbarGroup = {
  _type: "navgroup";
  _key: string;
  title: string;
  items: NavLink[];
};

export type MainNavbarItem = NavLink | MainNavbarGroup;

export type NavBarQueryResult = {
  settings: {
    logo: SanityImageObject;
    main_navigation: MainNavbarItem[];
    donate_label: string;
    accent_color: string;
    main_currency: string;
    hide_dashboard_button?: boolean;
  };
  dashboard: {
    main_navigation: MainNavbarItem[];
    dashboard_logo: SanityImageObject;
    dashboard_label: string;
    logout_label: string;
  };
};

const query = groq`
{
  "dashboard": *[_id == "dashboard"][0] {
    dashboard_label,
    logout_label,
    dashboard_logo,
    main_navigation[] {
      _type == 'navgroup' => {
        _type,
        _key,
        title,
        items[]->{
          title,
          "slug": page->slug.current
        },
      },
      _type != 'navgroup' => @ {
        _type,
        _key,
        title,
        "slug": page->slug.current
      },
    }
  },
  "settings": *[_type == "site_settings"][0] {
    logo,
    donate_label,
    accent_color,
    main_currency,
    hide_dashboard_button,
    main_navigation[] {
      _type == 'navgroup' => {
        _type,
        _key,
        title,
        items[] {
          title,
          "slug": page->slug.current
        },
      },
      _type != 'navgroup' => @ {
        _type,
        _key,
        title,
        "slug": page->slug.current
      }
    }
  }
}
`;

export const getNavbarStaticProps = async ({
  dashboard,
  useDashboardLogo,
  draftMode = false,
}: {
  dashboard: boolean;
  draftMode: boolean;
  useDashboardLogo?: boolean;
}) => {
  // Fetched once per build by the client's build cache (lib/sanity.client.ts)
  const result = await getClient(draftMode ? token : undefined).fetch<NavBarQueryResult>(query);

  return {
    dashboard,
    useDashboardLogo: useDashboardLogo || null,
    data: {
      result,
      query,
    },
  };
};
