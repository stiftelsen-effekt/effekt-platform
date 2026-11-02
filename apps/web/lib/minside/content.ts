import "server-only";
import { groq } from "next-sanity";
import { cacheLife, cacheTag } from "next/cache";
import { getClient } from "../sanity.client";
import { getNavbarStaticProps } from "../../components/shared/components/Navbar/navbarStaticProps";
import { getFooterStaticProps } from "../../components/shared/layout/Footer/footerStaticProps";
import { fetchRouterContext } from "../../context/fetchRouterContext";
import {
  fetchDonationsPage,
  type FetchDonationsPageResult,
} from "../../pages/dashboard/donationsPageQuery";
import type { MainLocale } from "../../context/MainLocaleContext";
import {
  fetchProfilePage,
  type FetchProfilePageResult,
} from "../../pages/dashboard/profilePageQuery";
import { fetchTaxPage, type FetchTaxPageResult } from "../../pages/dashboard/taxPageQuery";
import {
  agreementsPageQuery,
  type AgreementsPageContent,
} from "../../pages/dashboard/agreementsPageQuery";

/**
 * Min Side's Sanity content for the App Router: the same for every donor, so it is cached
 * (`use cache`) and prerendered into the static shell. Publishing in Sanity rebuilds the site,
 * which starts a fresh cache; within a deployment an entry is refreshed after an hour.
 * No donor data here: that is never cached on the server (lib/minside/dal.ts).
 */

const siteQuery = groq`*[_type == "site_settings"][0] { "title": title, main_locale }`;

export async function getMinsideFrame() {
  "use cache";
  cacheLife("hours");
  cacheTag("sanity");

  const [navbar, footer, site, routerContext] = await Promise.all([
    getNavbarStaticProps({ dashboard: true, draftMode: false }),
    getFooterStaticProps({ draftMode: false }),
    getClient().fetch<{ title: string; main_locale: string | null }>(siteQuery),
    fetchRouterContext(),
  ]);
  return {
    navbar,
    footer,
    siteTitle: site.title,
    mainLocale: (site.main_locale ?? "no") as MainLocale,
    routerContext,
  };
}

export async function getDonationsPageContent(): Promise<FetchDonationsPageResult> {
  "use cache";
  cacheLife("hours");
  cacheTag("sanity");
  return getClient().fetch<FetchDonationsPageResult>(fetchDonationsPage);
}

export async function getAgreementsPageContent(): Promise<AgreementsPageContent> {
  "use cache";
  cacheLife("hours");
  cacheTag("sanity");
  return getClient().fetch<AgreementsPageContent>(agreementsPageQuery);
}

export async function getTaxPageContent(): Promise<FetchTaxPageResult> {
  "use cache";
  cacheLife("hours");
  cacheTag("sanity");
  return getClient().fetch<FetchTaxPageResult>(fetchTaxPage);
}

export async function getProfilePageContent(): Promise<FetchProfilePageResult> {
  "use cache";
  cacheLife("hours");
  cacheTag("sanity");
  return getClient().fetch<FetchProfilePageResult>(fetchProfilePage);
}
