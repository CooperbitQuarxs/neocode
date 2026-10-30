import { beforeEach, describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { workspaceResourceId } from "@t3tools/client-runtime/environment";

import {
  cacheTerminalGridSize,
  getCachedTerminalGridSize,
  resetTerminalUiStateCaches,
} from "./terminalUiState";

describe("terminalUiState", () => {
  beforeEach(() => {
    resetTerminalUiStateCaches();
  });

  it("does not reuse a native grid across environments, provider profiles or session files", () => {
    const workspace = {
      environmentId: EnvironmentId.make("env-native"),
      ref: {
        providerInstanceId: ProviderInstanceId.make("neopi-a"),
        sessionFile: "/sessions/native.jsonl",
      },
    };
    const target = {
      environmentId: workspace.environmentId,
      threadId: workspaceResourceId(workspace),
      terminalId: "default",
    };
    const others = [
      { ...workspace, environmentId: EnvironmentId.make("env-other") },
      {
        ...workspace,
        ref: { ...workspace.ref, providerInstanceId: ProviderInstanceId.make("neopi-b") },
      },
      { ...workspace, ref: { ...workspace.ref, sessionFile: "/sessions/other.jsonl" } },
    ];
    cacheTerminalGridSize(target, { cols: 120, rows: 40 });
    for (const other of others) {
      expect(
        getCachedTerminalGridSize({
          environmentId: other.environmentId,
          threadId: workspaceResourceId(other),
          terminalId: "default",
        }),
      ).toBeNull();
    }
    expect(getCachedTerminalGridSize(target)).toEqual({ cols: 120, rows: 40 });
  });

  it("stores terminal grid sizes per terminal target", () => {
    const primaryTarget = {
      environmentId: EnvironmentId.make("env-1"),
      threadId: ThreadId.make("thread-1"),
      terminalId: "default",
    };
    const otherTarget = {
      environmentId: EnvironmentId.make("env-1"),
      threadId: ThreadId.make("thread-1"),
      terminalId: "term-2",
    };

    expect(getCachedTerminalGridSize(primaryTarget)).toBeNull();
    expect(
      cacheTerminalGridSize(primaryTarget, {
        cols: 107.9,
        rows: 33.2,
      }),
    ).toEqual({
      cols: 107,
      rows: 33,
    });
    expect(getCachedTerminalGridSize(primaryTarget)).toEqual({
      cols: 107,
      rows: 33,
    });
    expect(getCachedTerminalGridSize(otherTarget)).toBeNull();
  });
});
