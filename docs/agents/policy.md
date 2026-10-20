# Repository policy

The [workspace policy](../../../AGENTS.md) governs branches, commits, signing,
publication and merging; this file adds NeoCode-specific details.
[pr-review-bots.md](pr-review-bots.md) owns review mechanics;
[triage.md](triage.md) owns tracker reconciliation.

## Branches

| Role               | Branch    | Local checkout                                    | Ships as                                                                                                                                 |
| ------------------ | --------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Default (promoted) | `main`    | Main repository checkout                          | Stable GitHub releases (see [Releases](#releases)); the desktop entry runs `apps/desktop/scripts/start-electron.mjs` from this checkout. |
| Integration        | `nightly` | Topic worktree or a separate integration checkout | Nightly desktop application; source of owner-decided promotion.                                                                          |

- Topic branches: `git fetch origin && git worktree add ../neocode-wt-<slug> -b <type>/<slug> origin/nightly`.
- PRs target `nightly`. `hotfix/` PRs target `main` and are followed by a PR merging `main` back into `nightly`.
- Upstream (`pingdotgg/t3code`) releases merge on `sync/<date>` into `nightly`; procedure in `docs/agents/upstream-sync.md`.
- `main` and `nightly` are protected by the "Standard Protection" ruleset: a PR is required, merge commits only, no force-push, no deletion. Nothing is pushed to either branch directly.

## Nightly delivery

Follow [workspace Nightly delivery](../../../AGENTS.md#nightly-delivery) for merge
eligibility, lockout-only canaries, artifact-changing rebuilds, installation,
rollback retention, continuous intake, delegation and machine discipline;
NeoCode's desktop application is built with
`vp run build:desktop` and launched with `apps/desktop/scripts/start-electron.mjs`.

- Merge subjects read `Merge PR #<number>: <conventional PR subject> (@<author>)`.
- Preserve private diagnostic state and process-ownership safety below. A proof session may hold the destination-scoped runtime install lock for at most ten minutes and releases it as soon as proof ends. Use [NeoPi #386](https://github.com/PsychedelicShayna/neopi/pull/386), with the same `NPI_DEST` for `hold`, `status`, `release` and installation; expired holds do not defer delivery. Do not invent a repository-local lock.
- Contributor heads are never executed on the owner's machine; see [Running PR code](pr-review-bots.md#running-pr-code).

## CI

PR validation and CI on `nightly` and `main` use GitHub-hosted runners:
`ubuntu-24.04` for Linux and `macos-15` for mobile native static analysis.
The fork has no Blacksmith runners; inheriting upstream's runner labels left
every CI job queued instead of executing ([#23](https://github.com/PsychedelicShayna/neocode/issues/23)).
PR preview workflows use hosted runners too. The fork release lane packages
Linux and unsigned Windows x64 on hosted runners. Upstream production mobile,
publish, and manual Windows lanes retain their existing runners.

Follow [workspace Checks](../../../AGENTS.md#checks) for CI/test evidence and
nightly merge decisions; promotion to NeoCode's `main` remains the owner's decision.

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

- `.github/workflows/release.yml` publishes fork GitHub releases on every `nightly` push (prerelease, never latest), every `main` push (stable, latest), and manual dispatch (stable by default, from the chosen workflow ref or explicit `ref` input).
- Stable branch/manual tags are `v<version>+build.<run_id>.<attempt>`; nightly tags are `v<version>-nightly.<YYYYMMDD>.<run_id>.<attempt>`. Existing releases and tags are retained; collisions fail.
- Version-tag and scheduled triggers remain available. Scheduled runs check `nightly` for changes and the existing six-hour gap; branch pushes do not wait for it. Manual preview/nightly channels remain available.
- Hosted Linux and Windows x64 builds reuse `release-desktop.yml` and attach AppImage, `.deb`, unsigned NSIS, CLI archives and checksums. Upstream publishers and production credentials are not used. See [release operations](../operations/release.md#neocode-fork-releases) for first-run behavior and installation limitations.
- Version bumps arrive through upstream syncs. A PR never creates a tag.

## Labels

Use [triage-labels.md](triage-labels.md) for the composable vocabulary and
[triage.md](triage.md) for two-pass classification and daily reconciliation.
Review labels describe optional evidence, not nightly eligibility. Issues
remain open until full acceptance and promotion to `main`.

## Commits and publication

Use small logical commits on topic worktrees based on freshly fetched
`origin/nightly`. Keep unrelated work intact. Merge the base only for actual
conflicts; base movement alone requires no refresh or reassessment.
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
kind, priority and state; unclassified intake uses `needs-triage`. Optional PR
review evidence uses the review manual's labels rather than intake labels.

Daily triage identifies orphan branches; publication follows Nightly delivery.

Every GitHub comment, issue body or review reply starts with:

```md
> [!NOTE]
> <Model Name> on behalf of PsychedelicShayna
```

The authoring agent may push its topic branch, reply on its own PR, file
evidenced baseline issues discovered during review, apply supported labels,
and merge its PR into `nightly` under Nightly delivery. Changes to other authors'
PRs, repository settings, rulesets and protection remain outside that
authority. Post only on the fork, never `pingdotgg/t3code`.

## Recovery

If a merged PR breaks `nightly`, revert it through a PR. Owner-discretion bug
hunts inspect recently merged changes on `nightly`; they do not gate merges.
Workflow changes exercised only on push or dispatch stay single-purpose:
delegate observation of the first applicable post-merge run to a cheap poller
and revert through a PR if needed.

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
