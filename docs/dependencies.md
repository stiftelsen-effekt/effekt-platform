# Dependencies

How dependency updates arrive, what merges on its own, and the rules that keep a compromised
package release out of the workspace.

## Release age: nothing younger than 7 days

A malicious release (a stolen npm token, a hijacked maintainer account) is usually found and
pulled from the registry within hours to a few days. Waiting a week before using a new version
avoids most of them, at the cost of getting fixes a week later. Security updates are exempt.

There are two layers:

| Layer                                     | Setting                                                                                                                         | What it covers                                                                                                                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pnpm                                      | `minimumReleaseAge: 10080` in `pnpm-workspace.yaml`                                                                             | Every install: `pnpm add`, `pnpm update`, `pnpm install` on a laptop, and `pnpm install --frozen-lockfile` in CI, Vercel and Cloud Build, which checks every lockfile entry. pnpm's built-in default is 1 day. |
| Dependabot `cooldown` in `dependabot.yml` | npm: 7 days for patch and minor, 14 for major; actions and Docker: 7 days for all (Dependabot has no per-semver cooldown there) | Which versions Dependabot proposes. For npm, Dependabot also reads pnpm's `minimumReleaseAge` and never goes below it.                                                                                         |

Patch updates wait as long as minor ones: a patch is no less likely to be the compromised
release, and most past attacks were patch releases. Majors wait two weeks because they are
merged by hand anyway, and the first weeks of a major are when regressions and follow-up fixes
appear.

Because the age is set explicitly, pnpm is strict about it (`minimumReleaseAgeStrict` defaults
to `true`): when no old-enough version satisfies a range, the install fails instead of quietly
taking a young one. To take a young version on purpose (an urgent fix), add its exact
`name@version` to `minimumReleaseAgeExclude` with a comment saying why, and remove the entry
once the version is older than 7 days. The block of entries dated 2026-10-31 there is the
switch from 1 to 7 days and can go from 2026-11-07.

### Other pnpm supply-chain settings

- `trustPolicy: no-downgrade` refuses a version published with weaker evidence than earlier
  versions of the same package (no trusted publishing or provenance where there used to be
  some). That is what a release from a stolen token looks like. Versions older than 30 days are
  not checked (`trustPolicyIgnoreAfter: 43200`). Exceptions go in `trustPolicyExclude`, by exact
  version and with a reason; check the package's changelog and publisher before adding one.
- `blockExoticSubdeps: true`: only our own `package.json` files may depend on git repositories
  or tarball URLs. A dependency's own dependencies must come from the registry.
- `allowBuilds` lists the only packages whose install scripts run. A new package that wants
  to run a script fails the install until someone decides `true` or `false` for it.

When an install fails with `MINIMUM_RELEASE_AGE_VIOLATION`, `TRUST_DOWNGRADE` or
`NO_MATURE_MATCHING_VERSION`, the rules are working: wait, pick an older version, or add a
reviewed exception as above. Don't turn the settings off.

## Dependabot

`.github/dependabot.yml` has three ecosystems, checked every Monday morning:

| Ecosystem        | What                                                              | Grouping                                                                                        |
| ---------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `npm`            | Every `package.json`, the catalogs, `pnpm-lock.yaml`              | `npm-reviewed` (the denylist below) and `npm-minor-patch` (everything else); majors one PR each |
| `github-actions` | The SHA-pinned actions in `.github/workflows`                     | One group for minor and patch; majors one PR each                                               |
| `docker`         | The base images in `apps/api/Dockerfile` and `Dockerfile.preview` | `docker-reviewed` (`node`) and `docker-minor-patch`; Node majors are ignored                    |

Dependabot runs pnpm 12 itself, keeps the two-document lockfile, and updates catalog entries
in `pnpm-workspace.yaml` rather than the packages' `package.json`.

The Node version is pinned in `.nvmrc`, both Dockerfiles and `compose*.yml`. A `node` image
update from Dependabot is never merged automatically: push the same version to `.nvmrc` and the
compose files on its branch (which also stops auto-merge for that PR), then merge by hand. A Node
major, `@types/node` majors and the other compose images (MySQL follows Cloud SQL) are planned
upgrades done by hand.

