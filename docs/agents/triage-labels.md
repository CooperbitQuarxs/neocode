# Triage labels

Iteration 1: labels compose facts, rather than encoding every combination in a new name. Follow [triage.md](triage.md) to classify and reconcile records; [pr-review-bots.md](pr-review-bots.md) owns optional review mechanics.

## Kind

| Label           | Meaning                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `bug`           | Something isn't working.                                                                       |
| `enhancement`   | New feature or request.                                                                        |
| `documentation` | User- or agent-facing docs, README or changelog.                                               |
| `accessibility` | Barrier affecting people with disabilities.                                                    |
| `idea`          | An undecided possibility; not a spec, not authorized work.                                     |
| `experiment`    | Tried on an `experimental/` branch; landing on `nightly` or `main` requires an owner decision. |
| `spec`          | Is or contains an implementation specification.                                                |
| `hotfix`        | Urgent targeted fix to the default branch.                                                     |

## Relationship and disposition

| Label              | Meaning                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------- |
| `upstream`         | Upstream is involved: synchronization, compatibility, conflict avoidance or divergence. |
| `downstream`       | Needed by a project that consumes this one.                                             |
| `duplicate`        | Same request as another issue; useful context merged into the canonical one.            |
| `entangled`        | Incompatible alternatives; the owner chooses one, the rest close.                       |
| `baseline`         | Pre-existing defect found on the base during review; retained this iteration.           |
| `invalid`          | Closed: wrong repo, missing required information or format, or policy violation.        |
| `wontfix`          | Closed: will not be worked on.                                                          |
| `stale: identical` | Already implemented essentially as specified.                                           |
| `stale: similar`   | Implemented differently; open for remaining differences.                                |

## Priority and estimates

| Labels                                                                                                                                                                                                                 | Meaning                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `priority: p0`                                                                                                                                                                                                         | Blocks current work or handles an active incident.                                                                       |
| `priority: p1`                                                                                                                                                                                                         | High value or prerequisite for several issues.                                                                           |
| `priority: p2`                                                                                                                                                                                                         | Useful planned work.                                                                                                     |
| `priority: p3`                                                                                                                                                                                                         | Backlog or opportunistic work.                                                                                           |
| `difficulty: 0.000-0.125`, `difficulty: 0.125-0.250`, `difficulty: 0.250-0.375`, `difficulty: 0.375-0.500`, `difficulty: 0.500-0.625`, `difficulty: 0.625-0.750`, `difficulty: 0.750-0.875`, `difficulty: 0.875-1.000` | Eight implementation-difficulty bands. Lower bounds inclusive; upper bounds exclusive except 1.000.                      |
| `frame: hours`, `frame: days`, `frame: weeks`, `frame: months`, `frame: years`                                                                                                                                         | Estimated time frame; agent estimates lowered one unit exactly once, with hours as the floor. Human estimates unchanged. |

## Triage and actor state

| Label             | Meaning                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `needs-triage`    | Not yet triaged.                                                                             |
| `triage: started` | Triage in progress; labels are provisional. Name is a proposal in this iterative vocabulary. |
| `needs-info`      | Cannot proceed until the named information arrives.                                          |
| `agent: pending`  | Ready for an out-of-the-loop (OTL) agent to pick up.                                         |
| `agent: started`  | An agent has claimed this; do not duplicate the work.                                        |
| `agent: finished` | The agent's part is done; not necessarily mergeable.                                         |
| `human: pending`  | Needs an in-the-loop (ITL) session with a human.                                             |
| `human: started`  | A human has claimed the in-the-loop part.                                                    |
| `human: finished` | The human's in-the-loop part is done.                                                        |

Started is a claim, not a heartbeat. Human means human-in-the-loop, not a human writing the code.

## Review and merge

| Label                       | Meaning                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| `review: codex`             | Optional reviewer choice; no default assignment. |
| `review: requested (codex)` | A Codex round was requested; descriptive evidence only. |
| `review: open (codex)`      | Codex findings remain open. |
| `review: closed (codex)`    | The recorded round's findings have dispositions. |
| `review: stalled (codex)`   | A round failed, is missing, or remains unresolved; never a nightly blocker. |
| `mergeable`                 | Integrator confidence supports nightly delivery; not review/CI completion or merge authority. |

These labels are optional evidence, never nightly gates. Base movement
invalidates nothing; a new head needs no review reset or equivalence proof.
`sentinel-review-requested` records an explicit panel request, not a nightly
gate. Magi is not configured.

## Composition

Use `upstream` + `bug`, `downstream` + `enhancement`, or `upstream` + `experiment` to express separate facts. `experiment` can compose with `idea` or `bug`, but requires its experimental branch rather than ordinary integration eligibility. `documentation` covers this policy as well as user guides.

`duplicate` and `entangled` can coexist when variants address the same request but cannot coexist. Entanglement does not imply duplication. `needs-info` or unresolved `entangled` excludes pending actor states: blocked work is not ready to pick up. Use one state per actor and one current review state per reviewer; actor states for different participants can coexist. Completion of either participant does not imply `mergeable`. `spec` supplies a contract, not authorization or ownership. Priority, difficulty and frame are independent axes.

## Open decisions

These are recorded, not implemented: retiring `baseline` (fork-local base defects still need a marker); upstream-conflict potential and user-disruption axes; a replacement for the question category; resource allocation in place of contributor recruitment; a squash/rebase exception; an owner approval mechanism for policy files; the setup skill and HTML questionnaire; Magi; automated triage runners/webhooks; GitHub Projects and Discussions reporting. Vocabulary and proposed spellings remain iterative.
