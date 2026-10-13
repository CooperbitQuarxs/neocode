# Maintaining fork behavior across upstream updates

NeoCode is upstream T3 Code (`pingdotgg/t3code`) plus a NeoPi/OMP provider. The rule that governs everything below is `AGENTS.md` › Fork rule: additive only, upstream-compatible. Every upstream merge should be routine.

## Placement of new behavior

Before adding fork behavior, locate the upstream owner and inspect existing extension points and shared utilities. Prefer NeoPi-owned files when they can express the complete behavior: `apps/server/src/provider/neopi/`, `apps/server/src/provider/{Layers,Drivers,Services}/NeoPi*`, `packages/effect-neopi-rpc/`, and `*neopi*` web files. Upstream files get registration lines only.

When NeoPi genuinely needs an upstream seam, the change must be provider-neutral (usable by any provider), minimal, default-off for existing providers, and covered by a test. Never branch on `neopi` in shared code, never change an existing provider's behavior, and never reformat or reorder upstream code. A new file alone does not provide isolation if it copies upstream internals or depends on their incidental order.

For each upstream file the fork touches, record the reason in the table in `AGENTS.md` › Fork rule. Adding one means adding a line; removing the need means removing it. Missing capabilities belong in NeoPi's RPC (`PsychedelicShayna/neopi`), not in T3 workarounds; file them there with labels `rpc`, `downstream`, `t3c-npi`.

Use shared utilities rather than duplicating their implementations. Avoid unrelated refactoring of upstream-owned code in the same change.

## Integrating an upstream release

Pin the source fork commit, the upstream release commit, and relevant open PR heads before resolving conflicts. Use a separate worktree for integration (`docs/agents/upstream-sync.md`). Preserve a recovery ref.

Review upstream changes to every file in the fork's touched-upstream-files table, including files Git merged automatically. For each fork behavior, determine whether upstream preserves it, replaces it fully, overlaps it partly, or conflicts with it. A clean textual merge is not evidence of behavioral compatibility. When upstream and a fork feature conflict, the fork's implementation is kept; upstream parity is never a reason to remove or reroute a fork feature.

Keep open PRs separate until their contracts have been compared with the new upstream behavior. If upstream replaces part of a PR, retain the remaining requirement and adapt its tests; do not infer redundancy from similar changelog wording.

Validate both upstream regressions and fork contracts at the affected boundaries. Record source changes, failed or unavailable checks, and actual test results separately.
