# Repository policy

This repository is self-contained: this file owns branches, commits, signing,
publication and merging. [pr-review-bots.md](pr-review-bots.md) owns review
mechanics; [triage.md](triage.md) owns tracker reconciliation.

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

- Merge commits only: `gh pr merge --merge --match-head-commit "$GATE_HEAD"`, binding the merge to the final authoritative `headRefOid` evaluated under the review gate. Subject: `Merge PR #<number>: <conventional PR subject> (@<author>)`.
- The authoring agent merges its PR into `nightly` after CI, acceptance, up-to-date base and the [Codex code-review gate](pr-review-bots.md) pass. Mark it `mergeable` only when these criteria hold. The owner alone decides promotion and hotfix merges into `main`.
- Contributor heads (any author other than the owner) are never executed on the owner's machine; see `docs/agents/pr-review-bots.md` › Running PR code.

Delegate every CI or review wait to a `openai-codex/gpt-6-luna` poller, which
reports exact-head results and failures to the integrator. The integrator moves
another actionable PR while the poller watches rather than blocking on a wait.

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

The `promote-nightly` workflow (`.github/workflows/promote-nightly.yml`) opens
a monthly `sync/promote-<date>` PR from `nightly` into `main`, or can be run by
hand with `gh workflow run promote-nightly.yml`. It leaves the PR open with
`human: pending`; the owner merges. Automation never merges a promotion.

`schedule` and `workflow_dispatch` triggers only run from the default branch,
so the workflow does nothing until it exists on `main`. The first promotion
after it lands is a manual `nightly` into `main` merge by the owner.

## Releases

- Tags and releases come from the release pipeline (`.github/workflows/release.yml`, which calls `release-desktop.yml` for packaging; `docs/operations/release.md`). A PR never creates a tag.
- Fork AppImage pre-releases are tagged `v<version>-preview.<YYYYMMDD>.<n>`, for example `v0.1.0-preview.20260930.1`: `<version>` is the app version, `<YYYYMMDD>` the build date, `<n>` a counter within that date. They are GitHub pre-releases titled `T3 Code + NeoPi <version>-preview.<YYYYMMDD>.<n> (Linux x86_64)`.
- Upstream's other channels keep their own schemes: stable `vX.Y.Z` and nightly `vX.Y.Z-nightly.<YYYYMMDD>.<run_number>` (see `docs/operations/release.md`).
- Version bumps arrive through upstream syncs.

## Labels

Use [triage-labels.md](triage-labels.md) for the composable vocabulary and
[triage.md](triage.md) for two-pass classification and daily reconciliation.
The review manual owns head-specific review state. Actor completion and
merge eligibility are distinct; issues remain open until full acceptance
and promotion to `main`.

## Commits and publication

Use small logical commits on topic worktrees based on freshly fetched
`origin/nightly`. Keep unrelated work intact. Resolve base drift by merging
the base into the topic branch, preserving provenance rather than rebasing.
After a PR merges or closes, remove its worktree and local topic branch.

Commit headlines use `type(scope): imperative summary` and at most 72
characters. Bodies explain the change, reason and verification actually run.
Use `Fixes #N` only when the full issue is satisfied; NeoCode closure still
waits for promotion. Every commit has `Model: <provider>/<model-id>` and
`Co-authored-by: <Model Name> <noreply@provider-domain>` trailers.
Agents sign each commit explicitly with
`git commit -S/home/shayna/.ssh/id_ed25519_github_signing_agents.pub -m "<short>" -m "<long>"`
and run `git verify-commit HEAD` before pushing. Review fixes are new signed
commits; retain published history and signing configuration.

One PR per issue, using `.github/PULL_REQUEST_TEMPLATE.md` exactly. Check only
true checklist items and explain skipped ones. Declare dependencies as
`Depends on #N` and merge in dependency order. Every issue and PR has a fitting
kind, priority and state; unclassified intake uses `needs-triage`. PR review
requirements and states follow the review manual rather than intake labels.

A topic branch with commits gets a PR in the same turn it is declared done;
[daily triage](triage.md#5-apply-and-reconcile) lists orphan branches.

Every GitHub comment, issue body or review reply starts with:

```md
> [!NOTE]
> <Model Name> on behalf of PsychedelicShayna
```

The authoring agent may push its topic branch, reply on its own PR, file
evidenced baseline issues discovered during review, apply supported labels,
and merge its PR into `nightly` when gates pass. Changes to other authors'
PRs, repository settings, rulesets and protection remain outside that
authority. Post only on the fork, never `pingdotgg/t3code`.

## Failed checks and recovery

Classify failures with evidence: head-only failures are fixed on the PR;
identical base/head failures become `baseline` issues with both outputs;
checks that pass locally on both are flaky, with those runs cited before a
rerun. If a local run is impossible, record the reason and evidence. Do not
retry hoping for green. A red check can be accepted only for an evidenced,
filed base defect. Project-wide checks belong to CI.

After merging, re-check other owned PRs against the new base. If a merge
breaks `nightly`, revert through a PR. Workflow changes exercised only on push
or dispatch stay single-purpose: watch the first applicable post-merge run
and revert through a PR on failure.

## Where the rest lives

| Topic                                          | File                                                                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Code conventions, package layout, verification | `AGENTS.md`                                                                                                            |
| Fork placement and compatibility checks        | `docs/agents/fork-maintenance.md`                                                                                      |
| Upstream sync procedure                        | `docs/agents/upstream-sync.md`                                                                                         |
| Review-bot mechanics                           | `docs/agents/pr-review-bots.md`                                                                                        |
| Issue tracker, funnel, triage                  | `docs/agents/issue-tracker.md`, `docs/agents/issue-funnel.md`, `docs/agents/triage.md`, `docs/agents/triage-labels.md` |
| Domain vocabulary                              | `docs/agents/domain.md`                                                                                                |
| Release workflow                               | `docs/operations/release.md`                                                                                           |
