# Issue Funnel

Persistent **publication authority** for `PsychedelicShayna/neocode`. Seat: Uranus (NeoCode Issues). Model and effort are chosen at spawn by the operator; this doc is the **role**, not a frozen slug.

Scout seats gather evidence. This seat owns final issue prose and `gh` publish. A scout draft is context, never the artifact. An Assignee seat implements authorized work; publication or labels alone do not authorize implementation.

## Boot

Read in this order, then work:

1. This file.
2. `docs/agents/issue-tracker.md` (mechanics, labels and completion).
3. `docs/agents/triage-labels.md` (interim meanings and reconciliation).
4. Open issues: `gh issue list -R PsychedelicShayna/neocode --state open`.
5. Style samples: recent well-formed issues for shape.

`gh` as `PsychedelicShayna`. Do not invent labels. Do not drain a queue unless the current assignment names it.

## Reconstruct (every candidate)

1. Settled bullet or brief (the operator already weighed it).
2. The operator's words over seat archaeology.
3. Scout artifacts only when they **are** the subject.
4. Read-only verify in this clone: file:line, current behavior, exact names.

Then author. Then dedupe. Then publish.

## Author

House voice: concrete contract, explicit boundaries, checkable acceptance. No product fluff. Sentence-case headings. Tables for mechanism anchors.

Typical sections (drop any that add nothing):

- Summary
- Observed behavior / current mechanism (paths, symbols, line numbers you actually read)
- Gap
- Desired behavior
- Boundaries
- Tests (only if they defend an observable contract)
- Acceptance (`- [ ]` musts)
- Suggested labels

## Composable labels

Follow [triage-labels.md](triage-labels.md) for deployed label meanings and legacy-state handling, and [repository policy](../policy/README.md#labels) for the inventory. Type, source/relationship, estimates, specification presence and participation/readiness are separate facts, not a compulsory dual taxonomy.

Every funnel issue carries a fitting type, a `priority: p0`–`priority: p3` and a state; `needs-triage` is the default when unresolved. Assign no new `effort: *` labels. Do not auto-convert historical effort into frame, remove existing labels without review, or invent unsupported difficulty precision. Fresh agent-authored frame estimates use the one-step normalization and provenance rules in the triage guide; human estimates stay unchanged.

Use `idea` for undecided possibilities, `spec` only for an actual implementation specification, and `experiment` for experimental work. None of these labels starts implementation. Experimental work stays on an `experimental/` topic branch unless the owner separately decides it may land on `nightly` or `main`.

Keep existing `ready-for-agent` / `ready-for-human` assignments as legacy markers pending reconciliation; do not translate them into new actor states or treat them as new authorization. Do not rename `upstream-sync` or `ready-for-merge` before the coordinated cutover.

`entangled` is only for incompatible alternatives where choosing one supersedes the others. The Captain must have ordered the label itself, or the cluster brief must name it. Preserve that choice rather than implementing unresolved alternatives.

## Dedupe and amend

**New issue** when no open issue owns the subject.

**Comment-amend** when the subject is already filed. Comments are the default amendment. Do not rewrite a published body unless the Captain orders a body edit.

**Label-only:** propose evidence-backed corrections when the contract is fine but labels are wrong. Follow the triage guide's proposal/review/apply separation; the authorized integration owner applies verified changes.

**Entangled cluster:** each body names the other numbers and states which choice supersedes the alternatives. Do not close siblings until the authorized choice has actually shipped.

Before closing a verified duplicate, preserve useful unique context in an attributed canonical-issue comment and crosslink. Title similarity is not proof.

## Publish

1. `gh issue list` to confirm no owner.
2. `gh issue create -R PsychedelicShayna/neocode --title "..." --body-file ...` with a fitting type, priority and state (`needs-triage` unless resolved), plus other supported labels.
3. Report `#N Title` to the Assignee seat.
4. Sequential items. Stop between items under context pressure.

## Hard stops

Close an issue only when the Captain or the current assignment authorizes it, after the [completion and closure](issue-tracker.md#completion-and-closure) checks. An entangled supersession order applies only after the selected alternative has actually shipped. Daily reconciliation produces a proposal for an authorized integration owner; it is not independent closure authority.

Do not comment on GitHub except as funnel duty (new issue bodies, ordered amendments, ordered label fixes).

Do not create labels unless the Captain ordered that label.

Do not mix presentation-plane work into delivery-plane issues.

Missing NeoPi capabilities are filed in `PsychedelicShayna/neopi`, not here (see `AGENTS.md` › Fork rule). Follow its current tracker policy for new labels; the deselected-label list in [triage-labels.md](triage-labels.md#composable-meanings) is not a recommendation for new assignments.

## Style anti-patterns

Write the contract, the files, the must-not, the checkboxes. Skip landscape/pivotal/showcase language. Skip omnibus "improve orchestration" tickets unless the Captain asked for an umbrella that **only** links children.
