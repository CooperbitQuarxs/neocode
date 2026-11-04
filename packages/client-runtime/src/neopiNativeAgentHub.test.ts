import { describe, expect, it } from "vite-plus/test";
import {
  agentContextFill,
  foldAgentTranscript,
  nativeAgentHubAgents,
  summarizeAgentHub,
} from "./neopiNativeAgentHub.ts";
import { reduceNativeSubagents, snapshotNativeSubagents } from "./neopiNativeSubagents.ts";

const at = "2026-10-29T00:00:00.000Z";
const owner = { parentToolCallId: "task-1", sessionFile: "/artifacts/worker.jsonl" };
const progressFrame = (progress: Record<string, unknown>) => ({
  type: "subagent_progress",
  payload: {
    agent: "scout",
    index: 0,
    task: "Inspect native protocol",
    assignment: "Read the protocol and report",
    ...owner,
    progress: { id: "worker", status: "running", tokens: 400, toolCount: 2, ...progress },
  },
});

describe("native agent hub roster", () => {
  it("keeps cost, context, requests and recent tools from progress and fast mode from inventory", () => {
    let agents = reduceNativeSubagents(
      [],
      progressFrame({
        requests: 3,
        cost: 0.25,
        contextTokens: 50_000,
        contextWindow: 200_000,
        recentTools: [
          { tool: "read", args: "a.ts" },
          { tool: "bash", args: "ls", isError: true },
        ],
      }),
      1,
      at,
    );
    agents = snapshotNativeSubagents(
      agents,
      [
        {
          id: "worker",
          agent: "scout",
          index: 0,
          status: "running",
          ...owner,
          fastModeEnabled: true,
          fastModeActive: false,
          progress: { id: "worker", status: "running", requests: 3, cost: 0.25, tokens: 400 },
        },
      ],
      1,
      2,
      at,
    );
    const [agent] = nativeAgentHubAgents(agents, { worker: 4 });
    expect(agent).toMatchObject({
      id: "worker",
      live: true,
      requests: 3,
      cost: 0.25,
      fast: { enabled: true, active: false },
      ticks: 4,
    });
  });

  it("summarizes status counts and only reports cost once an agent reports it", () => {
    const base = nativeAgentHubAgents(
      snapshotNativeSubagents(
        [],
        [
          { id: "a", status: "running", agent: "x", index: 0, progress: { tokens: 10 } },
          { id: "b", status: "completed", agent: "x", index: 1, progress: { tokens: 5 } },
          { id: "c", status: "failed", agent: "x", index: 2, progress: { tokens: 1 } },
        ],
        0,
        1,
        at,
      ),
      {},
    );
    expect(summarizeAgentHub(base)).toMatchObject({
      total: 3,
      working: 1,
      done: 1,
      failed: 1,
      tokens: 16,
      cost: null,
    });
    const withCost = base.map((agent, index) => (index === 0 ? { ...agent, cost: 1.5 } : agent));
    expect(summarizeAgentHub(withCost).cost).toBe(1.5);
  });

  it("derives context fill only from both reported numbers", () => {
    const [agent] = nativeAgentHubAgents(
      snapshotNativeSubagents([], [{ id: "a", status: "running", agent: "x", index: 0 }], 0, 1, at),
      {},
    );
    expect(agentContextFill(agent!)).toBeNull();
    expect(agentContextFill({ ...agent!, contextTokens: 50, contextWindow: 200 })).toBe(0.25);
    expect(agentContextFill({ ...agent!, contextTokens: 500, contextWindow: 200 })).toBe(1);
  });
});

describe("agent transcript folding", () => {
  const entry = (id: string, type = "message") => ({
    id,
    type,
    parentId: null,
    timestamp: at,
    message: { role: "user", content: id },
  });
  const chunk = (fromByte: number, nextByte: number, entries: unknown[], reset = false) => ({
    sessionFile: "/artifacts/worker.jsonl",
    fromByte,
    nextByte,
    reset,
    entries,
    messages: [],
  });

  it("appends incremental chunks, skipping the session header and replays", () => {
    const first = foldAgentTranscript(
      null,
      "worker",
      chunk(0, 100, [{ type: "session", id: "h", timestamp: at }, entry("e1")]),
    );
    expect(first?.entries.map((item) => item.id)).toEqual(["e1"]);
    const second = foldAgentTranscript(
      first,
      "worker",
      chunk(100, 180, [entry("e1"), entry("e2")]),
    );
    expect(second?.entries.map((item) => item.id)).toEqual(["e1", "e2"]);
    expect(second?.nextByte).toBe(180);
  });

  it("ignores a chunk that does not continue from the cursor and restarts on reset", () => {
    const first = foldAgentTranscript(null, "worker", chunk(0, 100, [entry("e1")]));
    expect(foldAgentTranscript(first, "worker", chunk(40, 120, [entry("x")]))).toBe(first);
    const reset = foldAgentTranscript(first, "worker", chunk(0, 30, [entry("n1")], true));
    expect(reset?.entries.map((item) => item.id)).toEqual(["n1"]);
  });

  it("never carries one agent's transcript into another", () => {
    const first = foldAgentTranscript(null, "worker", chunk(0, 100, [entry("e1")]));
    const other = foldAgentTranscript(first, "other", chunk(100, 150, [entry("o1")]));
    expect(other?.agentId).toBe("other");
    expect(other?.entries.map((item) => item.id)).toEqual(["o1"]);
  });
});
