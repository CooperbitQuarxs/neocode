import type { VcsRef } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  CREATE_BRANCH_PREFIX,
  isLinkedWorktreeGitFile,
  nativeBranchPickerItems,
} from "./nativeBranchToolbar.logic";

const ref = (name: string, extra: Partial<VcsRef> = {}): VcsRef => ({
  name,
  current: false,
  isDefault: false,
  worktreePath: null,
  ...extra,
});

describe("nativeBranchPickerItems", () => {
  it("lists local branches only and offers to create an unknown name", () => {
    const refs = [ref("main"), ref("origin/main", { isRemote: true }), ref("feature/a")];
    expect(nativeBranchPickerItems(refs, "")).toEqual({
      items: ["main", "feature/a"],
      createName: null,
    });
    expect(nativeBranchPickerItems(refs, "new branch")).toEqual({
      items: ["main", "feature/a", `${CREATE_BRANCH_PREFIX}new-branch`],
      createName: "new-branch",
    });
    expect(nativeBranchPickerItems(refs, "main").createName).toBeNull();
  });
});

describe("isLinkedWorktreeGitFile", () => {
  it("recognises a linked worktree's .git file", () => {
    expect(isLinkedWorktreeGitFile("gitdir: /repo/.git/worktrees/demo-wt\n")).toBe(true);
  });

  it("rejects submodule pointers, unreadable files and empty contents", () => {
    expect(isLinkedWorktreeGitFile("gitdir: ../.git/modules/lib\n")).toBe(false);
    expect(isLinkedWorktreeGitFile("")).toBe(false);
    expect(isLinkedWorktreeGitFile(null)).toBe(false);
  });
});
