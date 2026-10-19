# Maintaining fork behavior across upstream updates

NeoCode is NeoPi's full graphical frontend, built from upstream T3 Code (`pingdotgg/t3code`). `AGENTS.md` › Fork rule: NeoPi-first, upstream-aware governs placement. Preserve upstream provenance and useful compatibility while keeping the fork's product direction authoritative.

## Placement of new behavior

Before adding fork behavior, locate the existing owner and inspect extension points and shared utilities. Prefer NeoPi-owned files when they express the complete behavior: `apps/server/src/provider/neopi/`, `apps/server/src/provider/{Layers,Drivers,Services}/NeoPi*`, `packages/effect-neopi-rpc/`, and `*neopi*` client files. Shared registration, defaults, ordering and branding may directly express NeoCode's NeoPi-first identity.

Keep provider mechanics at the adapter boundary or in NeoPi's RPC. Use provider-neutral seams when they fit the existing design, not as a requirement to disguise NeoPi-first product policy. Preserve explicit saved choices, other harness support, storage paths and protocol identifiers; do not add unrelated refactors or reorder unrelated code.

For each upstream file the fork touches, record the reason in the table in `AGENTS.md` › Fork rule. Adding one means adding a line; removing the need means removing it. Missing capabilities belong in NeoPi's RPC (`PsychedelicShayna/neopi`), not in T3 workarounds; file them there with `downstream` and other labels supported by its current tracker policy, rather than copying deselected historical bundles.

Use shared utilities rather than duplicating their implementations. Avoid unrelated refactoring of upstream-owned code in the same change.

## Integrating an upstream release

Pin the source fork commit, the upstream release commit, and relevant open PR heads before resolving conflicts. Use a separate worktree for integration (`docs/agents/upstream-sync.md`). Preserve a recovery ref.

Review upstream changes to every file in the fork's touched-upstream-files table, including files Git merged automatically. For each fork behavior, determine whether upstream preserves it, replaces it fully, overlaps it partly, or conflicts with it. A clean textual merge is not evidence of behavioral compatibility. When upstream and a fork feature conflict, the fork's implementation is kept; upstream parity is never a reason to remove or reroute a fork feature.

Keep open PRs separate until their contracts have been compared with the new upstream behavior. If upstream replaces part of a PR, retain the remaining requirement and adapt its tests; do not infer redundancy from similar changelog wording.

Validate both upstream regressions and fork contracts at the affected boundaries. Record source changes, failed or unavailable checks, and actual test results separately.
