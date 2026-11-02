import { groq } from "next-sanity";
import type { ProfilePageInfoConfiguration } from "../../components/profile/details/ProfileInfo/ProfileInfo";

// The profile page's Sanity content and type, shared by the pages router's ProfilePage and the App
// Router (app/(minside)/minside-app/profile) while Min Side moves over.

export type ProfilePage = {
  slug?: { current?: string };
  title_template?: string;
  info_configuration?: ProfilePageInfoConfiguration;
  info_title?: string;
  tax_subtitle?: string;
  tax?: any;
  tax_link?: string;
  data_subtitle?: string;
  data?: any;
  data_link?: string;
  read_more_label?: string;
};

export type FetchProfilePageResult = {
  settings: Array<{ title?: string }>;
  page: ProfilePage;
  dashboard: Array<{ dashboard_slug?: { current?: string } }>;
};

export const fetchProfilePage = groq`
{
  "settings": *[_type == "site_settings"] {
    title,
  },
  "dashboard": *[_id == "dashboard"] {
    dashboard_slug {
      current
    },
  },
  "page": *[_id == "profile"][0] {
    ...,
    slug {
      current
    },
  },
}
`;
