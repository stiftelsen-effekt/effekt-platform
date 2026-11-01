# Min Side: server-side sessions and the App Router (plan)

Status: **planned, not started** (decided 2026-11-01). This document is the brief for the agent or
developer who implements it. Read it fully, then `docs/web-trpc.md`, `docs/e2e.md`, `docs/website.md`
and `docs/ci.md`.

## Why

Min Side (`apps/web/pages/dashboard/**`, `apps/web/components/profile/**`) is a client-side app
inside the Next.js pages router. The website logs in with `@auth0/auth0-react` (tokens in memory,
silent login through an iframe on `login.gieffektivt.no`) and fetches data with tRPC from the API.

The loading work in #1041–#1049 already removed the blank screen, the layout shift, the request
waterfall and most CORS preflights. Measured locally (mobile profile: 150 ms latency, 1.6 Mbps, 4×
CPU slowdown): the page shell shows at ~0.85 s and content at ~2.9 s; on desktop content shows at
~0.33 s. Production adds Auth0's silent check (~0.2–0.6 s). The raw numbers are in the PR
descriptions of #1043–#1049.

Speed alone does not justify SSR (~13 real Min Side sessions a day). The reason to do it is the UX
it unlocks once **the server knows who the user is**:

1. **No "shell, then redirect"** for logged-out visitors: they get a 302 to login immediately
   (today: shell first, redirect after ~3 s on mobile).
2. **The first render contains the content** (no skeleton phase on first load; ~1.0–1.3 s on mobile
   instead of ~3 s).
3. **More robust sessions**: an httpOnly session cookie on our own domain instead of the silent
   iframe check, so fewer surprise logouts across browsers and privacy settings.
4. **Login-aware UI on the whole site without flicker**: the nav shows the donor's name or "Min side"
   at first paint; the donation widget can be prefilled for logged-in donors; public pages can show
   personal impact ("du har bidratt med X myggnett i år") now that impact comes from our own API
   (`custom_modules/impact`, `minside.donations`).
5. **Deep links that just work**, e.g. from emails ("se skattefradraget ditt", inflation offers)
   straight to a rendered page.

Interactions on the page (filters, expanding a donation, editing an agreement) stay client-side;
they are already fast.

## Constraints

- **Three sites, one codebase** (`docs/website.md`): NO gieffektivt.no (our tRPC API), DK
  giveffektivt.dk (Danish REST backend via the tRPC `restLink`, `docs/web-trpc.md`), SE
  geeffektivt.se (Min Side deprecated, must not break). Sanity's `main_locale` decides. Each
  site is its own Vercel project with its own Auth0 application settings.
- **The content site stays on the pages router** (Sanity-driven, statically generated:
  `pages/[state]/[[...slug]].page.tsx`); that is the right fit for it. **Min Side moves to the App
  Router** (`app/`), which can live in the same Next.js app as long as routes don't overlap. Min
  Side's path comes from Sanity and differs per site/locale, so a middleware rewrite maps the
  Sanity path onto the fixed `app/` route.
- **Security posture stays at least as strong**: no tokens or donor data in browser storage;
  httpOnly, Secure, SameSite=Lax cookies; CSRF protection on any cookie-authenticated mutation;
  the API keeps authorising every call (`donorProcedure`), never trusting a donor id from the web
  server without a verified token.
- **The API stays on Cloud Run behind effekt-api-lb + Cloud Armor** (decided earlier). Server-side
  calls from Vercel arrive from a few shared Vercel IPs: Cloud Armor's 600/min per-IP rule and
  `TRUST_PROXY_HOPS` must not start throttling or misattributing donors.
- **GDPR**: no new processors of donor data beyond Vercel (already processes the site); keep
  server logs free of personal data.

## Recommended architecture (verify in phase 0)

- **Sessions**: `@auth0/nextjs-auth0` (v4) with the existing Auth0 tenant and custom domain
  `login.gieffektivt.no`, one Auth0 application per site (or reuse today's SPA apps converted to
  regular web apps — decide in phase 0). Session cookie encrypted (`AUTH0_SECRET`), rolling.
  The session holds the access token for the API audience; refresh tokens stay server-side.
- **Rendering: App Router for Min Side** (decided 2026-11-01 — it's a dynamic, logged-in app, and
  the App Router is where Next.js is going):
  - `app/(minside)/…` with a persistent **layout** (Min Side nav/tabs) so moving between Min Side
    pages doesn't re-render the frame.
  - **React Server Components** fetch data on the server with the session's access token; **streaming
    with Suspense** sends the shell and nav at once and fills each section (donations, aggregates,
    impact, agreements, tax units) as its data arrives — no client waterfall and no all-or-nothing wait.
  - Interactive parts (filters, expanding a donation, editing an agreement, modals) stay client
    components (`"use client"`); reuse the existing components where possible.
  - Header/footer and Sanity-driven texts for Min Side are fetched in Server Components in the
    layout (same Sanity client, cached per request/tag).
  - A middleware rewrite maps each site's Sanity-defined Min Side path (e.g. NO `/min-side`, DK's
    equivalent) to the `app/` route; read the mapping from Sanity at build time (or a small cached
    lookup), and keep old paths working.
- **API access from the server**: tRPC client over HTTP to `data.gieffektivt.no` with
  `Authorization: Bearer <access token>` from the session. For Cloud Armor, add a signed header
  (shared secret in Secret Manager + Vercel env) that a Cloud Armor rule exempts from the per-IP
  limit, and rate-limit per donor in the API instead; keep the real client IP out of trust
  decisions.
