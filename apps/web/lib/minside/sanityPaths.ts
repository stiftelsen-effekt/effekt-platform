import { createClient } from "@sanity/client";
import { projectConfig } from "../config";
import type { MinsidePaths } from "./routes";

/**
 * Min Side's paths on this site, read from Sanity once when the config loads (`next build`, `next
 * dev`) and inlined into the proxy as MINSIDE_PATHS (next.config.ts). The proxy does no data
 * fetching (Next.js: "Proxy is not intended for slow data fetching"). Publishing in Sanity
 * rebuilds the site, so a slug change still takes effect; `next dev` needs a restart.
 */
export async function fetchMinsidePaths(): Promise<MinsidePaths> {
  const client = createClient({ ...projectConfig, useCdn: false, perspective: "published" });
  const result = await client.fetch<{
    dashboard?: string | null;
    donations?: string | null;
    agreements?: string | null;
    tax?: string | null;
    profile?: string | null;
    vippsAnonymous?: string | null;
  }>(
    `{
      "dashboard": *[_id == "dashboard"][0].dashboard_slug.current,
      "donations": *[_id == "donations"][0].slug.current,
      "agreements": *[_id == "agreements"][0].slug.current,
      "tax": *[_type == "tax"][0].slug.current,
      "profile": *[_id == "profile"][0].slug.current,
      "vippsAnonymous": *[_id == "vipps"][0].anonymous_page->slug.current,
    }`,
  );
  const dashboard = split(result?.dashboard);
  if (dashboard.length === 0) throw new Error("Min Side: no dashboard slug in Sanity");
  const below = (slug: string | null | undefined) => {
    const segments = split(slug);
    return segments.length ? [...dashboard, ...segments] : null;
  };
  return {
    dashboard,
    donations: below(result?.donations),
    agreements: below(result?.agreements),
    tax: below(result?.tax),
    profile: below(result?.profile),
    vippsAnonymous: below(result?.vippsAnonymous),
  };
}

const split = (slug: string | null | undefined) => (slug ? slug.split("/").filter(Boolean) : []);

/** The paths inlined at build time (next.config.ts) */
export const builtMinsidePaths = (): MinsidePaths => {
  const value = process.env.MINSIDE_PATHS;
  if (!value) throw new Error("MINSIDE_PATHS is missing: it is set by next.config.ts");
  return JSON.parse(value) as MinsidePaths;
};
