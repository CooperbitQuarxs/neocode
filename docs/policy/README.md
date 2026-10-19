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

The settled interim meanings and at-least-daily proposal/review/apply procedure are in [triage-labels.md](../agents/triage-labels.md). This is not the completed global policy or setup-skill migration; existing issue assignments have not been bulk-reconciled.

- Composable type/context: `accessibility`, `bug`, `documentation`, `enhancement`, `idea`, `experiment`, `spec`. Existing `question` associations are retained pending reviewed cutover, not recommended for new assignments.
- Priority: `priority: p0` … `priority: p3`. Difficulty: the eight `difficulty: 0.000-0.125` … `difficulty: 0.875-1.000` intervals. Frame: `frame: hours`, `frame: days`, `frame: weeks`, `frame: months`, `frame: years`. Historical `effort: tiny` … `effort: very large` associations are retained pending individual review, not assigned to new triage or automatically converted.
- Issue triage: `needs-triage`, `needs-info`, `wontfix`; `ready-for-agent` and `ready-for-human` remain legacy markers pending evidence-based reconciliation. No replacement actor/reviewer names are selected.
- PR state remains `needs-review`, `ready-for-merge`, `review-stalled`. Accepted target `mergeable` means the existing repository gates are met, not permission to merge `main`. It is not deployed; keep `ready-for-merge` until parent policy and literal consumers migrate together. Review gates are unchanged.
- Source/relationship/disposition: `downstream`, `duplicate`, `entangled`, `hotfix`, `invalid`, `stale: identical`, `stale: similar`. `baseline` remains for defects found on the base during a PR; removal is undecided and it does not automatically imply upstream origin.
- Operational `upstream-sync` remains pending coordinated migration to accepted target `upstream`, meaning substantive upstream involvement beyond release synchronization. Do not create or rename it in isolation. Preserve existing associations of deselected non-operational labels pending reviewed cutover; use the [triage guide](../agents/triage-labels.md#composable-meanings) for exclusions from new assignments.
- `experiment` is newly created here, not a rename from a prior experimental-idea label. A label alone starts no work; experimental implementation needs an `experimental/` topic branch and a separate owner decision before landing on `nightly` or `main`.
- `downstream` now exists here too. Missing NeoPi capabilities still belong in `PsychedelicShayna/neopi` (see `AGENTS.md` › Fork rule); this availability does not change repository scope or authorize historical label bundles for new assignments.

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
