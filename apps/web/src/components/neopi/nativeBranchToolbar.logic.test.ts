import type { VcsRef } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  CREATE_BRANCH_PREFIX,
  isNativeLinkedWorktree,
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

describe("isNativeLinkedWorktree", () => {
  it("is true when the default branch lives in another checkout", () => {
    expect(
      isNativeLinkedWorktree([
        ref("main", { isDefault: true, worktreePath: "/repo" }),
        ref("wt/a", { current: true, worktreePath: "/worktrees/a" }),
      ]),
    ).toBe(true);
  });

  it("is false on the default branch, in the primary checkout, or without worktree data", () => {
    expect(
      isNativeLinkedWorktree([
        ref("main", { isDefault: true, current: true, worktreePath: "/repo" }),
      ]),
    ).toBe(false);
    expect(
      isNativeLinkedWorktree([
        ref("main", { isDefault: true }),
        ref("feature", { current: true, worktreePath: "/repo" }),
      ]),
    ).toBe(false);
  });
});
