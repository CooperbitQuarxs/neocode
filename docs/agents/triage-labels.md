# Triage labels

This is the settled interim tracker policy, not completion of the global policy or setup-skill migration. The shared labels are deployed; actor/reviewer naming, the baseline decision and the coordinated renames below remain open. Label creation did not relabel or close existing issues.

## Composable meanings

Labels describe separate facts. Keep type, source/relationship, estimates, specification presence and participation/readiness distinct.

| Labels | Meaning |
| --- | --- |
| `bug`, `enhancement`, `documentation`, `accessibility`, `idea` | Fitting descriptions of the issue; `idea` is an undecided possibility, not implementation authorization. |
| `spec` | The issue is or contains an implementation specification, optionally in a collapsible `<details>` section. Headings or checkboxes alone do not turn brainstorming into an agreed spec. A spec is not authorization, active ownership or merge eligibility. |
| `experiment` | Composes with `idea`, `bug` and other labels. Experimental implementation belongs on an `experimental/` topic branch; landing it on `nightly` or `main` requires a separate owner decision. The label starts no work. |
| `downstream` | Records a downstream relationship; it does not move missing NeoPi capabilities into this repository. |
| `entangled` | Incompatible alternatives: choosing one supersedes the others, not ordinary dependencies or related work. Preserve the owner's choice; do not AFK-implement an unresolved alternative set. |
| `duplicate`, `invalid`, `wontfix` | Evidence-based disposition, not a shortcut around reading the issue. `wontfix` means it will not be actioned. |
| `stale: identical` | Proof establishes that the requested behavior is already implemented essentially as specified. |
| `stale: similar` | Partial or different implementation; not automatic closure. |

`experiment` was newly created here; NeoCode had no prior `experimental idea` label to rename.

### Estimates

Priority remains `priority: p0`, `priority: p1`, `priority: p2` or `priority: p3`. Difficulty and frame are independent of priority and each other; do not invent numerical precision without evidence.

- Difficulty labels: `difficulty: 0.000-0.125`, `difficulty: 0.125-0.250`, `difficulty: 0.250-0.375`, `difficulty: 0.375-0.500`, `difficulty: 0.500-0.625`, `difficulty: 0.625-0.750`, `difficulty: 0.750-0.875`, `difficulty: 0.875-1.000`. Lower bounds are inclusive; upper bounds are exclusive except the final interval includes 1.0. Preserve estimator/source provenance. Arbitrary title-number prefixes are not evidence of difficulty; do not rewrite titles on that assumption.
- Frame labels: `frame: hours`, `frame: days`, `frame: weeks`, `frame: months`, `frame: years`. For a fresh agent-authored estimate, normalize down exactly one step: years → months → weeks → days → hours, with hours as the floor. Record estimator, original unit and normalization so later triage does not shrink it again. Leave human-authored estimates unchanged.
- Historical `effort: *` is not literal time and cannot be auto-converted. Assignment is no longer compulsory; existing labels remain until individually reviewed.

### Interim state names

| Operational issue label | Interim treatment |
| --- | --- |
| `needs-triage` | Maintainer evaluation or an unresolved policy decision is needed. |
| `needs-info` | More information is needed from the reporter. |
| `ready-for-agent` | Legacy readiness marker; retain pending evidence-based reconciliation, not as new authorization for an AFK agent. |
| `ready-for-human` | Legacy readiness marker; retain pending evidence-based reconciliation, not as an automatic post-merge or promotion marker. |
| `wontfix` | Will not be actioned. |

Human/agent pending, started and finished participation is under discussion; no final spellings or replacement labels are selected. Started would claim active ownership; finished concerns that participant's work, not universal PR mergeability. Do not create actor-state aliases or settle reviewer naming in this interim policy.

PRs still use `needs-review`, `ready-for-merge` and `review-stalled`, not issue triage markers. The accepted target `mergeable` means the repository's documented gates are met; it does not grant permission to merge `main`. Keep operational `ready-for-merge` until parent policy and literal consumers migrate together. The [existing review gate](pr-review-bots.md) is unchanged.

`upstream` is the accepted target for substantive upstream involvement, not only release synchronization. A fork-local manifestation does not disprove upstream origin. Keep operational `upstream-sync` pending the coordinated parent-policy/consumer cutover; do not create the target or rename the existing label in isolation. Preserve repository-specific `neopi-upstream` where supported by evidence. `baseline` remains in use for defects found on the base; it does not automatically imply upstream origin. Whether to remove it remains undecided.

## Reconciliation

Reconcile at least daily. The owner will create a dedicated triage role; until then use the built-in `@commit` role, resolved at runtime. Do not pin a model slug, start a swarm or infer a scheduler from this requirement.

1. Read issue and PR bodies, relevant comments, current labels, linked implementation and all acceptance criteria. Check actual PR merged state, not just closed state. Ingest PR review bodies as well as inline comments/threads and issue comments. Author claims are not independent CI/review proof.
2. Compare duplicate candidates and existing ownership/acceptance work without redoing it. Scope review to tangible changed behavior, not unrelated upstream ghosts. Distinguish partial/similar implementation from essentially identical implementation.
3. Produce an evidence-linked proposal first: current labels, proposed additions/removals, issue-state recommendation, confidence, evidence and unresolved policy decisions. Unclear cases stay `needs-triage` or `needs-info` as appropriate.
4. An authorized integration owner reviews the proposal and applies verified changes. Preserve useful unique duplicate context in an attributed canonical-issue comment/crosslink before closing; never close on title similarity.
5. For merged-PR issues, follow [completion and closure](issue-tracker.md#completion-and-closure): prove all acceptance and any explicit promotion condition, record the merge/proof, and do not confuse partial delivery with complete scope.

This procedure adds no scheduling infrastructure and does not decide actor/reviewer names, baseline removal or new review gates. Publication authority and identity rules remain in [issue-funnel.md](issue-funnel.md) and workspace policy.