TypeScript majors are ignored as well (`ignore` in `dependabot.yml`): the API and the website
stay on TypeScript 5.9 until TypeScript 7 has a JavaScript API (see
[tooling.md](tooling.md#versions)). Moving the default catalog to 7 is done by hand, and so is
the `native` catalog's next major.

## What merges on its own

`.github/workflows/dependabot-auto-merge.yml` runs on Dependabot's pull requests. It approves
the PR and turns on auto-merge (squash) when:

- every update in it is a patch or minor update (`dependabot/fetch-metadata` reads them; for a
  grouped PR, each one is checked),
- none of the packages is on the denylist,
- Dependabot doesn't report a change of maintainers, and
- every commit on the branch is Dependabot's.

Auto-merge then waits for the required checks (below). Major updates, denylisted packages and
anything that fails those conditions stay open for a person.

The denylist: packages where a minor release can change production behaviour in a way the
tests don't catch.

| Packages                                | Why                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| `next`, `react`, `react-dom`            | Rendering, caching and routing of the websites                               |
| `prisma`, `@prisma/*`, `mysql2`         | Database access: generated queries, type casting, dates and decimals (money) |
| `@trpc/*`                               | The contract between the API, the admin and the website                      |
| `@auth0/*`, `express-oauth2-jwt-bearer` | Sign-in and token checks                                                     |
| `sanity`, `@sanity/*`, `next-sanity`    | The CMS and the Studio, which the tests barely cover                         |
| `node` (Docker image)                   | The runtime; kept in step with `.nvmrc` by hand                              |

The list is in the workflow (`DENYLIST`) and in the `*-reviewed` groups in `dependabot.yml`;
keep the two the same. The groups keep denylisted packages out of the big weekly PR so it can
still merge on its own.

When anyone else pushes to a Dependabot branch, the workflow turns auto-merge off for that PR.

### The approval

`main` requires an approval from a code owner, and only a person (a user account with write
access) can be a code owner: an approval from GitHub Actions or a GitHub App doesn't count, and
auto-merge doesn't use branch protection bypass lists. So the approval comes from a machine
user that is listed in `CODEOWNERS`. Its token is a **Dependabot secret**
(`DEPENDABOT_AUTOMERGE_TOKEN`), which GitHub only gives to workflow runs that Dependabot
triggered; workflows on other pull requests can't read it. Without the secret, the workflow does
nothing and Dependabot's PRs are merged by hand as before.

Setup (repository admin):

1. Create the machine user, give it write access to this repository, and add it to the `*` line
   in `.github/CODEOWNERS`.
2. Create a fine-grained token for it, limited to this repository, with Pull requests: read and
   write and Contents: read and write (enabling auto-merge needs both). Store it as the
   Dependabot secret `DEPENDABOT_AUTOMERGE_TOKEN` (Settings → Secrets and variables →
   Dependabot). Rotate it yearly.
3. Run the settings script (below): it turns on auto-merge for the repository, sets the
   required checks and adds the machine user to the users allowed to merge into `main`.

Merges by the machine user start the usual `push` workflows on `main` (a merge with
`GITHUB_TOKEN` would not).

## Required checks

Auto-merge waits only for the checks that branch protection requires. These are the ones to
require; each reports on every pull request:

| Check                                                                   | Source                                                                            |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `QualityAssurance (hidden-display-243419)`                              | Cloud Build: format, typecheck and tests of the API and admin                     |
| `web-checks (required)`                                                 | `web-checks.yml`: lint, typecheck and unit tests of the website                   |
| `web-e2e-fullstack (required)`                                          | `web-e2e-fullstack.yml`: Cypress against a local API and MySQL                    |
| `semgrep/ci`                                                            | `semgrep.yml`                                                                     |
| `zizmor`                                                                | `zizmor.yml`                                                                      |
| `Vercel – main-site`, `Vercel – giv-effektivt`, `Vercel – ge-effektivt` | The website builds on Vercel ("Canceled by Ignored Build Step" counts as passing) |

`web-checks.yml` and `web-e2e-fullstack.yml` used to be skipped by a `paths` filter, and a
required check that never reports blocks a PR forever. They now start on every pull request:
a `Changed paths` job decides whether the change touches what they cover, and the
`(required)` job passes when the checks passed or were skipped for that reason.

The Cypress runs against the Vercel previews (`web-ci.yml`, started by Vercel's
`deployment_status`) can't be required: they only exist when a preview was built. Dependency
PRs that touch the website still get the full-stack e2e run.

Dependabot runs don't get Actions secrets, so `semgrep/ci` runs only the repository rules on
them. To include the Semgrep app rules (and Supply Chain) on dependency PRs, add
`SEMGREP_APP_TOKEN` as a Dependabot secret as well.

## Repository settings

These are set once by a repository admin, not by a pull request: allow auto-merge, the required
checks above, the machine user among the users who may merge into `main`, and the Dependabot
secret. The pull request that added this page describes the script that applies them, which
prints the current and new values and saves the current branch protection for rollback first.
