# Repository policy

This repository follows `AGENTS.md` in the directory one level above it (the
directory containing this repository) for branches, commits, signing, pull
requests and merging. This file records repository-specific values.

## Branches

| Role               | Branch    | Local checkout                                    | Ships as                                                                                                                                |
| ------------------ | --------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Default (promoted) | `main`    | Main repository checkout                          | AppImage pre-releases (see [Releases](#releases)); the desktop entry runs `apps/desktop/scripts/start-electron.mjs` from this checkout. |
| Integration        | `nightly` | Topic worktree or a separate integration checkout | Nothing installs from it; base for topic branches and source of promotion.                                                              |

- Topic branches: `git fetch origin && git worktree add ../neocode-wt-<slug> -b <type>/<slug> origin/nightly`.
- PRs target `nightly`. `hotfix/` PRs target `main` and are followed by a PR merging `main` back into `nightly`.
- Upstream (`pingdotgg/t3code`) releases merge on `sync/<date>` into `nightly`; procedure in `docs/agents/upstream-sync.md`.
- `main` and `nightly` are protected by the "Standard Protection" ruleset: a PR is required, merge commits only, no force-push, no deletion. Nothing is pushed to either branch directly.

## Merging

- Merge commits only: `gh pr merge --merge --match-head-commit "$REVIEWED_SHA"`, binding the merge to the reviewed authoritative `headRefOid`. Subject: `Merge PR #<number>: <conventional PR subject> (@<author>)`.
- The authoring agent merges its PR into `nightly` after the workspace gates and [Codex code-review gate](../agents/pr-review-bots.md) pass: a complete, clean Code Review on the final head and every finding answered in its own thread. Do not request security rounds; already-posted security findings must be fixed or disproved.
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

Diagnostic startup must not outrun process ownership: establish the launcher's
identity before permitting application descendants. Failed process discovery
retains private state and never counts as successful cleanup.
Windows scratch uses verified local known-folder ancestry, not ambient TEMP:
a private child ACL alone cannot stop replacement through a shared parent.

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
