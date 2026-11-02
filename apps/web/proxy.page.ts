import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth0 } from "./lib/auth0";
import {
  appRouteFor,
  MINSIDE_APP_PREFIX,
  pathSegments,
  type MinsideRoute,
} from "./lib/minside/routes";
import { builtMinsidePaths } from "./lib/minside/sanityPaths";

export type ConsentState = "accepted" | "rejected" | "undecided";

const AUTH_ROUTES_PREFIX = "/auth/";
// Read from Sanity at build time (next.config.ts), not per request
const minsidePaths = builtMinsidePaths();

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Login, callback and logout for the server-side session (lib/auth0.ts)
  if (pathname.startsWith(AUTH_ROUTES_PREFIX)) {
    return auth0.middleware(request);
  }

  // Skip the proxy for special paths
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/studio") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.startsWith("/robots.txt") ||
    pathname.startsWith("/sitemap.xml") ||
    pathname.startsWith("/js/") ||
    pathname.startsWith("/images/") ||
    pathname.startsWith("/proxy/") ||
    // The design system's showcase (app/(design-system), apps/web/design-system)
    pathname === "/design-system" ||
    pathname.startsWith("/design-system/")
  ) {
    return NextResponse.next();
  }

  // Min Side, on the App Router: the Sanity path is rewritten to the internal route
  if (!pathname.startsWith(MINSIDE_APP_PREFIX)) {
    const route = appRouteFor(pathSegments(pathname), minsidePaths);
    if (route) return minsideApp(request, route);
  }

  // Everything else goes to the pages router, under the consent state. That includes a direct
  // request for the internal /minside-app routes, which the pages router doesn't have (404): they
  // are only reachable through the rewrite above.
  const url = request.nextUrl.clone();
  url.pathname = `/${consentStateOf(request)}${pathname}`;

  const response = NextResponse.rewrite(url);

  // Allow caching but require revalidation
  response.headers.set("Cache-Control", "private, must-revalidate");

  return response;
}

const consentStateOf = (request: NextRequest): ConsentState => {
  const cookieConsent = request.cookies.get("gieffektivt-cookies-accepted")?.value;
  if (cookieConsent === "true") return "accepted";
  if (cookieConsent === "false") return "rejected";
  return "undecided";
};

/**
 * A Min Side page on the App Router. The pattern follows nextjs-auth0's EXAMPLES.md ("Getting an
 * access token" > "Middleware", and the Server Actions note): this is the optimistic check, and
 * the pages check again in lib/minside/dal.ts.
 */
async function minsideApp(request: NextRequest, route: MinsideRoute) {
  // Rolls the session (a fresh cookie) when it's due
  const authResponse = await auth0.middleware(request);
  const session = await auth0.getSession(request);

  if (session) {
    try {
      // Refreshes the access token if it expires within tokenRefreshBuffer, and writes the new
      // session both to the response (Set-Cookie) and to this request's cookies, which are passed
      // on to the render below. Without a refresh this only reads the session.
      await auth0.getAccessToken(request, authResponse);
    } catch {
      // No usable refresh token (expired, revoked): log in again
      return toLogin(request);
    }
  } else if (!route.public && !isServerAction(request)) {
    // Logged out: straight to the login, before anything renders
    return toLogin(request);
  }
  // A Server Action without a session goes through: a redirect here would be followed silently by
  // the action's fetch. The action's own check (verifySession) redirects instead.

  const url = request.nextUrl.clone();
  url.pathname = route.path;
  // Forward the request headers, which now carry the refreshed session cookie, to the render
  const response = NextResponse.rewrite(url, { request: { headers: request.headers } });
  authResponse.headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (name !== "set-cookie" && !name.startsWith("x-middleware-"))
      response.headers.set(key, value);
  });
  for (const cookie of authResponse.headers.getSetCookie()) {
    response.headers.append("set-cookie", cookie);
  }
  // Personal data: never stored by a shared cache
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

const isServerAction = (request: NextRequest) =>
  request.method === "POST" && request.headers.has("next-action");

function toLogin(request: NextRequest) {
  // The SDK only follows a returnTo on our own origin
  const login = new URL("/auth/login", request.nextUrl.origin);
  login.searchParams.set("returnTo", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(login);
}