- **DK**: `restLink` already uses `fetch`, so it can run on the server; confirm the Danish backend
  accepts the server-side token and that nothing depends on browser cookies there.
- **Mutations**: **Server Actions** that call the API with the session's token (Next.js checks the
  Origin header against the host for Server Actions — verify that covers our three domains and
  previews, and add an explicit check if not). Optimistic updates with `useOptimistic` where it helps;
  revalidate with `revalidatePath`/`revalidateTag`.
- **Vercel functions region**: `arn1` (Stockholm), closest to the API/DB in europe-north1.
- **Nav / personalisation on the pages-router content site**: a small session read (middleware
  sets a non-sensitive "logged in as <first name>" hint, or `getServerSideProps`/an edge read where a
  page is already dynamic) for a flicker-free nav at first paint — never the whole profile on every
  page, and keep content pages static/ISR (personal bits render client-side from the session hint
  or a tiny API call).

## Phases

0. **Spike (1–2 days, local only)**: nextjs-auth0 v4 against (a) the local mock OIDC issuer in
   the e2e stack and (b) the Auth0 dev/preview application; session cookie on localhost; one App
   Router page (`app/(minside)/donations`) rendering `minside.donations` in a Server Component with
   streaming; the middleware rewrite from the Sanity path; pages-router and App Router coexisting
   (shared styles/SCSS modules, fonts, providers); DK `restLink` on the server. Output: a short note on what works, the Auth0 application setup per site, and the
   chosen mutation approach. **Known risk**: nextjs-auth0 expects an Auth0 domain; if it can't
   talk to the mock issuer, use `openid-client` directly or add a mock-issuer mode — the local
   loop must keep working without real Auth0.
1. **Sessions + App Router skeleton**: login/logout/callback routes per site, session cookie, the
   `app/(minside)` layout with nav/header/footer, middleware rewrite, logged-out → redirect to login
   (in middleware, before rendering). The content-site nav reads the session hint (no flicker).
   auth0-react stays only where still needed until phase 2 is done.
2. **Min Side pages on the App Router**: donations, agreements, tax, profile as Server Components
   with Suspense streaming; mutations as Server Actions; remove the old `pages/dashboard/**` and
   auth0-react; skeletons only as Suspense fallbacks. Measure (the scripts in
   `scratchpad/pw` from the perf work: `measure2.mjs`, `shell.mjs` — copy them into
   `apps/web/scripts/perf/` in this phase).
3. **Infra**: Cloud Armor exemption header, per-donor rate limit in the API, Vercel region,
   Auth0 applications/callbacks for production and previews (see `docs/preview-environments.md`
   and the Auth0 preview app notes), monitoring.
4. **Personalisation** (separate decisions per item): widget prefill for logged-in donors; impact
   summary on public pages; deep links from emails.

## Fast local iteration (required)

The goal is to iterate locally and open a PR only when a phase is green locally — not to sit
waiting on CI. Everything needed runs on a laptop:

```sh
pnpm install
E2E_KEEP_UP=1 pnpm e2e:fullstack          # MySQL + seeded e2e donor + mock OIDC + API; keeps running
# web 3100, API 5150, OIDC 8191, MySQL 3317 (docs/e2e.md)
cd apps/web
pnpm dev                                   # next dev against the e2e API (set the env as e2e-fullstack.sh does)
pnpm exec cypress open --config-file cypress-fullstack.config.ts   # run single specs while coding
pnpm test --watch                          # Vitest
pnpm exec tsc --noEmit -p .                # typecheck (incremental)
# done for the day: pnpm e2e:env:down
```

- Use `pnpm e2e:fullstack --spec <spec>` / `E2E_SKIP_BUILD=1` to rerun quickly; the seed resets per
  spec (`resetE2EData`).
- Add full-stack specs for login → streamed page → logout, logged-out redirect, a Server Action
  mutation (incl. a cross-origin attempt being rejected), and
  a DK-locale render (restLink stubbed or a local DK fixture).
- Before pushing: `pnpm lint`, `pnpm typecheck`, `pnpm test`, the full-stack Cypress suite locally,
  and `next build` once. Then open the PR and let CI confirm (`CI (required)`, QA, semgrep, zizmor);
  don't push small fix-up commits one by one to watch CI.
- One PR per phase (phase 0 as notes in this document, no PR needed). Merge with the repo's usual
  flow; production checks after each merge (NO/DK login, SSR page renders, SE unaffected).
- Mind the machine: one e2e stack at a time; tear it down when done (`pnpm e2e:env:down`). The
  developer's Docker VM memory limit is ~4 GB.

## Measuring success

- Logged-out `/min-side`: 302 within one round trip (no shell).
- Logged-in first load (mobile profile): content painted ≤ ~1.3 s locally; desktop unchanged or
  better; CLS ≤ 0.02.
- No increase in 5xx or Cloud Armor denies on the API; no new personal data in logs.
- Field data: Web Vitals as Plausible custom events (LCP, CLS, INP, TTFB + "Min Side content ready"),
  bucketed, compared with the 2026-10 baseline. Set this up in phase 1 so there's a before/after.

## Out of scope

Moving the content site (pages router) to the App Router; moving the API to Vercel; Swedish Min
Side (deprecated).
