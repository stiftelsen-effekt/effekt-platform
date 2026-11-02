/**
 * Which App Router route (`app/(minside)/minside-app/...`) serves a visible Min Side path.
 *
 * Min Side's paths come from Sanity and differ per site (NO `/min-side`, `/min-side/donasjoner`,
 * DK `/min-side/donationer`, ...), while the App Router's routes are fixed. The proxy
 * (`proxy.page.ts`) looks the path up here and rewrites it to the internal route.
 */

/** The internal prefix of the App Router's Min Side routes. Not reachable from outside. */
export const MINSIDE_APP_PREFIX = "/minside-app";

/** Min Side's paths on this site, from Sanity (path segments, without slashes) */
export type MinsidePaths = {
  dashboard: string[];
  donations: string[] | null;
  agreements: string[] | null;
  tax: string[] | null;
  profile: string[] | null;
  /** The page for donors with an anonymous Vipps agreement: no login */
  vippsAnonymous: string[] | null;
};

export type MinsideRoute = {
  /** The internal path, e.g. /minside-app/tax/arsoppgaver */
  path: string;
  /** Served without a session (the proxy doesn't send the visitor to the login) */
  public: boolean;
};

const isYear = (segment: string) => /^\d{4}$/.test(segment);

const startsWith = (path: string[], prefix: string[]) =>
  prefix.length > 0 && prefix.length <= path.length && prefix.every((p, i) => path[i] === p);

const below = (path: string[], prefix: string[] | null) =>
  prefix && startsWith(path, prefix) ? path.slice(prefix.length) : null;

const account = (path: string): MinsideRoute => ({
  path: MINSIDE_APP_PREFIX + path,
  public: false,
});

/**
 * The App Router route for a visible path, or null when it isn't Min Side. `segments` is the
 * decoded path without empty segments (`/min-side/donasjoner/` → ["min-side", "donasjoner"]).
 * As on the pages router, any other path below the dashboard shows the donations.
 */
export const appRouteFor = (segments: string[], paths: MinsidePaths): MinsideRoute | null => {
  if (!startsWith(segments, paths.dashboard)) return null;

  const vipps = below(segments, paths.vippsAnonymous);
  if (vipps?.length === 0) return { path: `${MINSIDE_APP_PREFIX}/vipps-anonymous`, public: true };

  const agreements = below(segments, paths.agreements);
  if (agreements?.length === 0) return account("/agreements");

  const profile = below(segments, paths.profile);
  if (profile?.length === 0) return account("/profile");

  const tax = below(segments, paths.tax);
  if (tax?.length === 0) return account("/tax");
  if (tax?.length === 1) return account(`/tax/${encodeURIComponent(tax[0])}`);

  const donations = below(segments, paths.donations);
  if (donations?.length === 1 && isYear(donations[0])) return account(`/donations/${donations[0]}`);
  return account("/donations");
};

export const pathSegments = (pathname: string): string[] =>
  pathname
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
