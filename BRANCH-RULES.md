# Which branches may run the GitHub Actions

Last updated: 5 October 2026

This file is the single place to look when you want to change **which branches
or tags are allowed to run the workflows**. It tells you what the rules are
right now, and exactly which lines to edit for every common change.

## The rules right now

> Current state of this checkout: the working branch is **`2.0.0`** and
> `origin/main` is at an older commit, so pushing this branch starts no run and
> a tag on it would be rejected by the guard until the work is merged into
> `main`. Merge first, then tag `main`.

| Event | Runs the workflow? | Workflow | Enforced by |
| --- | --- | --- | --- |
| Push to `main` | Yes | `ci.yml` | `on.push.branches: [main]` + the `guard` job |
| Push to any other branch | **No** | — | `on.push.branches: [main]` (the workflow never starts) |
| Pull request (from any branch) | **No** | — | there is no `pull_request` trigger |
| Manual run (**Run workflow**) from `main` | Yes | `ci.yml` | the `guard` job |
| Manual run from another branch | **No** | — | the `guard` job stops it with a red ✗ |
| Tag `v*` whose commit is on `main` | Yes | `release.yml` | the `guard` job (ancestry check) |
| Tag `v*` whose commit is **not** on `main` | **No** | — | the `guard` job (ancestry check) |

Two things are worth understanding about how this is enforced.

1. **The `on:` block only limits when a workflow starts.** That is enough for
   ordinary branch pushes: a push to `feature/x` never even creates a run.
2. **A tag can be created from any branch**, so name filtering cannot stop it.
   `release.yml` therefore checks the *commit*: the tagged commit must be an
   ancestor of `origin/main`, otherwise the run fails with
   `is not on main. Tags must be cut from main.`

Every workflow has a `guard` job as its first job, and every other job declares
`needs: guard`. A guard failure therefore skips all the real work — a run from a
disallowed ref costs a few seconds and produces one clear error message instead
of doing anything.

## Files that decide this

| File | What it controls |
| --- | --- |
| [.github/workflows/ci.yml](.github/workflows/ci.yml) | The `on:` block at the top, and the `guard` job |
| [.github/workflows/release.yml](.github/workflows/release.yml) | The `on:` block at the top, and the tag `guard` job |

Nothing else in the repository affects this. In particular, `package.json`,
`biome.json` and the `test/` folder have no say in which branches run.

## How to change it

### 1. Allow a second branch, for example `develop`

**File:** `.github/workflows/ci.yml`

```yaml
on:
  push:
    branches: [main, develop]      # <- add the branch name here
  workflow_dispatch:
```

Then update the guard so it does not reject that branch. **File:**
`.github/workflows/ci.yml`, in the `guard` job:

```yaml
          case "$GITHUB_REF" in
            refs/heads/main)
              echo "On main: allowed."
              ;;
            refs/heads/develop)                      # <- add this block
              echo "On develop: allowed."
              ;;
            *)
              echo "::error::This workflow runs on main only. Got $GITHUB_REF. See BRANCH-RULES.md."
              exit 1
              ;;
          esac
```

Simpler alternative for two or three branches:

```yaml
          case "$GITHUB_REF" in
            refs/heads/main | refs/heads/develop)
              echo "On an allowed branch: $GITHUB_REF"
              ;;
            *)
              echo "::error::Only main and develop may run this workflow."
              exit 1
              ;;
          esac
```

You do **not** need to touch the other jobs: they already say `needs: guard`.

### 2. Run CI on pull requests again

Pull requests are deliberately not triggered today, so a feature branch costs
nothing. To check every pull request that targets `main`:

**File:** `.github/workflows/ci.yml`

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]               # <- add these two lines
  workflow_dispatch:
