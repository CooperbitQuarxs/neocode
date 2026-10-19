# Issue tracker: GitHub

Issues and specs for this repo live in GitHub Issues at `PsychedelicShayna/neocode` (fork of `pingdotgg/t3code`). `origin` is the fork, `upstream` is pingdotgg; `gh repo set-default` points at the fork. Always pass `-R PsychedelicShayna/neocode` when in doubt. Never file issues, comments, or PRs on `pingdotgg/t3code`.

## Conventions

- Create: `gh issue create -R PsychedelicShayna/neocode --title "..." --body-file <path> --label ...`.
- Read: `gh issue view <number> --comments`, including labels.
- List: `gh issue list --state <state> --json number,title,body,labels,comments` with the filters the task requires.
- Apply or remove labels: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- Posting rules (comment identity block, labels) are the workspace policy in `~/source/github/PsychedelicShayna/AGENTS.md`. Label meanings and reconciliation are in [triage-labels.md](triage-labels.md).
- Upstream `AGENTS.md` still applies: implementation plans and scratch notes stay out of the worktree; the issue owns the checklist, the merged PR is the record.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Skill meanings

- "Publish to the issue tracker" means create a GitHub issue on the fork.
- "Fetch the relevant ticket" means read the GitHub issue, its comments, and labels.

## Composable labels

Type, source/relationship, estimates, specification presence and participation/readiness are distinct facts, not mutually exclusive issue categories. Use the deployed labels and interim meanings in [triage-labels.md](triage-labels.md); the repository inventory and operational PR state names are in [repository policy](../policy/README.md#labels).

Each published issue carries a fitting type, a `priority: p0`–`priority: p3` and a state; use `needs-triage` when unresolved. Assign no new `effort: *` labels, do not convert historical effort into time, and preserve existing associations pending evidence-based review. Keep legacy `ready-for-agent` / `ready-for-human` assignments pending reconciliation; they are not fresh implementation authorization. The publication contract is [issue-funnel.md](issue-funnel.md).

## Completion and closure

A merged PR is implementation evidence, not proof that the entire issue is complete. Verify every acceptance criterion and any explicit promotion condition against the implementation and actual PR merge state. A closed, unmerged PR is not a merged implementation.

GitHub automatic closure normally waits for a default-branch merge. A `nightly` merge can therefore leave a completed issue open: an authorized integration owner may close it manually after verifying the full scope and recording the merge and acceptance proof. If the issue explicitly requires promotion to `main`, wait for that promotion. Do not automatically label a `nightly` merge `ready-for-human`, close an umbrella for a partial PR, or reopen a correctly completed issue merely because a new follow-up exists.

For stale or duplicate candidates, follow the evidence and proposal/review/apply procedure in [triage-labels.md](triage-labels.md#reconciliation).

## Issue shape

House voice: concrete contract, explicit boundaries, checkable acceptance. Sentence-case headings. Drop sections that add nothing:

- Summary
- Observed behavior / current mechanism (paths, symbols, line numbers actually read)
- Gap
- Desired behavior
- Boundaries
- Tests (only when they defend an observable contract)
- Acceptance (`- [ ]` musts)

Dedupe before filing: amend an existing issue with a comment rather than opening a duplicate. Before closing a verified duplicate, preserve useful unique context in an attributed canonical-issue comment and crosslink; title similarity alone is not proof.
