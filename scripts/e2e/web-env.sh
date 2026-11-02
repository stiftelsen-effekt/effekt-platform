# Environment for apps/web against the full-stack e2e stack (compose.e2e.yml). Sourced by
# scripts/e2e-fullstack.sh (next build + start) and scripts/minside-local.sh (next dev), so both
# point the website at the same local API and OIDC issuer.
#
# Public, non-secret settings. Content comes read-only from the production Sanity dataset (no
# token needed); everything the browser talks to besides Sanity is local.

export E2E_WEB_PORT="${E2E_WEB_PORT:-3100}"
export E2E_API_PORT="${E2E_API_PORT:-5150}"
export E2E_AUTH_PORT="${E2E_AUTH_PORT:-8191}"
export E2E_DB_PORT="${E2E_DB_PORT:-3317}"

export NEXT_PUBLIC_SANITY_PROJECT_ID=vf0df6h3
export NEXT_PUBLIC_SANITY_DATASET=production
export NEXT_PUBLIC_EFFEKT_API="http://localhost:${E2E_API_PORT}"
export NEXT_PUBLIC_SITE_URL="http://localhost:${E2E_WEB_PORT}"
export NEXT_PUBLIC_AUTH_DOMAIN="http://localhost:${E2E_AUTH_PORT}"
export NEXT_PUBLIC_AUTH_CLIENT_ID=effekt-web-e2e
export NEXT_PUBLIC_AUTH_AUDIENCE=http://localhost:5050
export NEXT_PUBLIC_AUTH_USER_ID_CLAIM=https://gieffektivt.no/user-id
export NEXT_TELEMETRY_DISABLED=1

# Server-side sessions (apps/web/lib/auth0.ts, Min Side on the App Router) against the same mock
# issuer. It accepts any client secret; the session key is generated per run (sessions end when
# the web server restarts). Plain http is allowed only because the domain is localhost.
export AUTH0_DOMAIN="http://localhost:${E2E_AUTH_PORT}"
export AUTH0_CLIENT_ID=effekt-web-e2e
export AUTH0_CLIENT_SECRET=mock-issuer-accepts-any
export AUTH0_SECRET="${AUTH0_SECRET:-$(openssl rand -hex 32)}"
export AUTH0_AUDIENCE=http://localhost:5050
export APP_BASE_URL="http://localhost:${E2E_WEB_PORT}"

# The Danish site (MINSIDE_SITE=dk, `pnpm minside:local dk`): its public Sanity dataset (main_locale
# "dk", its own Min Side paths) and a local stub of its REST backend instead of our API
# (scripts/e2e/dk-backend-stub.mjs). Login still goes through the mock issuer.
export E2E_DK_API_PORT="${E2E_DK_API_PORT:-5151}"
if [ "${MINSIDE_SITE:-no}" = "dk" ]; then
  export NEXT_PUBLIC_SANITY_PROJECT_ID=2k8sn9h2
  export NEXT_PUBLIC_SANITY_DATASET=production
  export NEXT_PUBLIC_EFFEKT_API="http://localhost:${E2E_DK_API_PORT}"
fi
