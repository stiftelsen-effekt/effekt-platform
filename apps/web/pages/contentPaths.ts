import { groq } from "next-sanity";
import { stegaClean } from "@sanity/client/stega";
import { getClient } from "../lib/sanity.client";

/**
 * Path helpers for the content pages (articles, results, fundraisers, the Vipps agreement page).
 *
 * These live apart from the page components, as pages/dashboard/paths.ts does for Min side, so
 * that the router context, which every page imports, does not pull the content pages and every
 * block type into the client bundle of the other pages.
 */

const fetchArticlesPageSlug = groq`
{
  "page": *[_type == "articles"] {
    "slug": slug.current,
  }[0]
}
`;

export const getArticlesPagePath = async () => {
  const { page } = await getClient().fetch<{ page: { slug: string } }>(fetchArticlesPageSlug);
  return page.slug.split("/");
};

const fetchResultsPageSlug = groq`
{
  "page": *[_type == "results"] {
    "slug": slug.current,
  }[0]
}
`;

// Sites without a results page in Sanity (e.g. geeffektivt.se) get null, so no results page is
// built and the results API isn't called.
export const getResultsPagePath = async () => {
  const { page } = await getClient().fetch<{ page: { slug: string } | null }>(fetchResultsPageSlug);
  if (!page?.slug) return null;
  return stegaClean(page.slug).split("/");
};

const fetchVippsAgreementPageSlug = groq`*[_id == "vipps"][0].agreement_page->slug.current`;

export const getVippsAgreementPagePath = async () => {
  const slug = await getClient().fetch<string | null>(fetchVippsAgreementPageSlug);
  return slug?.split("/") || null;
};

const fetchFundraisersSlug = groq`
{
  "settings": *[_type == "site_settings"][0] {
    fundraiser_page_slug
  }
}
`;

export const getFundraisersPath = async () => {
  const { settings } = await getClient().fetch<{ settings: { fundraiser_page_slug: string } }>(
    fetchFundraisersSlug,
  );
  return stegaClean(settings.fundraiser_page_slug).split("/");
};
