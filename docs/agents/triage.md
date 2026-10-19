# Triage and reconciliation

Use [triage-labels.md](triage-labels.md) for vocabulary, [policy.md](policy.md) for publication and merge authority, and [issue-tracker.md](issue-tracker.md) for issue shape and tracker commands. Triage classifies work; it does not authorize implementation. Perform reconciliation of open issues and PRs at least daily. This manual does not install a scheduler or webhook.

## 1. Intake and first pass

New reports enter with `needs-triage`. Read each body, comments, current labels, acceptance criteria and linked implementation. Claim triage by replacing `needs-triage` with `triage: started`; provisional labels are not readiness.

Record a first pass in a private file outside the worktree, so the classification survives context loss. For each record keep its number, observed update time, current labels, provisional additions/removals, evidence links, acceptance gaps and unresolved decisions. Assign a fitting kind, priority, difficulty, frame, relationships, review requirement and actor state only where supported. An `idea` remains undecided; headings alone do not make it a `spec`. An `experiment` may be investigated on an `experimental/` branch, not merged to `nightly` or `main` without a separate owner decision.

A valid usage/configuration question may have no fitting kind in this iteration.
Keep it unclassified with `needs-triage` after the pass and record the open
category decision. A replacement category is still an open design item;
inventing a kind or calling a valid question invalid would misstate the report.

Use `needs-info` for a named missing prerequisite, stating what must arrive and from whom. Use `invalid` and close with an explanation for wrong-repository reports, missing required format/information or policy violations when the submission is rejected, rather than holding it for clarification. Use `wontfix` and an explanation for a valid request that will not be worked on. Automatic repair and reopening of malformed reports is not part of this procedure.

## 2. Compare against the whole tracker

Before finalizing the provisional pass, read every other open issue, including already-triaged issues. Compare the new set with each other and with existing work for duplicates, incompatible alternatives, dependencies and overlapping acceptance. Check the upstream tracker, `pingdotgg/t3code`, for matching reports, planned behavior and compatibility/conflict evidence. Read upstream records without posting there. Apply `upstream` for substantive upstream involvement, not merely because this repository is a fork.

Inspect linked PRs and actual implementation, including review bodies, inline threads, summaries and issue comments. Distinguish a closed-unmerged PR from a merged PR, partial coverage from whole acceptance, and similar behavior from the specified behavior. Author claims alone are not CI or acceptance proof.

### Duplicates

Compare both contracts and preserve useful unique context. Append an attributed update to the canonical issue naming the duplicate, its author/source and the contributed details. Cross-link both records, then label and close the duplicate with the canonical link. Similar titles are not proof. Keep incompatible variants open for an owner decision instead of losing their differences in a duplicate closure.

### Entangled alternatives

Apply `entangled` to every incompatible alternative and add reciprocal links. Explain the differences and concise pros/cons so the owner can choose A, B or C. These can be duplicates, or independent ideas that cannot coexist. Ordinary dependencies are not entanglements. Remove pending actor states while the choice is unresolved. After the owner chooses, preserve the decision; close the superseded alternatives when the authorized choice has shipped, and remove entanglement from the chosen issue when no conflict remains.

## 3. Estimate with provenance

Choose an evidence-supported difficulty band independently of priority and time frame. Preserve the estimator and rationale; title-number prefixes are not difficulty evidence.

For an agent estimate, first record the original unit and estimator, then lower the frame exactly one unit: years → months, months → weeks, weeks → days, days → hours, hours → hours. Record that normalization was applied. Later reconciliation reuses the original estimate or makes an explicitly new estimate; it never lowers an already-normalized frame again. Human-authored frames remain unchanged. Preserve old estimate evidence rather than guessing a conversion from unrelated scales.

## 4. Assign participation and review

Use `agent: pending` only when the issue is sufficiently specified for unattended/out-of-the-loop work and unblocked. Use `human: pending` for work ready for a human-in-the-loop session, including design decisions that require participation. Unresolved entanglement and missing information are not pending work.

The participant who claims the work replaces pending with `agent: started` or `human: started`. Started records ownership, not continuous activity; another worker does not duplicate that claim. Replace started with the corresponding finished label when that participant's responsibility is complete. Human participation may finish before unattended review fixes do. Agent completion can precede promotion. Neither finished label asserts whole-change merge eligibility. If responsibility returns, move the affected actor back to pending or started as appropriate and explain the changed scope.

Default review policy: every PR requires Codex Code Review. Assign `review: codex` at triage when a change will produce a PR. The PR author re-checks the actual diff against [pr-review-bots.md](pr-review-bots.md), carries the requirement onto the PR and requests a round on its head. This iteration adds no security rounds. Existing explicit panel requirements remain binding. Review states describe evidence, not author confidence; `mergeable` requires all repository gates and does not grant authority to merge `main`.

## 5. Apply and reconcile

An authorized tracker operator reviews the evidence-linked proposal and applies the verified delta to each record's live labels. Re-read records updated since observation; preserve unrelated concurrent changes. Once both passes are complete, remove `triage: started` and apply the supported labels. Leave a named blocker rather than declaring unready work pending. An unresolved classification stays in triage with the open decision recorded.

At least daily, compare all open issues and PRs with current implementation, actor claims, review receipts, CI and merge state. Correct missing or stale labels, distinguish a new follow-up from reopened acceptance, and retain evidence of decisions. Publication authority for the funnel remains in [issue-funnel.md](issue-funnel.md); daily reconciliation alone grants no closure authority.
Daily, after `git fetch --prune origin`, list orphan topic branches from `git branch -r --no-merged origin/nightly`, excluding remote HEAD/default/integration refs and branches with an open PR (match the paginated open-PR inventory by head repository and branch).

During daily reconciliation, add `upstream` to a promotion proposal when its carried merge history contains a `sync/` upstream-release merge; the promotion workflow does not classify upstream content.

## 6. Completion and promotion

Verify every acceptance criterion before declaring an issue complete. A merged partial PR does not close its umbrella. `stale: identical` requires proof of essentially the specified implementation; `stale: similar` stays open for the remaining differences.

NeoCode issues stay open until the complete fix is promoted to `main`, even if their bodies omit this condition. A `nightly` merge is implementation evidence, not closure: record the merge and acceptance proof, mark completed agent work `agent: finished`, and keep the issue open. The promotion PR carries `human: pending`, because the owner decides promotion. An authorized closer records promotion and full acceptance before closing. Duplicate, invalid and wontfix closures are dispositions, not claims that a fix shipped.
