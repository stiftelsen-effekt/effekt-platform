# Inflation adjustment

Recurring donors (AvtaleGiro and Vipps, Norway) can get an email offering to raise their monthly amount by the
inflation since the amount was last set. Nothing changes unless the donor accepts. Offers go out only when an admin
starts a round from **Agreements › Inflation adjustment**; nothing runs on a schedule.

Code: `apps/api/src/custom_modules/inflationadjustment.ts` (rules, SSB, prepare, send),
`DAO_modules/inflationadjustment.ts` (queries), `trpc/routers/inflation.ts` (admin procedures),
`routes/inflation.ts` (the email link), `mail.ts` `sendAgreementInflationAdjustment` (the email, MailerSend template
`MAILERSEND_INFLATION_ADJUSTMENT_TEMPLATE_ID`), admin page `apps/admin/src/routes/_app/agreements/inflation.tsx`.

## Who gets an offer

An active AvtaleGiro agreement or Vipps agreement (status `ACTIVE`) qualifies when all of these hold:

- **The amount was set at least 12 months ago** (calendar months, Europe/Oslo). The month the amount was set is the
  month after the latest confirmed donation from the agreement (same KID and payment method: AvtaleGiro 7, Vipps
  Recurring 8) whose sum differs from the agreement's current amount, or else the month the agreement was created
  (`Avtalegiro_agreements.created`, `Vipps_agreements.timestamp_created`). An accepted offer changes the amount, so it
  resets this too. AvtaleGiro amounts are stored in øre, Vipps amounts and donation sums in kroner.
  `Avtalegiro_agreements.last_updated` is not used: it is `ON UPDATE CURRENT_TIMESTAMP` and any bulk update moves it
  (the `20261030150000_avtalegiro_registered_mail_sent` backfill set it to 2026-10-30 for every agreement).
- **Inflation since then is at least 5 %**, from SSB's CPI calculator
  (`ssb.no/.../konsumprisindeksen/_/service/mimir/kpi`) from that month to the latest month SSB has published. Each
  start month is fetched once.
- **The new amount**, the current amount plus inflation rounded to the nearest 10 kr, **is at least 10 kr more**.
- **The agreement has no blocking offer**: one not sent yet (`new`, `sending`), one sent and still open (`pending`
  before `expires`), or one sent in the last 12 months (`pending`, `accepted`, `expired`). Older offers don't block.
- The donor isn't the anonymous donor (1464) and has an email address.

## Running a round

1. Open **Agreements › Inflation adjustment**. The page lists the agreements that qualify now with the current and
   proposed amount, inflation and months since the amount was set, and totals if everyone accepts.
2. **Prepare offers**: adds a `new` offer for each of them with the amounts shown. Nothing is emailed. Preparing again
   adds offers only for agreements without a blocking offer, so it never gives an agreement two open offers. It also
   marks sent offers whose time ran out as `expired`.
3. **Send emails**: choose how many (start with a few and check the email), confirm. The page sends them in batches
   of at most 25 per API call (the API's load balancer times out after 30 s), with a pause between batches and about
   500 ms between emails (MailerSend allows about 120 email requests a minute). Keep the page open; you can stop
   between batches and continue later.

Sending one offer: it is claimed (`new` → `sending`, so a repeated or parallel run never emails it twice), gets
`expires` = now + 30 days, is emailed, and becomes `pending` when MailerSend accepted the email or `failed` when not.
An offer whose agreement stopped or changed amount since it was prepared is `cancelled` instead of sent. Prepared
offers are best sent soon after preparing: their amounts are not recalculated.

Each prepare and send is logged in the import log as "Inflation adjustment" (counts only).

`GET /scheduled/inflation-reminder` (admin) only returns what a round would do now (counts and totals); it prepares
and sends nothing, and no Cloud Scheduler job calls it.

## Statuses

| Status      | Meaning                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------- |
| `new`       | Prepared, not emailed                                                                             |
| `sending`   | Claimed by a send. If it stays, the send stopped midway: check MailerSend; it is never sent again |
| `pending`   | Emailed, open until `expires`                                                                     |
| `accepted`  | The donor accepted and the agreement's amount was changed                                         |
| `expired`   | Not accepted in time (also the 2024 offers that were never sent, see the migration below)         |
| `cancelled` | Not sent: the agreement stopped or its amount changed after preparing                             |
| `failed`    | The email couldn't be sent. The agreement can get a new offer the next time offers are prepared   |
| `rejected`  | Not used                                                                                          |

Migration `20261031200000_expire_inflation_adjustments` marked the 2024 round's `new` and `pending` offers (expired in
Nov–Dec 2024) as `expired`; before that, their open status kept those agreements out of new rounds.

## The email link

`GET /inflation/agreement-update/:token` shows a confirmation page (link scanners fetch links with GET);
its form POSTs to the same URL, which applies the new amount (AvtaleGiro in the DB, Vipps through the Vipps API and
the DB) and redirects to the website's success page. An offer that has expired shows "Tilbudet har utløpt" and
changes nothing; unknown tokens and offers that were never sent go to the error page.
