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

## Who changed what

Every row shows who changed it last and when.

## Checking the result

On Min Side, a donor who gave to the charity in a changed month sees the new figure. In a preview
environment (a PR with the `preview` label, see [preview-environments.md](preview-environments.md))
the same can be tried on synthetic data: the steps are in
[impact-api-migration.md › Phase 4 notes](impact-api-migration.md#phase-4-notes).
