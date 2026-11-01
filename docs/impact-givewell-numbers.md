# How to update GiveWell numbers

For ops. The impact donors see (Min Side, receipts, the results page, the intervention widget)
comes from GiveWell's cost per output, kept in the admin under **Impact**. Background:
[impact-api-migration.md](impact-api-migration.md).

## The rule

- A donation uses its charity's **latest estimate on or before the donation's month**. Before a
  charity's first estimate there is no figure.
- Money to the **Top Charities Fund** is split like the fund's latest grant on or before the
  donation's month, each part at that allotment's cost per output. All Grants Fund donations show
  no figure yet.
- Amounts are converted from US dollars with the ECB rate of the donation's day (Impact ›
  Exchange rates; filled by a daily job, nothing to do by hand).

So a new GiveWell number is a **new estimate from the month it applies to**, not an edit of the
old one: donations before that month keep the old figure. Edit an estimate only to correct it.

## A new cost per output for a charity

1. Impact › Cost estimates, open the charity (or ⌘K and its name).
2. **New estimate**. Fill in:
   - **Intervention**: what the money buys (starts as the current estimate's).
   - **From month**: `mm.yyyy`, the first month the number applies to. Usually the month GiveWell
     published it, or the month we decide to start using it.
   - **Cost per output** in US dollars as GiveWell gives it (`5,85`). Low and high end are
     optional.
   - **Source** and **Link**: the GiveWell page or spreadsheet, so the next person can check it.
3. Read **What changes for donors**: the cost before → after, the months whose figure changes
   and how many donations and donors that is.
4. **Add estimate…**, check the confirmation, **Add estimate**.

Min Side and the widget show the new number at once on the API instance that saved it, and on all
instances within 15 minutes. Receipts already sent are not changed; new receipts use it.

## Correcting or removing an estimate

- **Edit** (pencil on the estimate's row): same form; saving shows before → after and the
  donations affected. The charity can't change: add the estimate to the right charity and delete
  the wrong one instead.
- **Delete** (bin): the confirmation says what its months fall back to (the estimate before it,
  or none).

## A new Top Charities Fund grant

1. Impact › Fund grants › **New grant**. Fund: Top Charities Fund. **From month**: the first
   month donations should be split like it.
2. One **allotment** per charity (and intervention) GiveWell granted the fund's money to: the sum
   in US dollars and the number of outputs it buys, from GiveWell's grant page. The share of each
   is its sum over the grant's total, so the shares always add up to 100 %; cost per output is
   sum ÷ outputs. Both shown as you type.
3. **Add grant…**, check the split in the confirmation, **Add grant**.

Editing a grant keeps its allotments' IDs; removing a row removes that allotment. A grant's fund
can't change.

## Charities and interventions

Impact › Charities & interventions.

- A **charity** must be linked to the **organization** donors give to, or no donation uses its
  estimates (the charity page warns). One charity per organization.
- The **abbreviation** (AMF, SS, …) and every **ID** are fixed: the website's intervention
  widget blocks in Sanity and other organisations' calculators key on them. Fix a typo in an
  abbreviation by asking a developer.
- An **intervention**'s short text is what donors see ("Myggnett"); give it in each language. A
  language left empty shows the English.

## All Grants Fund grants

Impact › **All Grants Fund grants** and **AGF by year** show what GiveWell has published about
the fund: its money per year and organisation (from GiveWell's yearly metrics report) and its
single grants (from GiveWell's grant pages, the fund's page and the impact estimates sheet), with
cost-effectiveness, outputs and deaths averted where GiveWell gives them. It's reference data:
donations to the All Grants Fund still show no figure to donors, and nothing on these pages
changes that. GiveWell names the funder for only some grants; "Funder: –" means not published,
not "not the AGF". Background: [impact-api-migration.md › All Grants Fund
grants](impact-api-migration.md#all-grants-fund-grants-reference-data-2026-11-01).

The pages are read-only. The data comes in through `apps/api/scripts/agf-grants.ts` and a data
migration, which a developer runs:

- **Each August** (GiveWell publishes the year's metrics report): add the new year's sheet to
  `METRICS_SHEETS` in the script (the report PDF on givewell.org/about/impact links it; the AGF
  table is on the "Funds Directed" tab).
- **Each quarter** (new grant pages appear 6–9 months after the grant): refresh the grants.
- **When the funder of every grant is wanted**: on givewell.org/research/all-grants, filter the
  grants database by funder All Grants Fund and use **Download CSV**; pass the file with
  `--airtable-csv`. The script stops and lists the columns if they differ from what it expects.

```sh
cd apps/api
T() { node -r ts-node/register/transpile-only scripts/agf-grants.ts "$@"; }
T fetch --cache /tmp/agf-cache [--airtable-csv grants.csv] > /tmp/agf.json
T report /tmp/agf.json        # rows per year, figures, totals vs the metrics reports
DB_URL=mysql://readonly@127.0.0.1:3306/EffektDonasjonDB T diff /tmp/agf.json   # dry run
T sql /tmp/agf.json --by migration:<timestamp>_impact_agf_refresh \
  > prisma/migrations/<timestamp>_impact_agf_refresh/migration.sql
```

The SQL adds new rows and updates changed ones; rows corrected by hand in the database
(`updated_by` set) keep their values, and rows GiveWell no longer lists stay (the diff lists
both). Every new row appears in the change log with the migration as its author. Check `report`:
each year's rows should add up to the metrics report's AGF total.

## Who changed what

Every row shows who changed it last and when. **Impact › Change log** lists every change made in
the admin (newest first): who, when, what, and the values before → after. A charity's page and a
grant's page show their own history. Rows migrated from the old impact API show
"impact-api migration" as their creator; its own edit log was archived with the old database.

## Checking the result

On Min Side, a donor who gave to the charity in a changed month sees the new figure. In a preview
environment (a PR with the `preview` label, see [preview-environments.md](preview-environments.md))
the same can be tried on synthetic data: the steps are in
[impact-api-migration.md › Phase 4 notes](impact-api-migration.md#phase-4-notes).

## The November 2026 update

Migration `20261101233000_impact_givewell_update` (history rows by
`migration:20261101233000_impact_givewell_update` in Impact › Change log) corrected the Top
Charities Fund grants and added GiveWell's newest figures. Sources:
[Top Charities Fund](https://www.givewell.org/top-charities-fund) ("Using donations received in")
and GiveWell's impact spreadsheet, linked from
[impact-estimates](https://www.givewell.org/impact-estimates) ("Grants by funding opportunity":
cost per output per grant; "2024 Summary": the 2024 averages). Check the result with
`apps/api/scripts/impact-givewell-update.sql` (read-only).

- **Grant months** follow "Using donations received in": Oct 2023 (new grant, MC $57M), Jan 2024,
  Apr 2024 (AMF DRC), Jul 2024 (HKI, MC Karamoja and South Sudan, NI, AMF Q3 part), Oct 2024 (AMF
  Q4 part), Jan 2025 (NI, HKI), Apr 2025 (MC Chad, AMF Ituri), Jan 2026 (new grant, AMF DRC
  2027-29 at about $6 per net).
- **Allotments** whose cost per output differed by more than 5 % from GiveWell's figure for that
  grant, or whose sum was not the TCF amount, now hold GiveWell's sum and outputs (each row's
  comment says what it was). Among them two lost digits (AMF 2020: $49.50 per net; MC Jan 2024:
  $0.85 per child) and New Incentives grants of 2021–2023 at about half GiveWell's cost.
- **Estimates from Jan 2024**: AMF $6.10, MC $7.95, NI $136.30, HKI $2.52 (2024 averages).
- **Not changed**: SCI, DTW, SS, END, GD, UBI, NLS, PHC have no newer GiveWell estimate (GiveWell
  no longer publishes cost per output for them; cash transfers still use the 83 % from 2018).
  GDZF and GDCSF figures are GiveDirectly's own. The All Grants Fund is handled separately.
- **Still to enter** when GiveWell publishes the grant pages: the TCF grants from Q3 2025 (MC
  $5.8M, AMF $8.3M) and Q4 2025 (HKI $23.1M, AMF $8.8M + $9M). Until then those months use the
  grant from Apr 2025. Within GiveWell's range but not checkable against a published number:
  MC Chad (Jun 2025, $9.62 per child; the grant page gives about $8), NI Mar 2025 ($89.76;
  page: "over 170,000" children for $19.1M) and AMF Ituri (Aug 2025, $6.37 per net).
