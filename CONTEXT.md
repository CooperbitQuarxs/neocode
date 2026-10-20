# Repository and tracker glossary

Use these meanings for NeoCode policy and issue work. Product vocabulary stays in [docs/internals/glossary.md](docs/internals/glossary.md); procedures live in [docs/agents/](docs/agents/).

PR: a unit of tangible change the owner can feel when she runs the build.

| Term                | Meaning                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| NeoCode             | This fork, `PsychedelicShayna/neocode`, of `pingdotgg/t3code`.                                                                    |
| Upstream            | The source project `pingdotgg/t3code`; involvement includes sync, compatibility, conflict avoidance and divergence.               |
| Downstream          | A consuming project that needs behavior from this repository. Missing NeoPi RPC capabilities belong in `PsychedelicShayna/neopi`. |
| ITL / human         | In-the-loop participation with a human; not a requirement that a human writes the implementation.                                 |
| OTL / agent         | Out-of-the-loop, unattended agent work on an adequately specified, unblocked request.                                             |
| Pending             | Work ready for the named participant to claim.                                                                                    |
| Started             | A claim on responsibility, not a heartbeat or assertion of continuous activity.                                                   |
| Finished            | That participant's part is complete; other participants, review, CI or promotion may remain.                                      |
| Triage              | Two-pass classification: provisional labels, then comparison against the whole open tracker and upstream.                         |
| Spec                | An implementation specification, possibly embedded in an issue; not merely an idea or implementation authorization.               |
| Idea                | An undecided possibility, not a commitment or permission to implement.                                                            |
| Entangled           | Mutually incompatible alternatives requiring the owner's choice, rather than ordinary related or dependent work.                  |
| Frame normalization | Lower an agent's original time unit exactly once, with hours as the floor; preserve provenance. Human estimates are unchanged.    |
| Review choice       | An optional reviewer selected for a large-blast-radius change; never a nightly gate.                                              |
| Review state        | Descriptive evidence of a requested, open, closed or stalled round on its recorded SHA.                                           |
| Mergeable           | The integrator's confidence supports nightly delivery; not a CI/review gate or authority to merge.                                |
| Baseline            | A defect already present on the PR base; it need not originate upstream.                                                          |
| Integration         | Merge into `nightly`, where agent work can finish while an issue remains open.                                                    |
| Promotion           | Owner-decided merge from `nightly` into `main`; NeoCode issues close only after complete acceptance and promotion.                |

Read [triage.md](docs/agents/triage.md) for label transitions and [policy.md](docs/agents/policy.md) for authority. Portable repository skills live in `.agents/skills/`; harness-specific configuration stays in its harness directory.
