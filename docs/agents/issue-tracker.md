# Issue tracker: GitHub

Issues and specs for this repo live in GitHub Issues at `PsychedelicShayna/neocode` (fork of `pingdotgg/t3code`). `origin` is the fork, `upstream` is pingdotgg; `gh repo set-default` points at the fork. Always pass `-R PsychedelicShayna/neocode` when in doubt. Never file issues, comments, or PRs on `pingdotgg/t3code`.

## Conventions

- Create: `gh issue create -R PsychedelicShayna/neocode --title "..." --body-file <path> --label ...`.
- Read: `gh issue view <number> --comments`, including labels.
- List: `gh issue list --state <state> --json number,title,body,labels,comments` with the filters the task requires.
- Apply or remove labels: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- Posting rules and authority are in [policy.md](policy.md). Read [triage.md](triage.md) for classification/reconciliation and [triage-labels.md](triage-labels.md) for vocabulary.
- Upstream `AGENTS.md` still applies: implementation plans and scratch notes stay out of the worktree; the issue owns the checklist, the merged PR is the record.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Skill meanings

- "Publish to the issue tracker" means create a GitHub issue on the fork.
- "Fetch the relevant ticket" means read the GitHub issue, its comments, and labels.

## Composable labels

Type, relationships, estimates, specification and participation are separate
facts. Each published issue has a fitting kind, priority and state; unclassified
intake uses `needs-triage`. Follow [triage.md](triage.md) before finalizing labels.
The publication contract is [issue-funnel.md](issue-funnel.md).

## Completion and closure

A merged PR is implementation evidence, not proof that the entire issue is complete. Verify every acceptance criterion and any explicit promotion condition against the implementation and actual PR merge state. A closed, unmerged PR is not a merged implementation.

NeoCode issues stay open until the complete fix is promoted to `main`, even
if the body omits this condition. After a `nightly` merge, record acceptance
evidence and mark completed agent work `agent: finished`; keep the issue open.
The promotion PR carries `human: pending` for the owner's decision. An
authorized closer verifies full acceptance and promotion before closing.
Duplicate and rejected-report dispositions follow [triage.md](triage.md).

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
