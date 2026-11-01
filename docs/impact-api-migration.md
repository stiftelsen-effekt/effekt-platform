# Moving the impact API into the platform

Status: **phases 0–4 done, phase 5 code merged; the load balancer switch is run by hand**
([runbook](#phase-5-switch-runbook); decisions settled 2026-11-01, see [Decisions](#decisions);
phase 0 runs as scripts by hand). The website no longer calls the impact API. Written
2026-10-30 from read-only inspection of the code, the GCP config, the load balancer logs and the
public API. No database was queried (the `Impact` schema needs the `impactapi` credentials, which
this plan did not read); row counts below come from the public API, which returns every row.

## Summary

The impact API (`stiftelsen-effekt/impact-api`, Django, Cloud Run `impact-api`, served as
`impact.gieffektivt.no`) holds GiveWell cost-per-output figures: **~160 rows in total** (60
evaluations, 26 grants with 46 allotments, 15 charities, 11 interventions). It has no imports or
scheduled jobs. The data is typed in by hand through Django admin, and the Cloud Run logs since
2026-08-03 show **no admin edits** (no `POST /admin/*`). The newest evaluation is from 2023 and the
newest Max Impact Fund grant from February 2025.

Its database is already on our Cloud SQL instance (`effekt-db`, database `Impact`, user
`impactapi`). The migration moves the schema next to `EffektDonasjonDB`, not across servers.

The main reason to do it is not hosting cost. Min Side works out impact **in the browser, one HTTP
request per organisation per month donated**. A donor who has given monthly to four charities for
four years sends ~190 requests to the impact API on a single page view. Measured today, that takes
**~16 s cold and ~6 s warm**, and the cold run returned a 500. With the data in our database, the
same numbers come from one SQL query in the API, sent with the donations Min Side already loads:
**0–1 extra requests and well under a second.**

Recommended order (details in [Phases](#phases)):

| #   | Phase                                                                       | Agent-hours | Visible change                  |
| --- | --------------------------------------------------------------------------- | ----------- | ------------------------------- |
| 0   | Decisions, freeze Django admin, archive its log                             | 1           | none                            |
| 1   | Tables + data migration + verification                                      | 3–4         | none                            |
| 2   | API reads local tables (receipts, results page) + exchange-rate table + job | 4–6         | receipts/results use local data |
| 3   | Min Side and the intervention widget on tRPC; full-stack e2e                | 5–7         | Min Side impact loads at once   |
| 4   | Admin pages to edit impact data                                             | 4–6         | ops edits in admin, not Django  |
| 5   | Compatibility REST on the main API, LB split 10 → 100 %                     | 3–4         | none (same URLs, same JSON)     |
| 6   | Decommission (after 30 quiet days)                                          | 1–2         | –                               |
|     | **Total**                                                                   | **~21–30**  |                                 |

Phases 1–3 deliver the performance win and can start as soon as the tRPC phase-2 PRs (#896–#901)
have landed. Phases 4 and 5 can run in parallel after phase 1.

## 1. What the impact API is today

### Models (Django app `api`, MySQL database `Impact`)

| Model                | Fields                                                                                                                                                                                                                                                     | Rows (public API)     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `Charity`            | `charity_name` (200), `abbreviation` (10, upper-cased on save; not unique in the DB)                                                                                                                                                                       | 15                    |
| `Intervention`       | `short_description` (100, unique), `long_description` (1000); both translated with django-modeltranslation into `_en`, `_no`, `_et`, `_sv`, `_dk` columns                                                                                                  | 11                    |
| `Evaluation`         | `charity` FK, `intervention` FK, `start_year`, `start_month`, `cents_per_output` (USD cents), `cents_per_output_lower_bound` (default 0), `cents_per_output_upper_bound` (nullable), `source_name`, `source_url`, `comment`. Unique (charity, year, month) | 60, 2013–2023         |
| `MaxImpactFundGrant` | `start_year`, `start_month` (unique together)                                                                                                                                                                                                              | 25, 2018-10 – 2025-02 |
| `AllGrantsFundGrant` | same as above                                                                                                                                                                                                                                              | 1 (2025-01)           |
| `Allotment`          | exactly one of the two grant FKs, `charity` FK, `intervention` FK, `sum_in_cents`, `number_outputs_purchased` (+ lower/upper bounds), `source_name`, `source_url`, `comment`                                                                               | 46                    |

Evaluations per charity: AMF 10, MC 8, HKI 7, DTW 7, SS 5, SCI 5, GD 4, UBI 4, NI 4, END 2, NLS, PHC,
GDZF, GDCSF 1 each. The AGF "grant" is one allotment of USD 1 = 1 output ("Dollars to GiveWell All
Grants Fund"). Django also has `auth_user`, `django_admin_log` and sessions. `django_admin_log` is
the only edit history; we archive it and do not migrate it.

### Endpoints

All `GET`, unauthenticated, CORS `*`. Every response is cached for a day in Datastore (kind
`APICache`, key = md5 of the view name + all query params), and saving a model clears the cache.

| Path                          | Params                                                                                                                                       | Response                                                                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/evaluations`            | `charity_abbreviation` (repeatable), `start_/end_year/month`, `donation_year/month/day`, `conversion_year/month/day`, `language`, `currency` | `{evaluations: [...]}` with `charity` and `intervention` nested, plus `converted_cost_per_output`, `exchange_rate_date`, `currency`, `language`; or `{errors}`, `warnings` |
| `/api/max_impact_fund_grants` | same, without charity                                                                                                                        | `{max_impact_fund_grants: [{id, start_year, start_month, language, allotment_set: [...]}]}`, with each allotment's `converted_sum` and `converted_cost_per_output`         |
| `/api/all_grants_fund_grants` | same                                                                                                                                         | `{all_grants_fund_grants: [...]}`                                                                                                                                          |
| `/admin/`                     | –                                                                                                                                            | Django admin (username + password, no SSO)                                                                                                                                 |

Semantics worth keeping in mind:

- With `donation_year`, the API returns, per charity, the **latest evaluation that starts on or
  before** the donation month. Without it, it returns all matching rows.
- Currency conversion uses **ECB rates** (the `CurrencyConverter` package, with a zip downloaded at
  boot) for the donation date, the conversion date or the evaluation's start. The default currency
  comes from `language` (`no` → NOK, `sv` → SEK, `et` → EUR, `en` → USD). `language=dk` without a
  currency raises a `KeyError` (500), because `dk` is missing from that map.
- Bug: the `start_/end_` filters compare months independently of years (for example, 2020-06 to
  2022-03 matches nothing). No real traffic uses these params (see below), so the replacement can
  fix it.
- Bug: concurrent cold starts race on `ecb_<date>.zip.part` (`FileNotFoundError`). That caused the
  500 in our cold Min Side run.

### Infrastructure

| Piece          | Value                                                                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service        | Cloud Run `impact-api`, europe-north1, 1 vCPU / 512 MiB, scale to zero, max 100, gunicorn 1 worker × 8 threads, ingress internal + LB, SA `sa-impact-api`             |
| Image / deploy | `gcr.io/hidden-display-243419/impactapi:latest`, Cloud Build trigger `impact-api-deploy` (`cloud.deploy.yaml`, also runs `migrate` and `collectstatic`)               |
| Database       | Cloud SQL `effekt-db` (MySQL 8.4), database `Impact`, user `impactapi`                                                                                                |
| Secrets        | `impact_api_db_name`, `impact_api_db_username`, `impact_api_db_password`, `impact-api-django-secret`                                                                  |
| Cache          | Datastore kind `APICache`                                                                                                                                             |
| Edge           | `effekt-api-lb` host rule `impact.gieffektivt.no` → backend `bs-impact-api` (serverless NEG), Cloud Armor `effekt-api-armor` (600/min per IP, preview SQLi/XSS rules) |
| Code           | Django 4.0 / Python 3.10 deployed (label `6e2e71e`); `main` has Django 5.2 / Python 3.13 and other fixes that are not clearly deployed (the image is `:latest`)       |

### Consumers

Request counts in the table are from LB logs, 2026-10-24 09:00 → 2026-10-30 20:40 UTC (6.5 days;
the LB went live on the 24th). There were 23,058 requests in total: 21,805 to `/api/*`, the rest
scanners and 404s. Latency through the LB was p50 0.32 s, p90 1.9 s and p99 8.1 s (cold starts).
The Cloud Run request logs for 2026-10-16 → 24 (28.8k requests) show the same mix. Traffic is
spiky and driven by preview builds: one day, 2026-10-23, had 19.7k requests, almost all widget
lookups from Vercel previews. A normal day has 1–3k requests, and over the 14 days ~52k requests,
~70 % of them from previews.

| Consumer                                                                                 | Where                                                                             | Calls                                                                                                    | 6.5-day volume                                                                                                           |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Intervention widget** (Sanity block, all sites, client side)                           | `apps/web/components/main/blocks/InterventionWidget/InterventionWidgetOutput.tsx` | `evaluations?charity_abbreviation=…&currency&language&conversion_year&conversion_month`                  | 15.7k (72 %): DK Vercel previews 12.1k, other previews 1.7k, gieffektivt.no 950, giveffektivt.dk 690, geeffektivt.se 260 |
| **Min Side, aggregate impact table** (NO, SE)                                            | `apps/web/components/profile/donations/DonationsAggregateImpactTable/`            | 1 × `max_impact_fund_grants`, plus 1 × `evaluations?…&donation_year&donation_month` **per org × month**  | together with the row below: 4.3k evaluation + 360 grant requests                                                        |
| **Min Side, per-donation impact** (NO, SE)                                               | `apps/web/components/profile/donations/DonationImpact/DonationImpactItem.tsx`     | 1 × `evaluations` per org per opened donation                                                            | (as above)                                                                                                               |
| **API: receipts** (first donation, every donation, inflation adjustment)                 | `apps/api/src/custom_modules/impact.ts` ← `mail.ts`                               | `evaluations` by donation + `max_impact_fund_grants` by donation (for TCF), plus Norges Bank for USD/NOK | ~260 (UA `node`)                                                                                                         |
| **API: results page** (`site.monthlyOutputs`, REST `/results/donations/monthly/outputs`) | `apps/api/src/custom_modules/monthlyOutputs.ts` (used at website build time)      | all evaluations + all MIF grants on every call, uncached                                                 | ~760 (UA `node`)                                                                                                         |
| One for the World impact calculator (third party)                                        | `One-for-the-World/impact-calculator` (pushed 2026-05)                            | `evaluations?charity_abbreviation…&donation_year&donation_month&currency`                                | small (`en`/EUR, USD)                                                                                                    |
| Annetame Targalt, "Kui rikas sa oled" (EE, third party)                                  | `eaeesti/kui-rikas-sa-oled`, `utils/impact.js`                                    | `evaluations?currency=EUR&language=et`; **keys on `charity.id`**                                         | small (`et`/EUR)                                                                                                         |
| Django admin                                                                             | `/admin/`                                                                         | –                                                                                                        | 11 GETs, 0 POSTs; no POSTs since 2026-08-03                                                                              |

Not consumers: the **Danish backend** (Min Side DK gets per-donation `impact` from
giveffektivt/donation-platform, and `DonationsAggregateImpactTable` skips the impact API when
`locale === "dk"`), but the **Danish website** does call it, through the intervention widget.
`effekt-data-analysis`, Sanity Studio, the tidbyt worker and `apps/admin` do not call it. **Sanity**
stores the charity **abbreviation** (`interventions[].abbreviation`) in intervention widget blocks.
The web also hard-codes an org-name → abbreviation map (`apps/web/util/mappings.ts`), and the API
maps `sight` ↔ `ss` in `monthlyOutputs.ts`. Those three are the cross-system references.

Three inconsistencies the migration should settle (see [Decisions](#decisions-needed)):

1. **Which evaluation applies to a donation.** The impact API, Min Side and receipts take the latest
   evaluation on or before the donation month. The results page (`monthlyOutputs.ts`) takes the
   first one **on or after** it, falling back to the last. The widget takes the newest by year only.
2. **Exchange rates.** Min Side and the widget use ECB (inside the impact API). Receipts and the
   results page use Norges Bank (fetched live on every call).
3. **Funds.** Impact for TCF is split by the latest MIF grant (newest 2025-02). Since the TCF → AGF
   switch on 2025-04-01 the MIF data is stale, and AGF shows no estimate on Min Side.

## 2. Performance today, and after

### Min Side today

`DonationsPage` renders `DonationsAggregateImpactTable` for the selected year or for all years. The
table groups the donor's donations by org and month in the browser, then fetches one evaluation
per (org, month) plus the MIF grants, and does the maths client side (`_util.ts`). Each expanded
donation then fetches again per org (`DonationImpactItem`, deduplicated by SWR only when the URL
matches).

Requests per page view: `1 + Σ_org (months with a donation to that org)`. Measured against
production from Oslo, at 50 in parallel (an HTTP/2 browser does about the same):

| Scenario (4 orgs × 48 months = 193 requests) | Wall time  | p50 / p90 / max per request | Errors                 |
| -------------------------------------------- | ---------- | --------------------------- | ---------------------- |
| Cold (instances scaling from zero)           | **15.9 s** | 2.8 / 7.0 / 9.2 s           | 1 × 500 (ECB zip race) |
| Warm (Datastore-cached keys)                 | **5.7 s**  | 1.0 / 1.6 / 2.0 s           | 0                      |
| A single cached request, for comparison      | 0.23–0.4 s | –                           | –                      |

Each request costs a Datastore lookup, Python serialization and an ECB conversion. One gunicorn
worker with 8 threads per instance makes bursts queue and scale out, and each new instance
downloads the ECB zip before it serves anything.

### Min Side after

Compute impact on the server, in the call Min Side already makes:

- **Recommended:** have `minside.donations` fill the optional `impact` field that the Danish
  backend already sends: `{recipient, unit, organization, amount, count}` per donation, already in
  the schema (`apps/api/src/trpc/shared/minside.ts`) and already rendered
  (`DonationImpact.tsx` and the `isDK` branch of `DonationsAggregateImpactTable`). Norway and
  Denmark then share one code path, and the client-side maths, the name → abbreviation map and the
  impact fetches go away. **Extra requests per page: 0.**
- Alternative: a separate `minside.impact({donorId, year?})` returning the aggregate table. That
  is 1 request, and is the better fit if we want per-year totals without shipping per-donation
  rows.

The SQL is one statement per donor. It joins the donor's donations → `Distribution_cause_area_organizations`
→ `Impact_charities` (by `Organization_ID`), and uses a `LATERAL` subquery (MySQL 8.4) to pick the
effective evaluation per (charity, donation month), or the grant's allotments for fund
organisations. It then joins `Exchange_rates` by date. Donors have at most a few hundred donations
and the impact tables ~160 rows, so we expect **< 50 ms** of database time (an estimate; verify in
phase 3 with the e2e donor and the largest real donor). A trivial tRPC query through the LB takes
0.5–1.0 s round trip from here today, so the page goes from **6–16 s and ~190 requests to < 1 s
and 0–1 requests**.

Precomputing a per-donation impact table is not needed at this size, and it would go stale
whenever an evaluation is edited or backdated. Revisit only if the measured p95 is over ~150 ms.

### The widget, the results page and receipts

| Path                  | Today                                                                                                 | After                                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Intervention widget   | 1 request to the impact API per page view (0.2–1.8 s, cold up to 8 s)                                 | `site.impactCosts({abbreviations, currency, language})` on the main API: one small in-memory-cached query, `Cache-Control: public, max-age=3600` |
| `site.monthlyOutputs` | 1.0–1.4 s and 186 KB; calls the impact API twice + Norges Bank on every call                          | local SQL + rates table, memoised for 15 min (or until an impact edit); it only runs at website build time                                       |
| Receipts (`mail.ts`)  | 2–3 HTTP calls per receipt (impact ×1–2, Norges Bank ×1); inflation adjustment does this per donation | in-process function, 0 HTTP calls                                                                                                                |

## 3. Target design

### Tables (Prisma migration in `apps/api/prisma`)

Names follow the existing schema (`Regrant_*`, `Fund_grants`: capitalised snake case, `ID`
primary keys, `X_ID` foreign keys, `created_at`/`created_by`). **IDs are kept** from the impact
API, because Annetame Targalt keys on `charity.id` and the compatibility responses expose every
`id`.

| Table                       | Columns                                                                                                                                                                                                                          | From                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `Impact_charities`          | `ID`, `name`, `abbreviation` (unique, upper case), `Organization_ID` (nullable, unique FK → `Organizations`)                                                                                                                     | `api_charity`                                             |
| `Impact_interventions`      | `ID`, `short_description` (unique, English), `long_description` (English)                                                                                                                                                        | `api_intervention`                                        |
| `Impact_intervention_texts` | `Intervention_ID`, `language` (`no`/`sv`/`et`/`dk`), `short_description`, `long_description`; PK (intervention, language). No row: the English texts apply                                                                       | the `_xx` modeltranslation columns                        |
| `Impact_evaluations`        | `ID`, `Charity_ID`, `Intervention_ID`, `valid_from` (DATE, first of month), `cents_per_output`, `_lower_bound`, `_upper_bound`, `source_name`, `source_url`, `comment`, `updated_at`, `updated_by`; unique (charity, valid_from) | `api_evaluation`                                          |
| `Impact_grants`             | `ID`, `fund` (`TCF` or `AGF`), `valid_from`, `legacy_id`; unique (fund, valid_from) and (fund, legacy_id)                                                                                                                        | both grant tables                                         |
| `Impact_grant_allotments`   | `ID`, `Grant_ID`, `Charity_ID`, `Intervention_ID`, `sum_in_cents`, `number_outputs_purchased` (+ bounds), `source_*`, `comment`                                                                                                  | `api_allotment`                                           |
| `Exchange_rates`            | `currency`, `date`, `per_usd` DECIMAL(18,8), `source`; PK (currency, date)                                                                                                                                                       | new (replaces the live Norges Bank calls and the ECB zip) |

Every table also has `created_by`/`created_at`, and the editable ones `updated_by`/`updated_at`.

Notes:

- The two grant tables become one with a `fund` column. MIF and AGF grant IDs overlap today (both
  start at 1), so the compatibility layer keeps a `legacy_id` per fund, or the ETL offsets AGF IDs
  and the compatibility layer maps them back. Either works; `legacy_id` is simpler.
- `Impact_charities.Organization_ID` replaces matching by abbreviation, the `sight`/`ss` hack and
  the web's name → abbreviation map. All 15 charities have an organisation in production; a
  charity without one would stay unlinked.
- Edit history: `updated_at`/`updated_by` on rows, and edits go to the API's existing logging, as
  other admin writes do. Evaluations are already versioned by `valid_from`; a GiveWell update is a
  new row, not an edit.

### Procedures

| Procedure                                                                  | Kind                | Replaces                                 |
| -------------------------------------------------------------------------- | ------------------- | ---------------------------------------- |
| `minside.donations` gains `impact` (or new `minside.impact`)               | `donorProcedure`    | the Min Side fetches                     |
| `site.impactCosts({abbreviations, currency, language, at?})`               | public, no batching | the widget fetch                         |
| `site.monthlyOutputs`                                                      | unchanged contract  | internal impact API calls                |
| `impact.evaluations.list / create / update / delete`                       | `adminProcedure`    | Django admin                             |
| `impact.grants.list / get / upsert` (with allotments) / `delete`           | `adminProcedure`    | Django admin (grant + inline allotments) |
| `impact.charities.*`, `impact.interventions.*` (with texts)                | `adminProcedure`    | Django admin                             |
| `custom_modules/impact.ts`: `effectiveEvaluation`, `grantSplit`, `convert` | functions           | `results.ts` HTTP helpers                |

Schemas go in `apps/api/src/trpc/shared/impact.ts` (zod only), exported as `@effekt/api/impact`.
On the Danish site, `site.impactCosts` must go to **our** API, not through `restLink`, because the
data is ours. That needs a small exception in `publicTrpcFor`, or a dedicated client.

### Admin (apps/admin)

A new nav group, **Impact**, after Regranting (organised by job, see `docs/admin-design.md`):

| Page                      | Template                   | Notes                                                                                                                                                                  |
| ------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cost estimates            | `ListPage` → `DetailPage`  | filters: charity, intervention, year. Detail shows the timeline of estimates per charity and which months each one covers                                              |
| Edit estimate             | form + `UnsavedChangesBar` | "moves money"-level risk (it changes what donors see for past gifts), so a `ConfirmDialog` showing before → after cost per output and the number of donations affected |
| Fund grants               | `ListPage` → `DetailPage`  | MIF/AGF grant with an editable allotments table; computed cost per output shown read-only                                                                              |
| Charities & interventions | `SettingsPage` sections    | link a charity to an Organisation; intervention texts per language side by side                                                                                        |

Permission: the existing admin role. Django's separate username/password accounts go away.

### Scheduled job

The impact data has no imports to port. The one new job is exchange rates: Cloud Scheduler
`ProcessExchangeRates` (daily 17:00 Oslo) → `functions/api-scheduled?type=exchangerates` →
`POST /scheduled/exchange-rates`, which fetches the day's rates (one source, see decisions) into
`Exchange_rates`. A one-off backfill from 2013 is part of phase 2. Readers fall back to the latest
earlier date, as the ECB package does today for weekends.

### Compatibility REST (for consumers we don't control)

Express routes for `evaluations`, `max_impact_fund_grants` and `all_grants_fund_grants` on the
main API, at `/impact/api/*` on every host and at `/api/*` when the Host is
`impact.gieffektivt.no` (see [Phase 5 notes](#phase-5-notes)). They reproduce the old JSON byte-shape:
every field, nested `charity`/`intervention`, `converted_*`, `exchange_rate_date`, `errors` and
`warnings`, the `language` → currency defaults (with `dk` → DKK added), and CORS `*`. They answer
with `Cache-Control: public, max-age=3600`. They belong in the "stays REST for good" group in
`docs/web-trpc.md`.

On `effekt-api-lb`, the `impact` path matcher gets route rules (as built in phase 5; a
`urlRewrite` would apply to both weighted backends, so there is none, and effektapi answers
`/api/*` itself on the impact host):

```
host impact.gieffektivt.no, header X-Impact-Backend: legacy → bs-impact-api (the diff's pin)
host impact.gieffektivt.no, prefix /api/
  → weightedBackendServices: bs-impact-api (100 → 0), bs-effektapi-impact (0 → 100)
everything else (/admin, /) → bs-impact-api until phase 6
```

The weights give a gradual cutover and a one-command rollback. The hostname, certificate and
Cloud Armor policy stay as they are. Keep the host **indefinitely**, since third-party embeds
rarely get updated.

## 4. Data migration

| Source (`Impact`)                                  | Target                            | Transform                                                                                       |
| -------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------- |
| `api_charity`                                      | `Impact_charities`                | same IDs; `Organization_ID` from a reviewed mapping list (by abbreviation, plus `SS` ↔ `sight`) |
| `api_intervention` (+ `_en/_no/_et/_sv/_dk`)       | `Impact_interventions` + `_texts` | same IDs; one text row per non-empty language                                                   |
| `api_evaluation`                                   | `Impact_evaluations`              | same IDs; `valid_from = DATE(start_year, start_month, 1)`                                       |
| `api_maximpactfundgrant`, `api_allgrantsfundgrant` | `Impact_grants`                   | `fund` = MIF/AGF; `legacy_id` = old ID                                                          |
| `api_allotment`                                    | `Impact_grant_allotments`         | same IDs; `Grant_ID` from whichever FK is set                                                   |
| `django_admin_log`, `auth_user`                    | not migrated                      | dumped to `gs://effekt-db-dump/impact/` with the final DB dump                                  |

**ETL.** The data is tiny, public and edited about once a year. Ship it as a **data migration**:
a one-off script reads `Impact` with a read-only user and writes a Prisma migration SQL file with
explicit IDs. The same rows then exist in prod, dev, e2e and previews with no cross-database
access in migrations. Re-generate the file if anything changes before merge (the Django admin is
frozen in phase 0, so nothing should).

**Verification.** The script prints per-table counts and a SHA-256 of a canonical JSON dump for
both sides; phase 1's exit criterion is that they match. Phase 5 adds an automated **dual-run
diff**: a daily Cloud Scheduler job asks the legacy API and our compat REST a fixed matrix of ~80
requests that covers every query shape in the LB logs and compares the answers byte for byte
(see [Phase 5 notes](#phase-5-notes)).

**References elsewhere.** No row in `EffektDonasjonDB` stores an impact API ID. Sanity stores
**abbreviations** (unchanged). Web and API code match by abbreviation or org name, and phases 2–3
replace that with `Organization_ID`. The only exposed numeric IDs are in the compatibility
responses, and those are kept.

**Regranting (later, out of scope).** `Impact_charities.Organization_ID` is the join point.
`Fund_grant_lines` and `Regrant_transfer_lines` (what we actually sent, per org/project and date) ×
`Impact_evaluations` gives "impact of money transferred", as opposed to impact of money donated.
`Projects` could later carry an `Intervention_ID`.

## 5. Phases, exit criteria and rollback

| Phase                   | Work                                                                                                                                                                                                                                                                                                                                  | Exit criteria                                                                                                | Rollback                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| **0 Prep**              | Decisions below; remove `is_staff` from Django users (freeze); dump `Impact` incl. `django_admin_log` to GCS; read-only DB user for the ETL                                                                                                                                                                                           | decisions recorded here; dump in GCS                                                                         | re-enable staff                                                            |
| **1 Schema + data**     | Prisma migration (tables + data), dev/e2e seed reuse the same rows, verification script                                                                                                                                                                                                                                               | counts and checksums match; migration green in CI and previews                                               | down-migration drops the new tables (nothing reads them yet)               |
| **2 API on local data** | `impact.ts` reads tables; receipts, `monthlyOutputs`, `Exchange_rates` + job + backfill; Vitest unit tests for the lookups, DB spec with real MySQL                                                                                                                                                                                   | receipts and `site.monthlyOutputs` equal old outputs for a fixed sample (snapshot test) within tolerance     | feature flag `IMPACT_SOURCE=remote` keeps the HTTP helpers for one release |
| **3 Web**               | `minside.donations.impact` (or `minside.impact`), `site.impactCosts`; web drops all `impact.gieffektivt.no` calls; Cypress `interceptTrpc` stubs; **full-stack e2e**: seed impact rows and assert Min Side totals, per-donation impact and widget output on known numbers                                                             | e2e green; Min Side impact on the e2e donor matches the old page; measured p95 of the new procedure < 150 ms | revert the web PR (the API keeps both)                                     |
| **4 Admin**             | Impact pages + procedures + tests (admin gate as in `docs/admin-building.md`)                                                                                                                                                                                                                                                         | ops person edits one estimate on a preview and sees Min Side change                                          | hide the nav group                                                         |
| **5 Compat + LB**       | Express compat routes, dual-run diff job, LB weights 10 % → 50 % → 100 % over ~1 week                                                                                                                                                                                                                                                 | 7 days at 100 % with a clean diff job, no new 5xx (the Cloud Run 5xx alert covers effektapi)                 | set weight back to `bs-impact-api` (seconds)                               |
| **6 Decommission**      | after 30 days with 0 requests to `bs-impact-api`: delete the Cloud Run service, serverless NEG + `bs-impact-api`, trigger `impact-api-deploy`, `gcr.io/…/impactapi` images, the 4 secrets, SA `sa-impact-api`, Datastore `APICache` entities, MySQL user `impactapi`, database `Impact` (after a final dump); archive the GitHub repo | `systemkart` and docs updated                                                                                | restore from the dump + redeploy the image (kept 90 days)                  |

Third parties: email One for the World and Annetame Targalt at phase 5. Their URLs keep working,
and nothing needs to change for them.

**Cost.** The direct saving is small: a scale-to-zero Cloud Run service with a few thousand
requests a day, Datastore reads, one serverless NEG and backend. The real saving is a second
stack we no longer patch: Django/Python upgrades, its own deploy pipeline, a separate admin login
outside Auth0, and an unclear deploy state.

## Risks

- **Donor-visible numbers change** when we settle which evaluation applies, which rate source we
  use and how AGF is handled. Each one is a product decision, not a bug fix. Ship them one at a
  time, after parity, and note them in the PR.
- **Shape drift for third parties.** Mitigated by the dual-run diff and by keeping IDs.
- **Danish site.** It is built from our code, so we control its widget calls, but its public tRPC
  client goes to the Danish backend by default. Phase 3 needs the exception described above.
- **Sweden.** `ge-effektivt` takes the tRPC path to `api.geeffektivt.se`, which runs an older
  backend. Its Min Side impact breaks there once the web stops calling the impact API. This is in
  line with "Sweden is phasing out Min Side", but say so to Sweden first.
- **Traffic.** ~3.4k requests a day move onto effektapi, most from Vercel preview builds of the
  Danish site. That is cheap with the 1-hour cache header, but the 600/min-per-IP Cloud Armor rule
  now applies to effektapi too: a preview build hammering the widget from one IP could throttle.
  Watch the `cloud_armor_denies` metric in phase 5.

## Decisions

Settled on 2026-11-01:

1. **Evaluation rule:** a donation uses the latest evaluation on or before its month, everywhere
   (as Min Side and receipts do today). The results page (`monthlyOutputs.ts`) changes to match.
   A month before a charity's first evaluation has no estimate.
2. **Exchange rates:** ECB everywhere (what Min Side and third parties see today): one
   `Exchange_rates` table, a daily job and a backfill from 2013. Receipts and the results page
   move from Norges Bank to ECB.
3. **AGF and stale data:** no behaviour change in this migration. AGF keeps "no estimate"; TCF
   keeps the latest fund grant's split. Missing or stale GiveWell numbers are filled in later,
   separately.
4. **Min Side:** the Danish shape: `impact` per donation on `minside.donations` (already in
   `apps/api/src/trpc/shared/minside.ts` and rendered for DK), plus a server-side aggregate, so the
   donations page loads in one call (phase 3).
5. **Sweden:** Swedish Min Side impact may stop working (the data lives only in the Norwegian
   database).
6. **Grant IDs:** a `legacy_id` column. Top Charities Fund grants keep their IDs; the AGF grant
   gets the next free ID.
7. **Freeze:** Django admin is frozen in phase 0 (staff flags removed, see below).
8. **Naming:** "Max Impact Fund"/MIF is called Top Charities Fund (TCF) in our tables, code,
   procedures, admin and UI text. The compatibility REST (phase 5) keeps the old paths and field
   names for third parties: `max_impact_fund_grants` ↔ `Impact_grants` with `fund = 'TCF'`,
   `all_grants_fund_grants` ↔ `fund = 'AGF'`, and each grant's `id` ↔ `legacy_id`.
9. **Third parties** (One for the World's impact calculator, Annetame Targalt keyed on
   `charity.id`) keep working unchanged: all IDs are kept.

### Phase 0 and 1 notes

- The dump of `Impact` (with `django_admin_log` and `auth_user`) is a Cloud SQL export to
  `gs://effekt-db-dump/impact/`, written by the instance's service account, so it needs no
  database password. The freeze removes `is_staff`/`is_superuser` from every Django user after
  saving the current flags in `Impact.auth_user_flags_backup_20261101`, and can be rolled back.
- The data migration (`prisma/migrations/20261101120000_impact_tables`) is generated from the
  public API by `apps/api/scripts/impact-data.mjs generate` rather than read across databases:
  our read-only user has no access to `Impact`, the effektapi user's grants on it were not
  checked (that needs an admin login), and a generated file gives the same rows, with the same IDs,
  in production, dev, e2e and previews. `scripts/impact-data.mjs verify` compares counts and
  SHA-256 checksums with the live API.
- Charity → organization links (all 15 exist in production): same abbreviation, except `SS` ↔
  `Sight`. `END` ↔ `End` and `DTW` ↔ `DtW` differ only in case. `prisma/devdata/impact.ts` repeats
  the list for the dev seed, because a fresh dev database gets its organizations after the
  migrations.

### Phase 2 notes

- Code: `apps/api/src/custom_modules/impact/` (data cache, rules, per-donation estimate, donor
  impact for Min Side, receipts) and `custom_modules/monthlyOutputs.ts`. Rates:
  `custom_modules/exchangeRates.ts` and `POST /scheduled/exchange-rates` (docs/functions.md).
- `IMPACT_SOURCE=remote` (API env) switches receipts and the results page back to the legacy
  impact API and Norges Bank for one release. Without NOK rates in `Exchange_rates` (before the
  first backfill) both fall back to the legacy path by themselves.
- Phase 3 entry points: `getDonationImpacts({donorId, year?, language?})` gives each donation's
  `impact` entries in the Danish shape, and `getDonorImpactSummary(...)` (or
  `sumImpactEntries`) the sums; two queries per call with the impact tables cached. Against the
  dev data, a donor with 3,688 donations took p95 93 ms (`src/__test__/DAO/impact.db.spec.ts`).
- What changes for donors, checked by `src/__test__/impact.snapshot.spec.ts` against recorded
  legacy answers: receipts scale by Norges Bank ÷ ECB rate (the legacy helper also took the rate
  of the first business day of a 31-day window, about a month before the donation); The END
  Fund, Deworm the World and Sightsavers now get receipt outputs (the legacy code compared
  abbreviations case-sensitively, `End` ≠ `END`). The results page moves to the latest evaluation
  on or before each month and the month's average ECB rate. On the production sums of
  2026-11-01 its totals moved by −0.7 % to +2.2 % per output (vitamin A +2.2 %, the most).
- Found on the way: the legacy API's Datastore cache key keeps only the last
  `charity_abbreviation` of a request (Django `QueryDict.items()`), so a request for several
  charities can get another request's cached answer, missing charities. Receipts (which ask for
  all of a donation's charities at once) have sometimes shown no figure for a charity because of
  it. The compatibility REST must not
  copy this.

### Phase 3 notes

- `minside.donations` sends each donation's `impact` (the Danish shape plus optional
  `organizationId`, so Min Side matches entries to the distribution's organizations without
  matching names, `description`, the output's long text that Min Side shows when
  a row is opened, and `viaFund`, whether the part was split by a fund's grant). The page's year and all-time impact tables sum those entries
  in the browser: the sum is the same as `sumImpactEntries` on the server, needs no second
  request, and works unchanged on the Danish site, whose backend already sends per-donation
  `impact`. A response-level aggregate would have changed the procedure's output from an array to
  an object (and the Danish REST contract with it) for no saving.
- A donation whose day has no exchange rate gets no `impact` field, and a failed impact lookup
  leaves the field out on every donation instead of failing the list; Min Side then shows the
  amounts without an estimate.
- `site.impactCosts` refuses to be batched (its `Cache-Control: public` header would cover the
  other answers in the batch) and answers any origin (CORS `*`, as the legacy API did), because
  the Danish and Swedish sites call it on the Norwegian API.
- The intervention widget calls `site.impactCosts` on the Norwegian API from all three sites
  (`impactTrpcFor`, docs/web-trpc.md). Sweden's own API has no exchange rates and the Danish
  backend no impact data, so pointing the Swedish widget at the Norwegian API was simpler than
  keeping it on the legacy API until phase 5. Swedish Min Side shows no impact (decision 5).
- Measured on the local e2e stack with the dev data and ECB rates (2026-11-01), the donations
  page went from `1 + Σ_org (months with a donation)` impact requests (19 for the e2e donor; 140,
  328 and 421 for three dev donors, 8.2 s and 13.1 s for the first two against production at 50 in
  parallel) to none: the figures come with `minside.donations`, whose p95 was 48 ms (7 donations),
  187 ms (63) and 375 ms (3,250; 100 KB gzipped).
- Min Side's numbers changed against the legacy page for three reasons, all per the decisions
  or bugs in the old browser code: (1) for money given directly, the old table took the _oldest_
  evaluation among those it had fetched for any month (a sort-then-`find` bug), so donors who
  gave across several GiveWell updates were shown older, mostly cheaper, costs: −48 % vitamin A
  for one dev donor, −13 % bednets for the e2e donor; with that bug fixed, old and new agree
  within 0–6 %; (2) the Top Charities Fund's share was converted at today's rate (the grants
  request had no donation date) and, before the grant, a month later than its start (a 0-based
  month), now the donation day's ECB rate and the grant's own month; (3) the old table dropped a
  fund grant's outputs for a charity when no evaluation matched that month, and rounded each
  part to whole kroner.

### Phase 4 notes

- Admin: Impact › Cost estimates, Fund grants, Charities & interventions, Exchange rates
  (`apps/admin/src/routes/_app/impact/`, procedures `impact.*` in
  `apps/api/src/trpc/routers/impact.ts`, reads and writes in `custom_modules/impactAdmin/`).
  Ops guide: [impact-givewell-numbers.md](impact-givewell-numbers.md).
- Validation (`trpc/schemas/impact.ts` + the router): one estimate per charity and month,
  cost > 0, low ≤ cost ≤ high, months as `YYYY-MM-01` from 2000 to two years ahead, source links
  http(s) (one per line; required for new estimates), an estimate can't move to another charity;
  grants: at least one allotment, every sum and output count > 0 (the split is sum ÷ total, as
  `grantSplit` computes it, so shares always add up to 100 %), one grant per fund and month,
  allotment IDs must belong to the grant, the fund can't change; charities: abbreviation
  `[A-Z0-9]{1,10}`, unique and fixed once created, one charity per organization; interventions:
  unique English short text, texts for `no`/`sv`/`et`/`dk` only. No procedure takes or changes an
  ID; a new grant gets its fund's next `legacy_id`.
- Every write runs in one transaction (grant + allotments, intervention + texts), sets
  `created_by`/`updated_by` (`adminIdentity`), and then clears `getImpactData`'s cache, the
  widget memo and the results-page memo on that instance (`afterImpactEdit`); other instances
  follow within 15 minutes.
- Audit: no admin table had a history pattern to follow (other admin writes keep `created_by`
  only), so the impact tables keep `created_by`/`updated_by` on rows plus `Impact_changes`
  (migration `20261101200000_impact_changes`): one row per create/update/delete with the row
  before and after as JSON, who and when, written in the edit's transaction (a failed history
  write fails the edit). No foreign keys, so a deleted row's history stays.
  `impact.changes.list` → Impact › Change log and the History sections.
- **Exit criterion, verified 2026-11-01 on the preview of #1036** (synthetic data, `preview`
  label, see [preview-environments.md](preview-environments.md)):
  1. Open the preview link from the PR comment, continue as **Ops**.
  2. Pick a donor who gave to AMF since January 2023: Donations, filter Organization = Against
     Malaria Foundation, open a donation, note the donor id. Min Side's figures for that donor are
     what `minside.donations({donorId})` returns as `impact` (a preview token from
     `POST /preview/session {"as":"ops"}`, which is an admin token and may read any donor). The
     main site's Vercel previews still talk to production, so the preview's own API is the Min
     Side to check (see "Later: the main site" in preview-environments.md).
  3. Impact › Cost estimates › Against Malaria Foundation › edit the estimate from Jan 2023:
     5,85 → 11,70 USD. The page and the confirmation said "From Jan 2023 (47 months so far),
     2 614 donations from 840 donors"; **Save estimate**.
  4. `minside.donations` again: the donor's AMF line went from 2,99 to 1,50 bed nets (half, as
     the cost doubled), at once, without a redeploy. The charity's History section and Impact ›
     Change log show the edit with Ops as its author (from #1038 on).
     The preview scales to at most two instances; the other instance shows the change within 15
     minutes (the cache's lifetime), as in production.

### Phase 5 notes

- **Routes** (`apps/api/src/routes/impactCompat.ts`, code in `custom_modules/impact/compat/`):
  `GET /api/{evaluations,max_impact_fund_grants,all_grants_fund_grants}` when the Host header is
  `impact.gieffektivt.no` (`IMPACT_COMPAT_HOSTS`), and the same at `/impact/api/*` on every host
  (`data.gieffektivt.no/impact/api/evaluations`, for checks and the diff). Host-based rather than a
  path prefix with an LB rewrite: a URL map `urlRewrite` applies to every weighted backend of a
  route, so the legacy service would get the rewritten path too. The LB passes the Host header
  through to Cloud Run, and `TRUST_PROXY_HOPS=2` is the same as for data.gieffektivt.no (same LB).
  CORS `*` (own headers; the global allowlist in `server.ts` is untouched), preflight answered,
  `Cache-Control: public, max-age=3600`, `X-Content-Type-Options: nosniff`, 300 requests a minute
  per IP and instance (Cloud Armor allows 600 per IP before that). They stay REST for good
  (docs/web-trpc.md).
- **Same bytes.** The answers are written as Django wrote them: Python `json.dumps` (`", "` and
  `": "`, `\uXXXX` escapes, `1.0` floats), the DRF serializers' field order and nesting, grant
  `id` = `legacy_id`, `max_impact_fund_grants` = TCF and `all_grants_fund_grants` = AGF
  (decision 8), `errors` (200) and `warnings`, `exchange_rate_date` = the requested day, the
  start/end filters comparing years and months separately, and MySQL's row order (with up to four
  `charity_abbreviation`s the rows came in index order (charity, month, year), with five or more
  or none in ID order; measured). Conversion is the Python `CurrencyConverter`'s: per-EUR rates,
  linear interpolation for days without a rate, first/last rate outside the series,
  `amount / rate(USD) * rate(X)`. The per-EUR rates are recovered exactly from `Exchange_rates`
  (USD per EUR has 4 decimals, the others at most 6; the stored per-USD values carry ≤ 5e-9 of
  rounding). Migration `20261101210000_exchange_rates_december_2012` adds December 2012, because
  evaluations from 2013-01-01 (a holiday) interpolate with 2012-12-31.
- **Golden tests** (`src/__test__/impactCompat.golden.spec.ts`): 82 requests recorded from the
  live API on 2026-11-01 by `apps/api/scripts/impact-compat-golden.ts` (each with a unique
  `cachebust`, see below), answered from the rows of the phase 1 migration and the recorded
  `Exchange_rates` rows, are identical **byte for byte**. They are pinned to the frozen data, so
  later data changes don't break them. The matrix (`compat/matrix.ts`): all 15 charities; `no`,
  `en`, `sv`, `et`, `dk`; NOK, SEK, DKK, EUR, USD, GBP, ISK, JPY; with and without donation month,
  day and conversion date; weekend and holiday days; one to five charities and repeats; the
  start/end filters; empty answers; unknown currency and language; both grant endpoints.
- **Deliberate differences**: `language=dk` without a currency answers in DKK (legacy: a 500);
  without `language` the answer is English (the legacy API reused the request thread's last
  activated language, so the same URL could come back in Estonian); malformed numbers or dates
  answer 400 `{"errors": [...]}` (legacy: a 500 page); currencies are the legacy ECB zip's that
  `Exchange_rates` has, so those that ended before 2013 (CYP, EEK, MTL, ROL, SIT, SKK, TRL) are
  rejected, and days before December 2012 use the first stored rate. **Not copied:** the legacy
  Datastore cache key kept only the last `charity_abbreviation`, so a request for several charities
  could get the cached answer of another request that ended with the same charity (seen live while
  building this: `charity_abbreviation=AMF&charity_abbreviation=AMF&cachebust=9` returned the AMF
  - MC answer of an earlier request). There is no answer cache; the data and rates are cached in
    memory for 15 minutes and edits clear them.
- **When our data moves on.** Admin edits (phase 4) and data migrations (corrected TCF windows,
  new GiveWell evaluations, AGF grants) change our answers on purpose; the legacy data stays
  frozen. The compat REST always answers in the legacy shape: `max_impact_fund_grants` lists every
  `Impact_grants` row with `fund = 'TCF'`, `all_grants_fund_grants` every `fund = 'AGF'` row (one
  today; with more AGF grants each one is another entry), each as
  `{id: legacy_id, allotment_set: [{id, intervention, converted_sum, currency,
converted_cost_per_output, exchange_rate_date, sum_in_cents, number_outputs_purchased, _lower_bound,
_upper_bound, source_name, source_url, comment, charity}], language, start_year, start_month}`.
  New columns in our tables are not exposed. A grant without `legacy_id` would show its own ID
  (the admin always assigns one).
- **Dual-run diff** (`custom_modules/impact/compat/diff.ts`): Cloud Scheduler `ImpactCompatDiff`
  (daily 06:30 Oslo) → `api-scheduled?type=impactdiff` → `POST /scheduled/impact-compat-diff`.
  It asks the legacy API through the LB with `X-Impact-Backend: legacy` (pinned to
  `bs-impact-api` by a route rule, so it keeps working at any weight; an answer without Django's
  `Content-Language` header counts as unreachable) and computes ours in-process, then compares the
  text. Differences are classified: `edited` when an `Impact_changes` row (admin edit or
  migration) touches an estimate, charity or intervention in either answer, or any fund grant for
  the grant endpoints; `legacy-language` for the language leak above; otherwise `unexpected`. The
  summary goes to Import_logs (`ImpactCompatDiff`); unexpected or unreachable requests (after one
  retry) are mailed to teknisk@. Chosen over a GitHub Actions cron because it needs no new
  credentials and reaches Import_logs and the alert mail directly.
- **Real traffic, 2026-10-24 → 11-01** (LB logs, 67.2k requests: 60.4k `evaluations`, 5.3k
  `max_impact_fund_grants`, 25 `all_grants_fund_grants`, ~200 scanner paths; counted by path,
  parameter names, `language`/`currency` values and user agent/referer class only):

  | Shape                                                                                   | Who (UA / referer)                                                                                | Count |
  | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----- |
  | `evaluations?charity_abbreviation×3&conversion_month&conversion_year&currency&language` | our widget before phase 3 (Vercel previews 43.7k, gieffektivt.no 3.7k, localhost, .dk, .se, bots) | 50.6k |
  | `evaluations?charity_abbreviation&currency&donation_month&donation_year&language`       | our Min Side before phase 3 (gieffektivt.no, localhost, .se), our API, curl                       | 8.1k  |
  | `max_impact_fund_grants?currency&language` (± `donation_year&donation_month`)           | our Min Side before phase 3                                                                       | 3.7k  |
  | `evaluations?language=NO`, `max_impact_fund_grants?language=NO`                         | our API (`node`) before phase 2                                                                   | 3.2k  |
  | `evaluations?currency=EUR&language=en`                                                  | server side (`node`, no referer); not ours                                                        | 65    |
  | `evaluations?charity_abbreviation&currency=GBP&donation_month&donation_year`            | One for the World (browser, referer 1fortheworld.org), no `language`                              | 1     |
  | `evaluations?currency=EUR&language=et`                                                  | Annetame Targalt's pattern; no request with its referer in the window                             | –     |

  Everything else was our own checks (`curl`, the phase 1 verify script, `cachebust`). Only
  `language` en/no/NO/sv/dk/et and currencies NOK, DKK, SEK, EUR, USD, GBP occurred.

### Phase 5 switch runbook

Run from the repo root with `gcloud` logged in as an owner. Every script is a dry run unless
given `--apply`, and `lb-weight.sh` exports the URL map to `~/impact-lb-backups/` before each
change and prints the exact rollback. **Rollback at any step:**
`scripts/impact-compat/lb-weight.sh --weight 0 --apply` (100 % legacy, seconds to minutes).

| Day | Step                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | `scripts/impact-compat/lb-backend.sh --apply` (NEG `neg-effektapi-impact` + `bs-effektapi-impact` with `effekt-api-armor` and full logging); then `lb-weight.sh --weight 0 --apply` (adds the rules, all traffic still legacy) and `scripts/impact-compat/lb-check.sh`: pin ok, legacy only |
| 1   | `lb-weight.sh --weight 10 --apply`; after ~5 min `lb-check.sh 60`: ~10 % effektapi, identical answers, CORS and cache headers present                                                                                                                                                       |
| 3   | if day 1–3 were clean: `lb-weight.sh --weight 50 --apply`, `lb-check.sh`                                                                                                                                                                                                                    |
| 5   | if clean: `lb-weight.sh --weight 100 --apply`, `lb-check.sh`: effektapi only                                                                                                                                                                                                                |
| 12  | 7 clean days at 100 %: phase 5 done. Email One for the World and Annetame Targalt (nothing to change for them). Phase 6 after 30 days with no `/api/*` requests to `bs-impact-api` (the diff's pinned requests excepted); remove the diff job then                                          |

What to watch after each step (first hour, then daily):

- **5xx and latency per backend**: Cloud Monitoring, metric
  `loadbalancing.googleapis.com/https/request_count` and `.../total_latencies` filtered on
  `url_map_name = effekt-api-lb`, grouped by `backend_target_name` and `response_code_class`.
  `bs-effektapi-impact` should show 0 5xx and a p95 well under the legacy one (no cold Python
  starts). The existing Cloud Run 5xx alert covers effektapi.
- **Logs**: `resource.type="http_load_balancer" resource.labels.backend_service_name="bs-effektapi-impact" httpRequest.status>=400`
  (429 = rate limited; check `jsonPayload.enforcedSecurityPolicy` for Cloud Armor denies).
- **Requests by consumer** (no personal data: path, query shape, user agent and referer class):
  `gcloud logging read 'resource.type="http_load_balancer" httpRequest.requestUrl:"impact.gieffektivt.no/api/"' --freshness=1d --format='value(resource.labels.backend_service_name,httpRequest.requestUrl,httpRequest.referer,httpRequest.userAgent)'`,
  grouped by backend, path and referer host; One for the World's referer is 1fortheworld.org.
- **Diff job**: Import_logs `ImpactCompatDiff` daily: `unexpected` and `unreachable` must be 0
  (`edited` is fine and expected after admin edits or data migrations). Run it on demand with
  `gcloud scheduler jobs run ImpactCompatDiff --location europe-west1`.
- **Cloud Armor**: the `effekt-api-armor` rules are the same on both backends (600/min per IP,
  path throttles that don't match `/api/*`, SQLi/XSS rules in preview), so coverage doesn't change.

### All Grants Fund grants (reference data, 2026-11-01)

Decision 3 stands: donations to the All Grants Fund still show no estimate on Min Side, receipts,
the results page and the widget, and nothing below changes them. What's new is that we **store**
what GiveWell publishes about the fund's grants, so we can decide later how to show it.

- **Why not `Impact_grants`.** Those rows split donors' money: a Top Charities Fund grant applies
  to the months from its `valid_from`, each allotment needs an output count, and the compatibility
  REST serves `fund = 'AGF'` rows as `all_grants_fund_grants`. The AGF is forward-funded (GiveWell
  doesn't tie a donation to a grant), most of its grants have no output count, and the legacy
  endpoint should keep its one frozen AGF row (its golden tests pin it). So the AGF data has its
  own two tables, read by nothing donor-facing:
  - `Impact_fund_portfolio`: the AGF's money per **metrics year** and organisation (and programme
    for 2022–2024), from GiveWell's yearly metrics report spreadsheets. Each year adds up to the
    report's AGF total (2025's rows are $1 under its rounded total).
  - `Impact_givewell_grants`: GiveWell **grants** recommended since August 2022 (when the AGF
    started), one row per grant write-up, plus grants GiveWell names as AGF grants without one.
    `funders` is `AGF` only where GiveWell names the fund; otherwise null (grant pages don't say
    who paid). Amount, months, location, cost-effectiveness multiple and benchmark, outputs, cost
    per output, deaths averted when published; `grant_type` is guessed from the title.
- **Sources** (all public): the metrics report sheets (2022–2025), the grant pages listed in
  givewell.org's sitemap, "Selected grants from the fund" on givewell.org/all-grants-fund, and
  the AGF rows of the impact estimates sheet. GiveWell's grants database (Airtable, filterable by
  funder) is the only source that names the funder of every grant; reading it from a script was
  blocked here, so `scripts/agf-grants.ts fetch --airtable-csv FILE` takes a CSV downloaded by
  hand instead (see impact-givewell-numbers.md).
- **Coverage on 2026-11-01**: 73 portfolio rows (2022: 9, 2023: 14, 2024: 18, 2025: 32; $15.5M,
  $24.4M, $38.4M, $129.6M) and 149 grants (by month recommended 2022: 14, 2023: 31, 2024: 50,
  2025: 47, 2026: 7). GiveWell names the AGF as funder for 9 of them (1, 3, 5, 0, 0 per year);
  77 have figures (69 a cost-effectiveness multiple, 23 deaths averted, 3 outputs and cost per
  output).
- **Loading**: the importer prints a snapshot (`fetch`), a dry-run `diff` against a database and
  upsert SQL (`sql`) for a data migration, keyed by slug and by fund + year + row. Rows edited in
  the admin keep their values; new rows get an `Impact_changes` row by `migration:<name>`
  (`entity` `agf_summary` / `givewell_grant`). First load: migrations
  `20261101230000_impact_agf_tables` and `20261101230100_impact_agf_data`.
- **Admin**: Impact › All Grants Fund grants (filters: year, funder named, figures, kind;
  search), Impact › AGF by year (filter: year), both read-only (`impact.agf.grants`,
  `impact.agf.portfolio`). Corrections go through the importer and a data migration.
- **Later, for donors (not built)**: a portfolio snapshot per year ("in 2025 the fund granted
  $129.6M to 32 organisations, the largest PATH, IRC and CHAI"), an exhaustive list of the
  fund's grants (a pull-down or table on the website or Min Side, from `Impact_givewell_grants`
  where `funders` names the AGF, once the grants database CSV fills it in), and a few highlighted
  grants with their figures. Each is a product decision; the "Hva støtter du gjennom Smart
  fordeling?" section of gieffektivt.no/smart-fordeling (four hand-picked grants in Sanity) is the
  obvious first consumer.
