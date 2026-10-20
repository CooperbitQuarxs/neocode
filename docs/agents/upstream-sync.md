# Synchronizing an upstream release

Use this procedure for every integration of `pingdotgg/t3code`. Upstream syncs land on the integration branch `nightly` (workspace policy › Upstream forks), never directly on the default branch `main`; `nightly` is promoted into `main` by `promote-nightly`. Everywhere below, `$DEFAULT` therefore means `nightly`. GitHub's remote branch is the source of truth. A local checkout is a work surface, not a release baseline.

RFC 2119 applies to MUST, REQUIRED, SHOULD, RECOMMENDED, MAY, OPTIONAL. `NEVER` and `AVOID` mean `MUST NOT` and `SHOULD NOT`.

## Invariants

- MUST start from freshly fetched `origin/<default>` after every prerequisite PR has merged under [Nightly delivery](policy.md#nightly-delivery).
- MUST use the newest upstream stable release tag, not an arbitrary branch tip.
- MUST preserve dirty work and local-ahead commits before integration.
- MUST resolve conflicts personally, sequentially, one file at a time. NEVER delegate conflict resolution.
- MUST record each resolution in the ledger while resolving it.
- MUST preserve fork behavior unless upstream satisfies the same observable contract (`AGENTS.md` › Fork rule).
- MUST land through a PR under [Nightly delivery](policy.md#nightly-delivery). NEVER commit or push directly to `main` or `nightly`.
- MUST sign every commit with the agent signing key and attribute the actual executing provider/model.
- NEVER install dependencies (`vp i`, pnpm, npm) without the Captain's per-call authorization.

## 1. Preserve local work

```sh
DEFAULT=nightly
git fetch origin --prune
git fetch upstream --tags --prune
```

Before creating the integration worktree:

1. Inspect the main checkout's tracked and untracked work.
2. Put unfinished dirty work on a named local `wip/<topic>` branch with a signed WIP commit that names exactly what is preserved. Do not use a stash as durable storage.
3. Put reviewable work on a topic branch, verify it, and merge it through a PR. Park unfinished commits on WIP branches.
4. Fetch `origin` again. Confirm each prerequisite PR merge is present in `origin/$DEFAULT`.
5. Leave WIP branches and recovery refs intact until the integration is merged and smoke-tested.

A local-ahead default branch is never silently reset or used as the integration base.

## 2. Select the release and create a fresh worktree

```sh
TAG=$(git ls-remote --tags upstream 'v*' \
  | sed 's#.*refs/tags/##' \
  | grep -v '\^{}' \
  | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
  | sort -V \
  | tail -1)
printf '%s\n' "$TAG"
```

Confirm the tag is the intended release and that `origin/$DEFAULT` contains every prerequisite merge. Then create the branch and worktree from the remote-tracking ref, and run every later step from inside that worktree:

```sh
DATE=$(date -u +%Y-%m-%d)
git worktree add -b "sync/$DATE" \
  "../neocode-wt-sync-$DATE" \
  "origin/$DEFAULT"
cd "../neocode-wt-sync-$DATE"
```

Never branch this worktree from a local default branch, another integration branch, or a directory containing WIP.

## 3. Create recovery refs

```sh
git branch "backup/neocode-pre-upstream-$TAG" "origin/$DEFAULT"
git rev-parse "$TAG^{}"
```

Verify the tag signature where present; an invalid signature is a blocker. Record an unsigned tag explicitly. Record the source commit, tag commit, and recovery ref at the top of the sync ledger (kept in the PR description, not committed).

## 4. Merge and keep the conflict ledger live

```sh
git merge --no-ff --no-commit "$TAG"
```

Create the ledger immediately, with these columns:

| Path | Resolution | Fork behavior kept | Upstream change taken | Why |
| ---- | ---------- | ------------------ | --------------------- | --- |

Process `git diff --name-only --diff-filter=U` in its printed order:

1. Read the base, ours, theirs, surrounding owner modules, and relevant tests.
2. Resolve exactly one file personally. Use `ours` or `theirs` only when the whole file has that ownership; otherwise merge manually.
3. Preserve the NeoPi provider, its registration lines, and every entry in the touched-upstream-files table unless upstream demonstrably replaces the same contract.
4. Adopt upstream refactors and reseat fork behavior on the new owner rather than restoring obsolete structure.
5. Append that file's ledger row before staging it.

Never batch-write the ledger after all conflicts are resolved. Never ask a subagent to choose or implement a conflict resolution. Read-only research may explain upstream intent, but the integrating agent owns every decision and edit.

After explicit conflicts are resolved, inspect automatically merged changes at every touched-upstream-file entry. A clean textual merge is not evidence of behavioral compatibility.

For the generated lockfile, take upstream as the starting point, then regenerate from the merged tree. Review dependency changes before executing installers; audit every newly introduced dependency rather than accepting it because a lockfile changed.

## 5. Commit and verify

```sh
git commit -S/home/shayna/.ssh/id_ed25519_github_signing_agents.pub \
  -m "chore(sync): integrate upstream $TAG into nightly" \
  -m "Integrate the release with the per-file resolution ledger in the PR." \
  -m "Model: <provider>/<model-id>" \
  -m "Co-authored-by: <actual executing model identity and address>"
git verify-commit HEAD
```

Replace the placeholders with the actual model identity from the running session. Put post-merge fixes in separate signed logical commits.

Verify from the integration worktree:

- Targeted tests for every conflicted path (`vp test run <files>`), and the NeoPi-owned test suites.
- Typecheck and lint for the touched packages. The full suite (`vp check`, `vpr typecheck`) is owned by CI.
- Exercise the changed runtime path under the [verification authorization](../../AGENTS.md#verifying); use the hidden `:10` Xvfb+i3 harness with private state, never the owner's display.

Record exact commands, pass counts, failures, and any unavailable check in the PR. A failure may be classified as pre-existing only with evidence from the unmodified base or the upstream tag.

## 6. Publish through a PR

Push the integration branch and create a PR targeting `nightly`. Summarize:

- upstream tag and commits;
- recovery ref;
- conflict count and the ledger;
- fork contracts preserved or replaced, and any change to the touched-upstream-files table;
- dependency changes and audit result;
- checks, focused tests, and runtime proof;
- pre-existing failures with base evidence.

Merge with a merge commit under [Nightly delivery](policy.md#nightly-delivery), then build, install and check launch as that policy requires. Local checks and CI provide evidence, not merge gates. Do not bypass the PR by pushing the integration directly.

## 7. Realign the main checkout safely

After the PR merges:

```sh
git fetch origin --prune
git switch "$DEFAULT"
git merge-base --is-ancestor HEAD "origin/$DEFAULT" &&
  git merge --ff-only "origin/$DEFAULT"
```

Run that fast-forward path only after preserving dirty work and confirming the checkout is clean. If its tip is not an ancestor of the fetched remote branch:

1. Stop and enumerate the local-ahead commits.
2. Confirm each commit is preserved on a WIP/topic branch and, when intended for `$DEFAULT`, represented by an already merged PR.
3. Create `backup/local-$DEFAULT-<date>-<time>` at the current local tip.
4. Detach at `origin/$DEFAULT`, repoint the local branch to that fetched ref, then switch back to it.
5. Keep the backup and WIP refs until the integration is smoke-tested.

Never realign a local branch merely because a similarly named PR exists. Verify the PR incorporated the commit's intended tree changes first. Never delete or overwrite a WIP branch as cleanup for an upstream sync.
