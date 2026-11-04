import type { VcsRef } from "@t3tools/contracts";
import { sanitizeNewRefName } from "@t3tools/shared/git";

export const CREATE_BRANCH_PREFIX = "__create_branch__:";

/**
 * Picker rows for a native session's branch menu: local branches only (remote
 * refs would need a fetch-and-track flow NeoPi sessions do not drive), plus a
 * trailing "create" row when the typed name is not already a branch.
 */
export function nativeBranchPickerItems(
  refs: ReadonlyArray<VcsRef>,
  query: string,
): { readonly items: ReadonlyArray<string>; readonly createName: string | null } {
  const names = refs.filter((ref) => ref.isRemote !== true).map((ref) => ref.name);
  const createName = sanitizeNewRefName(query);
  const canCreate = createName.length > 0 && !names.includes(createName);
  return {
    items: canCreate ? [...names, `${CREATE_BRANCH_PREFIX}${createName}`] : names,
    createName: canCreate ? createName : null,
  };
}

/**
 * Git tells us which checkout holds each branch but not which checkout is the
 * repository's primary one. A session is in a linked worktree when its branch
 * is not the default branch and the default branch is checked out somewhere
 * else: that is how `/wt` leaves the original checkout. A primary checkout that
 * sits on another branch while a linked worktree holds the default is
 * indistinguishable and reads as a worktree.
 */
export function isNativeLinkedWorktree(refs: ReadonlyArray<VcsRef>): boolean {
  const current = refs.find((ref) => ref.current && ref.isRemote !== true);
  const base = refs.find((ref) => ref.isDefault && ref.isRemote !== true);
  return (
    current !== undefined &&
    base !== undefined &&
    current.name !== base.name &&
    current.worktreePath !== null &&
    base.worktreePath !== null &&
    current.worktreePath !== base.worktreePath
  );
}
