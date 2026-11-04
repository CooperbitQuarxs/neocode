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
 * In a linked worktree `.git` is a file pointing into the primary repository's
 * `worktrees/` directory; the primary checkout has a `.git` directory (which
 * cannot be read as a file) and a submodule's file points into `modules/`.
 */
export function isLinkedWorktreeGitFile(contents: string | null | undefined): boolean {
  return /^gitdir:\s*\S.*[\\/]worktrees[\\/][^\\/\n]+\s*$/.test(contents ?? "");
}
