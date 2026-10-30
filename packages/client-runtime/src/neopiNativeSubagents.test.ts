import { describe, expect, it } from "vite-plus/test";
import {
  disconnectNativeSubagents,
  reduceNativeSubagents,
  snapshotNativeSubagents,
} from "./neopiNativeSubagents.ts";
import { deriveAgentPanelModel } from "./state/subagentRuntime.ts";

const at = "2026-10-29T00:00:00.000Z";
const owner = { parentToolCallId: "task-1", sessionFile: "/artifacts/worker.jsonl" };
const lifecycle = (status: string, extra: Record<string, unknown> = {}) => ({
  type: "subagent_lifecycle",
  payload: { id: "worker", agent: "scout", index: 0, status, ...owner, ...extra },
});
const progress = (extra: Record<string, unknown> = {}, ownership = owner) => ({
  type: "subagent_progress",
  payload: {
    agent: "scout",
    index: 0,
    task: "Inspect native protocol",
    ...ownership,
    progress: {
      id: "worker",
      status: "running",
      tokens: 120,
      toolCount: 3,
      durationMs: 1000,
      recentOutput: ["Reading protocol"],
      ...extra,
    },
  },
});
const snapshot = (extra: Record<string, unknown> = {}) => ({
  id: "worker",
  agent: "scout",
  index: 0,
  status: "running",
  ...owner,
  progress: { id: "worker", status: "running", tokens: 120, toolCount: 3, durationMs: 1000 },
  ...extra,
});

describe("native subagent roster", () => {
  it("projects nested native progress and observed model facts directly into the stock panel", () => {
    let agents = reduceNativeSubagents([], lifecycle("started", { model: "@configured" }), 1, at);
    expect(agents[0]?.model).toBeNull();
    agents = reduceNativeSubagents(
      agents,
      progress({
        currentTool: "read",
        lastIntent: "Checking cancellation",
        resolvedModelIdentity: "provider/observed",
        resolvedModel: "provider/observed:high",
        resolvedThinkingLevel: "high",
        modelOverride: "@role",
      }),
      2,
      at,
    );
    agents = reduceNativeSubagents(
      agents,
      progress({
        resolvedModelIdentity: "provider/fallback",
        resolvedThinkingLevel: "low",
      }),
      3,
      at,
    );
    const panel = deriveAgentPanelModel({ agents });
    expect(panel.runningCount).toBe(1);
    expect(panel.totalTokens).toBe(120);
    expect(agents[0]).toMatchObject({
      id: "worker",
      role: "scout",
      model: "provider/fallback",
      effort: "low",
      status: "running",
      activationCount: 1,
      usage: { totalTokens: 120, toolUses: 3, durationMs: 1000 },
    });
  });

  it("keeps completion and usage when an older active snapshot or late progress arrives", () => {
    let agents = reduceNativeSubagents([], lifecycle("started"), 1, at);
    agents = reduceNativeSubagents(agents, progress(), 2, at);
    const readRevision = 2;
    agents = reduceNativeSubagents(
      agents,
      progress({ status: "completed", tokens: 150, recentOutput: ["Found the boundary"] }),
      3,
      at,
    );
    agents = reduceNativeSubagents(agents, lifecycle("completed"), 4, at);
    agents = snapshotNativeSubagents(agents, [snapshot()], readRevision, 5, at);
    agents = reduceNativeSubagents(agents, progress({ tokens: 160 }), 6, at);
    expect(agents[0]).toMatchObject({
      status: "completed",
      result: "Found the boundary",
      usage: { totalTokens: 150 },
    });
    expect(deriveAgentPanelModel({ agents }).runningCount).toBe(0);
  });

  it("does not resurrect missing agents on reconnect or charge repeated cumulative snapshots", () => {
    let agents = reduceNativeSubagents([], lifecycle("started"), 1, at);
    agents = reduceNativeSubagents(agents, progress(), 2, at);
    agents = reduceNativeSubagents(
      agents,
      {
        type: "subagent_lifecycle",
        payload: { id: "finished", status: "completed", agent: "task", index: 1 },
      },
      3,
      at,
    );
    agents = disconnectNativeSubagents(agents, 4, at);
    expect(deriveAgentPanelModel({ agents }).runningCount).toBe(0);
    agents = snapshotNativeSubagents(agents, [snapshot()], 4, 5, at);
    agents = snapshotNativeSubagents(agents, [snapshot()], 5, 6, at);
    expect(agents.find((agent) => agent.id === "worker")).toMatchObject({
      status: "running",
      activationCount: 1,
      usage: { totalTokens: 120 },
    });
    agents = disconnectNativeSubagents(agents, 7, at);
    agents = snapshotNativeSubagents(agents, [], 7, 8, at);
    expect(agents.map((agent) => [agent.id, agent.status])).toEqual([
      ["worker", "interrupted"],
      ["finished", "completed"],
    ]);
    expect(deriveAgentPanelModel({ agents }).totalTokens).toBe(120);
  });

  it("reactivates a reused id without terminal detail or stale owner frames and accumulates each activation once", () => {
    let agents = reduceNativeSubagents([], lifecycle("started"), 1, at);
    agents = reduceNativeSubagents(
      agents,
      progress({ resolvedModelIdentity: "provider/old", resolvedThinkingLevel: "high" }),
      2,
      at,
    );
    agents = reduceNativeSubagents(agents, lifecycle("aborted"), 3, at);
    expect(agents[0]?.status).toBe("cancelled");
    const nextOwner = { parentToolCallId: "task-2", sessionFile: owner.sessionFile };
    agents = reduceNativeSubagents(agents, lifecycle("started", nextOwner), 4, at);
    expect(agents[0]).toMatchObject({
      status: "running",
      activationCount: 2,
      result: null,
      error: null,
      model: null,
      effort: null,
      completedAt: null,
      progress: null,
    });
    agents = reduceNativeSubagents(agents, progress({ tokens: 40 }, nextOwner), 5, at);
    agents = reduceNativeSubagents(agents, progress({ tokens: 40 }, nextOwner), 6, at);
    agents = reduceNativeSubagents(agents, lifecycle("completed"), 7, at);
    expect(agents[0]).toMatchObject({ status: "running", usage: { totalTokens: 160 } });
    agents = snapshotNativeSubagents(
      agents,
      [snapshot({ ...nextOwner, progress: { tokens: 40, status: "running" } })],
      7,
      8,
      at,
    );
    expect(agents[0]?.usage?.totalTokens).toBe(160);
  });

  it("preserves starts and progress newer than an empty inventory read", () => {
    let agents = reduceNativeSubagents([], lifecycle("started"), 1, at);
    agents = reduceNativeSubagents(agents, progress(), 2, at);
    agents = snapshotNativeSubagents(agents, [], 1, 3, at);
    expect(agents[0]).toMatchObject({ status: "running", usage: { totalTokens: 120 } });
  });
});
