# CI and deploy workflows

`ci.yml` runs on every pull request. Its `changes` job (`scripts/ci/changes.sh`) decides which
lanes the pull request touches; a lane without changes ends at once as `<app> · no change`, and
`CI (required)` sums up every lane.

| Lane                               | What                                                          |
| ---------------------------------- | ------------------------------------------------------------- |
| `admin · typecheck + test + build` | `apps/admin`, the same steps AdminDeploy runs after the merge |
| `functions · test`                 | `functions/*` that have tests                                 |

The other checks still run in their own workflows: `QualityAssurance` (Cloud Build), `web-checks`,
`web-e2e-fullstack`, `web-ci` (Cypress against the Vercel deployments: NO and DK e2e, SE smoke),
`semgrep` and `zizmor`. See [dependencies.md](dependencies.md#required-checks) for the required
checks.