```

and allow the pull-request ref in the guard:

```yaml
          case "$GITHUB_REF" in
            refs/heads/main | refs/pull/*)
              echo "Allowed: $GITHUB_REF"
              ;;
```

> Note: `refs/pull/*` also matches pull requests from forks. Fork runs get a
> read-only token and cannot see your secrets, but they do consume your Actions
> minutes. Leave the `pull_request` trigger out if that matters to you.

### 3. Cut a release from a different branch, for example `release`

**File:** `.github/workflows/release.yml`, in the `guard` job, in the last step:

```yaml
          git fetch --no-tags origin release        # was: main

          COMMIT=$(git rev-parse "$REF^{commit}")
          if git merge-base --is-ancestor "$COMMIT" origin/release; then   # was: origin/main
            echo "$REF points at $COMMIT, which is on release."
          else
            echo "::error::$REF ($COMMIT) is not on release."
            exit 1
          fi
```

To accept **either** branch, fetch both and test both:

```yaml
          git fetch --no-tags origin main
          git fetch --no-tags origin release
          COMMIT=$(git rev-parse "$REF^{commit}")
          if git merge-base --is-ancestor "$COMMIT" origin/main \
            || git merge-base --is-ancestor "$COMMIT" origin/release; then
            echo "$REF is on an allowed branch."
          else
            echo "::error::$REF is not on main or release."
            exit 1
          fi
```

Keep `fetch-depth: 0` on the checkout step, otherwise the history needed for
the ancestry check is missing and the guard fails.

### 4. Allow a manual run from any branch (testing a workflow change)

This is the one case where you may want to relax the rule temporarily.

**File:** `.github/workflows/ci.yml`, in the `guard` job, change the condition to
also allow the event:

```yaml
          case "$GITHUB_REF" in
            refs/heads/main)
              echo "On main: allowed."
              ;;
            *)
              if [ "$GITHUB_EVENT_NAME" = "workflow_dispatch" ]; then
                echo "Manual run from $GITHUB_REF: allowed for testing."
              else
                echo "::error::Only main may run this workflow."
                exit 1
              fi
              ;;
          esac
```

Remove that exception again once you are done, so a stray branch cannot burn
Actions minutes or publish anything.

### 5. Pause everything for a while

- Quickest: rename the folder, for example
  `.github/workflows-disabled/`. GitHub only reads `.github/workflows/`.
- Or add `if: false` as the first line of a workflow's job list. The workflow
  still appears in the Actions tab but every job is skipped.

### 6. Change what a tag looks like

Tags are matched with `on.push.tags: ['v*']`, so `v1.0.1` triggers it and
`1.0.1` or `release-1.0.1` do not. To accept several shapes:

```yaml
  push:
    tags:
      - 'v*'
      - 'release-*'
```

Remember that `release.yml` compares the tag with `manifest.json` after
stripping a leading `v`, so a tag like `release-1.0.1` also needs that line
adjusted in the *Check the tag matches the manifest version* step:

```js
const tag = process.env.TAG.replace(/^(v|release-)/, '');
```

## How to check your change

First, the files have to exist on GitHub. A workflow that is not committed does
not run at all, so make sure `.github/workflows/ci.yml` and
`.github/workflows/release.yml` are committed and pushed:

```bash
git add .github BRANCH-RULES.md
git commit -m "Add GitHub Actions with branch rules"
git push
```

1. Edit the file in the tables above and commit it to `main`.
2. Open the **Actions** tab. The run for your commit should appear and pass.
3. Push a commit to a throwaway branch. **No run should appear** — that is the
   rule working, not a bug.
4. If you allowed another branch in step 1, push there and confirm the guard
   prints `On <branch>: allowed.`.

There is no way to run GitHub Actions on your machine, so the Actions tab is the
test. The workflow files themselves are plain YAML; a mistake such as a bad
indent shows up immediately as "Invalid workflow file" on that page, with the
line number.

## Related

- [README.md](README.md) — what the extension does and the local commands.
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to work on the code.
- [docs/README.md](docs/README.md) — the full documentation index.
