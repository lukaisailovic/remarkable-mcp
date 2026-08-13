# Releasing

How `@lukaisailovic/remarkable-mcp` gets a version bump, a git tag, an npm release, and moving GHCR tags — all from one GitHub Actions run, with no long-lived publish secrets.

## What a release does

A release is cut by running the **Release** workflow ([`.github/workflows/release.yml`](../.github/workflows/release.yml)) from the Actions tab. The job targets the `release` GitHub Environment, so each run shows up under **Deployments**. One run, in order:

1. Installs, then runs `fmt:check → lint → test → build`. A red gate stops the release.
2. Bumps `package.json` by the bump level you pick (`patch` / `minor` / `major`).
3. Refuses to continue if that version already exists as a git tag or on npm.
4. Commits the bump and pushes the commit + `vX.Y.Z` tag to `main` atomically.
5. Builds and pushes the image to GHCR: `:X.Y.Z`, `:X.Y`, and `:latest` (skipped for pre-releases), with a provenance attestation.
6. Publishes `@lukaisailovic/remarkable-mcp@X.Y.Z` to npm over OIDC trusted publishing, with provenance.
7. Creates a GitHub Release with generated notes.

The version is single-sourced from `package.json`. The git tag, the npm version, the image tag, and the MCP server's advertised version all read from it.

The rolling `:main` and `:sha-<commit>` images come from a separate workflow ([`docker-publish.yml`](../.github/workflows/docker-publish.yml)) on every push to `main`. Releases never touch those tags, and that workflow never produces version tags.

## One-time setup

### 0. First publish (bootstrap)

`@lukaisailovic/remarkable-mcp@0.1.0` is already on npm. Later first-time packages need a local publish before a trusted publisher can be attached:

```bash
pnpm install --frozen-lockfile
pnpm build
npm publish --access public
```

Then do the trusted-publisher setup below, and cut every later release through the workflow — no token again.

### 1. npm trusted publisher

On [npmjs.com → @lukaisailovic/remarkable-mcp → Settings](https://www.npmjs.com/package/@lukaisailovic/remarkable-mcp/access), add a trusted publisher. All fields are **case-sensitive and exact**:

| Field                | Value            |
| -------------------- | ---------------- |
| Publisher            | GitHub Actions   |
| Organization or user | `lukaisailovic`  |
| Repository           | `remarkable-mcp` |
| Workflow filename    | `release.yml`    |
| Environment name     | `release`        |

> Renaming `release.yml` breaks publishing until this entry is updated to match.

Once it works you can optionally turn on "Require two-factor authentication and disallow tokens" on the package — trusted publishing keeps working, only classic tokens stop.

### 2. GitHub environment

The workflow runs in a `release` environment (shown as a Deployment on the repo). GitHub creates it on the first run; add required reviewers under Settings → Environments → `release` if you want a manual approval gate before anything publishes.

### 3. GHCR visibility

The first image push creates `ghcr.io/lukaisailovic/remarkable-mcp` as a private package. To let others pull `:latest` / `:main`, set the package to public: GitHub → Packages → `remarkable-mcp` → Package settings → Change visibility.

### Branch protection

Step 4 pushes the bump commit to `main`. If `main` is protected, allow `github-actions[bot]` to bypass the pull-request requirement (Settings → Branches), or the push — and the release — will fail before anything is published.

## Cutting a release

1. Actions → **Release** → **Run workflow**.
2. Branch: `main`. Bump: `patch` / `minor` / `major`.
3. Optional: tick **dry_run** first. It runs the full gate, builds the image, and packs the npm tarball, but pushes and publishes nothing.
4. Run it.

That's the whole "bump → tag → publish" flow. No local `npm version`, no `git push --tags`.

## What ships

- **npm**: `@lukaisailovic/remarkable-mcp@X.Y.Z`, public, with a provenance statement linking it to this repo and workflow run. Installable with `npx -y @lukaisailovic/remarkable-mcp`.
- **GHCR**: `ghcr.io/lukaisailovic/remarkable-mcp` at `:X.Y.Z`, `:X.Y`, and `:latest`, with a provenance attestation.
- **git / GitHub**: a `chore(release)` commit on `main`, a `vX.Y.Z` tag, a GitHub Release, and a `release` environment deployment.

## Security model

- **No publish secrets** (after bootstrap). npm auth is OIDC trusted publishing — npm mints a short-lived token from the run's `id-token`. GHCR uses the run's `GITHUB_TOKEN`. There is no `NPM_TOKEN` in the repo.
- **Forks can't publish.** CI runs on `pull_request` with a read-only token and no secrets. `release.yml` and `docker-publish.yml` only trigger on maintainer dispatch or pushes to `main`, never on pull requests, so a fork PR can't reach the registry or npm.
- **Pinned actions.** Every third-party action is pinned to a full commit SHA; Dependabot ([`dependabot.yml`](../.github/dependabot.yml)) raises a weekly grouped PR to keep them current.
- **Least privilege.** Workflows default to `contents: read`; the release job elevates only the scopes it needs.
- **Workflows are linted.** Every PR runs `actionlint` and `zizmor` over `.github/workflows`, so changes to the CI/CD itself are checked for syntax and security regressions.

## Recovery

The preflight check makes the common footgun — re-running a release for a version that already shipped — fail fast with a clear message.

If a run dies after the tag push but before npm/docker finish, the tag exists, so a re-run aborts on preflight. Either finish that version by hand, or delete the tag and revert the bump commit, then re-dispatch:

```bash
git push origin :refs/tags/vX.Y.Z
git revert <bump-commit>   # or reset main if nothing else landed
```

Use **dry_run** to rehearse the pipeline end to end whenever you're unsure.
