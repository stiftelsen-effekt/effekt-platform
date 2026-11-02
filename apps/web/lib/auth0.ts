import "server-only";
import { Auth0Client } from "@auth0/nextjs-auth0/server";

/**
 * Server-side Auth0 sessions for Min Side on the App Router (docs/minside-ssr-plan.md).
 *
 * The session is an encrypted, httpOnly cookie on our own domain (`__session`, SameSite=Lax, Secure
 * on https). It holds the tokens; nothing reaches the browser's storage or JavaScript.
 *
 * Settings (server-only environment, one Auth0 application per site):
 *   AUTH0_DOMAIN         login.gieffektivt.no; locally the mock issuer, http://localhost:8191
 *   AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET
 *   AUTH0_SECRET         32+ bytes, encrypts the session cookie
 *   APP_BASE_URL         the site's origin (unset on previews: taken from the request)
 *   AUTH0_AUDIENCE       the API audience (falls back to NEXT_PUBLIC_AUTH_AUDIENCE)
 */

/** The ID token claim with the donor id (also in the access token, which the API checks) */
export const USER_ID_CLAIM =
  process.env.NEXT_PUBLIC_AUTH_USER_ID_CLAIM || "https://gieffektivt.no/user-id";

// Plain http is only for the local mock issuer (scripts/minside-local.sh, the full-stack e2e
// suite). Tied to the domain, so a production deployment can't switch it on by accident.
const isLocalMockIssuer = (domain: string) =>
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(domain);

const domain = process.env.AUTH0_DOMAIN ?? "";

export const auth0 = new Auth0Client({
  domain,
  allowInsecureRequests: isLocalMockIssuer(domain),
  authorizationParameters: {
    audience: process.env.AUTH0_AUDIENCE || process.env.NEXT_PUBLIC_AUTH_AUDIENCE,
    scope: "openid profile email offline_access",
  },
  // Token mediating backend: the API is called from the server only, so the browser never gets an
  // access token
  enableAccessTokenEndpoint: false,
  session: {
    rolling: true,
  },
  // The proxy refreshes the access token a minute before it expires, so a page never renders
  // with one that runs out mid-request (and Server Components never need to refresh it).
  tokenRefreshBuffer: 60,
  // Keep only what Min Side needs in the session. Without this hook the SDK keeps the standard
  // claims and drops our custom donor id claim.
  async beforeSessionSaved(session) {
    const { sub, name, given_name } = session.user;
    const donorId = Number(session.user[USER_ID_CLAIM]);
    return {
      ...session,
      user: {
        sub,
        name,
        given_name,
        // 0 is allowed: the Danish backend identifies donors by email and uses id 0 (docs/web-trpc.md)
        [USER_ID_CLAIM]: Number.isInteger(donorId) && donorId >= 0 ? donorId : undefined,
      },
    };
  },
});

/** The donor id of the logged-in user, or null (no session, or no donor id claim) */
export const donorIdOf = (user: Record<string, unknown> | undefined): number | null => {
  const id = user?.[USER_ID_CLAIM];
  return typeof id === "number" ? id : null;
};
