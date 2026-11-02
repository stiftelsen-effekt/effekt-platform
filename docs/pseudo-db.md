# EffektPseudoDB: pseudonymised production data

`EffektPseudoDB` is a schema of read-only views over the production database `EffektDonasjonDB`.
It gives Claude (Claude Tag in Slack, through the analysis MCP connector at `/mcp`) and other
read-only consumers live, close-to-complete production data. People are not identifiable at a
glance, so answers can be posted in shared channels.

The policy is deliberately liberal. Amounts, dates, KIDs, agreements, distributions, referrals,
survey answers and internal notes are all there. What changes:

| Data                                                                                                         | In EffektPseudoDB                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E-mails, names, phone numbers, national ID numbers, donor bank accounts                                      | `<column>_hash`: a stable pseudonym such as `email_3f9c…`. The same value gets the same pseudonym in every table, so pseudonyms can be joined and counted. |
| `Donors.email`                                                                                               | also `email_domain` (gmail.com, a company domain, …) and `is_anonymous`                                                                                    |
| `Tax_unit.ssn` / `full_name`                                                                                 | `ssn_hash`, `full_name_hash`, plus `is_business`, `birth_year`, `gender`. The name is kept only for businesses (`business_name`).                          |
| Secrets (Vipps tokens, agreement links, fundraiser secrets, inflation tokens)                                | left out                                                                                                                                                   |
| Gift-card greetings, AutoGiro mandate name/address, raw bank payloads, import-log results containing e-mails | left out                                                                                                                                                   |
| `v_Tax_deductions`, backup tables, migration tables, `FB_donation_reports`                                   | no view                                                                                                                                                    |

The full rules are in [`scripts/pseudo-db/policy.mjs`](../scripts/pseudo-db/policy.mjs).

## How it works

- Pseudonyms are `SHA-256(key : kind : normalised value)`, truncated to 16 hex characters.
  The 256-bit key is in `EffektPseudoKey.hash_key`, and readers can't access it. Without the key,
  pseudonyms can't be reversed by guessing (national ID numbers and phone numbers would be easy to
  guess with a plain hash). Rotating the key changes every pseudonym; don't, unless it has leaked.
- The views belong to the locked account `pseudo_view_definer` (SQL SECURITY DEFINER), which can
  read `EffektDonasjonDB` and the key. Readers get only `SELECT` on `EffektPseudoDB`: they can't
  read the source tables, the key or the view definitions.
- Views are created from the live schema with an explicit column list, so **a new column or table
  appears only after the script is re-run**. The script refuses to run while a column whose name
  looks personal or secret (email, name, phone, ssn, token, message, …) is unclassified.

## Updating after a schema change

Re-run the script after migrations that add or rename tables or columns. It is idempotent.

```sh
# Cloud SQL proxy on 127.0.0.1:3306; root password from Secret Manager.
pnpm install
DB_USER=root DB_PASS="$(gcloud secrets versions access latest --secret=effekt-db-root-password)" \
PSEUDO_DB_READERS="mcp_readonly@%,claude@%" \
  node scripts/pseudo-db/apply.mjs            # --dry-run prints the SQL instead
```

If it stops with "Policy needs attention", classify the listed columns in `policy.mjs`:
`"keep"`, `"drop"`, `{ hash: "email" | "name" | "phone" | "ssn" | "bank" }` or `{ sql: … }`.

## Who can read it

| Account        | Used by                                                                            |
| -------------- | ---------------------------------------------------------------------------------- |
| `mcp_readonly` | the analysis MCP connector (`MCP_DB_USER` on the API); Claude Tag's data connector |
| `claude`       | local Claude Code sessions (the `mysql` MCP server)                                |

The MCP server lists both `EffektAnalysisDB` (default) and `EffektPseudoDB`
(`MCP_PSEUDO_DB_NAME`, default `EffektPseudoDB`). Its column blocklist (`answer`, `other_comment`,
`PaymentExternal_ID`) applies here too.
