# Repository policy

The workspace policy in `~/source/github/PsychedelicShayna/AGENTS.md` governs
branches, commits, signing, pull requests, merging, labels, and GitHub
posting. This file holds only the values that policy leaves to the repository.
Nothing here adds a confirmation step.

## Branches

| Role               | Branch    | Local checkout                                                                            | Ships as                                                                                                                                                                  |
| ------------------ | --------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default (promoted) | `main`    | `~/source/github/PsychedelicShayna/neocode`                                               | Releases are AppImage pre-releases (see [Releases](#releases)). The desktop entry `t3code-npi.desktop` runs `apps/desktop/scripts/start-electron.mjs` from this checkout. |
| Integration        | `nightly` | a topic worktree, or `~/source/github/PsychedelicShayna/neocode-nightly` when one is kept | Nothing installs from it. It is the base for topic branches and the source of promotion.                                                                                  |

- Topic branches: `git fetch origin && git worktree add ../neocode-wt-<slug> -b <type>/<slug> origin/nightly`.
- PRs target `nightly`. `hotfix/` PRs target `main` and are followed by a PR merging `main` back into `nightly`.
- Upstream (`pingdotgg/t3code`) releases merge on `sync/<date>` into `nightly`; procedure in `docs/agents/upstream-sync.md`.
- `main` and `nightly` are protected by the "Standard Protection" ruleset: a PR is required, merge commits only, no force-push, no deletion. Nothing is pushed to either branch directly.

## Merging

- Merge commits only (`gh pr merge --merge`). Subject: `Merge PR #<number>: <conventional PR subject> (@<author>)`.
- The authoring agent merges its own PR into `nightly` once the workspace gates pass. Review bots (`docs/agents/pr-review-bots.md`) are advisory and are requested at the agent's discretion. Docs-only and config-only PRs skip the bot and get a local review.
- Contributor heads (any author other than the owner) are never executed on the owner's machine; see `docs/agents/pr-review-bots.md` › Running PR code.

## CI

PR validation and CI on `nightly` and `main` use GitHub-hosted runners:
`ubuntu-24.04` for Linux and `macos-15` for mobile native static analysis.
The fork has no Blacksmith runners; inheriting upstream's runner labels left
every CI job queued instead of executing ([#23](https://github.com/PsychedelicShayna/neocode/issues/23)).
PR preview workflows use hosted runners too. Release, production mobile,
publish, and manual Windows lanes retain their existing runners; this decision
does not enable those lanes or make CI non-gating.

Classify completed failures against the base per workspace policy: fix
PR-caused failures on the branch; file matching base failures as `baseline`
issues with evidence.

## Promotion

`nightly` is promoted into `main` weekly by the `promote-nightly` workflow
(`.github/workflows/promote-nightly.yml`): it opens a `sync/promote-<date>`
PR from `nightly` into `main` and merges it when checks pass. The owner may
also run it by hand with `gh workflow run promote-nightly.yml`.

`schedule` and `workflow_dispatch` triggers only run from the default branch,
so the workflow does nothing until it exists on `main`. The first promotion
after it lands is a manual `nightly` into `main` merge by the owner.

## Releases

- Tags and releases come from the release pipeline (`.github/workflows/release.yml`, which calls `release-desktop.yml` for packaging; `docs/operations/release.md`). A PR never creates a tag.
- Fork AppImage pre-releases are tagged `v<version>-preview.<YYYYMMDD>.<n>`, for example `v0.1.0-preview.20260930.1`: `<version>` is the app version, `<YYYYMMDD>` the build date, `<n>` a counter within that date. They are GitHub pre-releases titled `T3 Code + NeoPi <version>-preview.<YYYYMMDD>.<n> (Linux x86_64)`.
- Upstream's other channels keep their own schemes: stable `vX.Y.Z` and nightly `vX.Y.Z-nightly.<YYYYMMDD>.<run_number>` (see `docs/operations/release.md`).
- Version bumps arrive through upstream syncs.

## Labels

- Type: `bug`, `enhancement`, `documentation`, `question`, …
- Priority: `priority: p0` … `priority: p3`. Effort: `effort: tiny` … `effort: very large`.
- Issue triage (meanings in `docs/agents/triage-labels.md`): `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`.
- PR state: `needs-review`, `ready-for-merge`, `review-stalled`.
- Other: `baseline` (defect found on the base branch during a PR), `upstream-sync`, `hotfix`, `entangled`, `neopi-upstream`, `codex-review`, `sentinel-review-requested`.
- The `downstream`, `rpc`, `t3c-npi` and `npi-deck` labels exist only in `PsychedelicShayna/neopi`. Missing NeoPi capabilities are filed there with them (see `AGENTS.md` › Fork rule).

## Where the rest lives

| Topic                                          | File                                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Code conventions, package layout, verification | `AGENTS.md`                                                                                   |
| Fork placement and compatibility checks        | `docs/agents/fork-maintenance.md`                                                             |
| Upstream sync procedure                        | `docs/agents/upstream-sync.md`                                                                |
| Review-bot mechanics                           | `docs/agents/pr-review-bots.md`                                                               |
| Issue tracker, funnel, triage labels           | `docs/agents/issue-tracker.md`, `docs/agents/issue-funnel.md`, `docs/agents/triage-labels.md` |
| Domain vocabulary                              | `docs/agents/domain.md`                                                                       |
| Release workflow                               | `docs/operations/release.md`                                                                  |
