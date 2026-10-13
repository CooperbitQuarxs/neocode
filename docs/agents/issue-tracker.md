# Issue tracker: GitHub

Issues and specs for this repo live in GitHub Issues at `PsychedelicShayna/neocode` (fork of `pingdotgg/t3code`). `origin` is the fork, `upstream` is pingdotgg; `gh repo set-default` points at the fork. Always pass `-R PsychedelicShayna/neocode` when in doubt. Never file issues, comments, or PRs on `pingdotgg/t3code`.

## Conventions

- Create: `gh issue create -R PsychedelicShayna/neocode --title "..." --body-file <path> --label ...`.
- Read: `gh issue view <number> --comments`, including labels.
- List: `gh issue list --state <state> --json number,title,body,labels,comments` with the filters the task requires.
- Apply or remove labels: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- Close an issue when the fix merged, when it is a verified duplicate, or when the owner said so. Say why in the closing comment. `Fixes #<n>` closes an issue only when the commit reaches the default branch `main`, so after a merge into `nightly` close the issue by hand, citing the PR and merge commit.
- Posting rules (comment identity block, labels) are the workspace policy in `~/source/github/PsychedelicShayna/AGENTS.md`. This guide is mechanics only.
- Upstream `AGENTS.md` still applies: implementation plans and scratch notes stay out of the worktree; the issue owns the checklist, the merged PR is the record.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Skill meanings

- "Publish to the issue tracker" means create a GitHub issue on the fork.
- "Fetch the relevant ticket" means read the GitHub issue, its comments, and labels.

## Dual taxonomy

House labels (type, `effort: *`, `priority: *`, and `entangled` only for true alternative clusters) and Matt triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) are **orthogonal layers**, not replacements. An issue may carry both. Do not strip house labels to be Matt-only. The same taxonomy applies in `neopi` and `neodeck`. The Issue Funnel contract is `docs/agents/issue-funnel.md`.

**House:**

- Type: `bug` or `enhancement` (other GitHub defaults only when they truly fit).
- Exactly one `effort: tiny|small|medium|large|very large`.
- Exactly one `priority: p0|p1|p2|p3`.
- `entangled` only for a true alternative cluster (shipping one supersedes the siblings), and only when the Captain ordered it.

**Matt triage (readiness):** see `docs/agents/triage-labels.md`.

**PR state** (on PRs, not issues): `needs-review`, `ready-for-merge`, `review-stalled`; the full label list is in `docs/policy/README.md` › Labels. Do not invent labels.

## Issue shape

House voice: concrete contract, explicit boundaries, checkable acceptance. Sentence-case headings. Drop sections that add nothing:

- Summary
- Observed behavior / current mechanism (paths, symbols, line numbers actually read)
- Gap
- Desired behavior
- Boundaries
- Tests (only when they defend an observable contract)
- Acceptance (`- [ ]` musts)

Dedupe before filing: amend an existing issue with a comment rather than opening a duplicate.
