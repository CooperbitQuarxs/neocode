import { describe, expect, it } from "vite-plus/test";
import {
  EMPTY_NATIVE_ACTIVITY,
  IDLE_SUBAGENT_FLASH,
  cacheHitPercent,
  closeNativeActivity,
  formatActiveDuration,
  nativeActiveMs,
  nativeStatusFacts,
  observeNativeActivity,
  openNativeActivity,
  reduceSubagentFlash,
  subagentFlashFor,
} from "./neopiNativeStatus.ts";
import {
  disconnectNativeSubagents,
  reduceNativeSubagents,
  snapshotNativeSubagents,
} from "./neopiNativeSubagents.ts";

const at = "2026-10-29T00:00:00.000Z";
const lifecycle = (id: string, status: string) => ({
  type: "subagent_lifecycle",
  payload: { id, agent: "scout", index: 0, status, parentToolCallId: `call-${id}` },
});
const apply = (agents: ReturnType<typeof reduceNativeSubagents>, id: string, status: string) =>
  reduceNativeSubagents(agents, lifecycle(id, status), 1, at);

describe("cache hit rate", () => {
  it("is cache reads over every prompt token, as the TUI computes it", () => {
    expect(cacheHitPercent({ input: 100, cacheRead: 300, cacheWrite: 100 })).toBeCloseTo(60);
  });

  it("stays empty until something was served from cache", () => {
    expect(cacheHitPercent({ input: 100, cacheRead: 0, cacheWrite: 50 })).toBeNull();
    expect(cacheHitPercent({})).toBeNull();
  });
});

describe("native status facts", () => {
  const state = {
    model: { provider: "anthropic", id: "claude-opus", name: "Claude Opus 5" },
    thinkingLevel: "high",
    tokensPerSecond: 42.5,
    sessionUsage: {
      input: 10,
      cacheRead: 90,
      cacheWrite: 0,
      cost: 1.5,
      advisorCost: 0.25,
      advisorCostState: "ready",
    },
    contextUsage: { tokens: 50_000, contextWindow: 200_000, percent: 25 },
    hostname: "forge",
    runningJobCount: 2,
  };

  it("projects what NeoPi reported", () => {
    expect(nativeStatusFacts(state)).toEqual({
      model: "Opus 5",
      thinkingLevel: "high",
      cacheHitPercent: 90,
      tokensPerSecond: 42.5,
      context: { percent: 25, tokens: 50_000, contextWindow: 200_000 },
      cost: { amount: 1.75, partial: false },
      hostname: "forge",
      runningJobCount: 2,
    });
  });

  it("marks cost partial until advisor spend is restored, and omits what NeoPi lacks", () => {
    const facts = nativeStatusFacts({
      sessionUsage: { cost: 2, advisorCost: 1, advisorCostState: "restoring" },
      tokensPerSecond: 0,
    });
    expect(facts.cost).toEqual({ amount: 2, partial: true });
    expect(facts).toMatchObject({
      model: null,
      hostname: null,
      runningJobCount: null,
      tokensPerSecond: null,
      context: null,
    });
  });
});

describe("active time", () => {
  it("adds only the windows between agent start and end", () => {
    let activity = openNativeActivity(EMPTY_NATIVE_ACTIVITY, 1_000);
    activity = closeNativeActivity(activity, 4_000);
    activity = openNativeActivity(activity, 10_000);
    expect(nativeActiveMs(activity, 12_500)).toBe(5_500);
    activity = closeNativeActivity(activity, 13_000);
    expect(nativeActiveMs(activity, 99_000)).toBe(6_000);
  });

  it("ignores a repeated start and an end with no start", () => {
    const opened = openNativeActivity(EMPTY_NATIVE_ACTIVITY, 1_000);
    expect(openNativeActivity(opened, 5_000)).toBe(opened);
    expect(closeNativeActivity(EMPTY_NATIVE_ACTIVITY, 5_000)).toBe(EMPTY_NATIVE_ACTIVITY);
  });

  it("takes NeoPi's total when reported and keeps a running turn counting from now", () => {
    const stale = openNativeActivity(EMPTY_NATIVE_ACTIVITY, 1_000);
    const observed = observeNativeActivity(stale, { activeTimeMs: 60_000 }, true, 70_000);
    expect(nativeActiveMs(observed, 75_000)).toBe(65_000);
    expect(observeNativeActivity(stale, { activeTimeMs: 60_000 }, false, 70_000)).toEqual({
      accumulatedMs: 60_000,
      openedAt: null,
    });
  });

  it("keeps frame accounting when NeoPi reports no total, and opens a turn already running", () => {
    expect(observeNativeActivity(EMPTY_NATIVE_ACTIVITY, {}, false, 5_000)).toBe(
      EMPTY_NATIVE_ACTIVITY,
    );
    expect(observeNativeActivity(EMPTY_NATIVE_ACTIVITY, {}, true, 5_000).openedAt).toBe(5_000);
  });

  it("formats whole units", () => {
    expect(formatActiveDuration(4_900)).toBe("4s");
    expect(formatActiveDuration(192_000)).toBe("3m 12s");
    expect(formatActiveDuration(3_900_000)).toBe("1h 05m");
  });
});

describe("subagent flash events", () => {
  it("flashes spawn when a subagent starts", () => {
    expect(subagentFlashFor([], apply([], "a", "started"))).toBe("spawn");
  });

  it("flashes exit when one completes or is aborted, and error when one fails", () => {
    const running = apply([], "a", "started");
    expect(subagentFlashFor(running, apply(running, "a", "completed"))).toBe("exit");
    expect(subagentFlashFor(running, apply(running, "a", "aborted"))).toBe("exit");
    expect(subagentFlashFor(running, apply(running, "a", "failed"))).toBe("error");
  });

  it("stays quiet for progress, repeated terminal frames and the same roster", () => {
    const running = apply([], "a", "started");
    const progressed = reduceNativeSubagents(
      running,
      {
        type: "subagent_progress",
        payload: {
          agent: "scout",
          parentToolCallId: "call-a",
          progress: { id: "a", status: "running", tokens: 5 },
        },
      },
      2,
      at,
    );
    expect(subagentFlashFor(running, progressed)).toBeNull();
    expect(subagentFlashFor(running, running)).toBeNull();
    const done = apply(running, "a", "completed");
    expect(subagentFlashFor(done, apply(done, "a", "completed"))).toBeNull();
  });

  it("reports the most significant change when several land together", () => {
    const before = apply(apply([], "a", "started"), "b", "started");
    const after = apply(apply(apply(before, "a", "completed"), "b", "failed"), "c", "started");
    expect(subagentFlashFor(before, after)).toBe("error");
  });

  it("does not treat a lost connection or its recovery as an exit or a spawn", () => {
    const running = apply([], "a", "started");
    const lost = disconnectNativeSubagents(running, 2, at);
    expect(subagentFlashFor(running, lost)).toBeNull();
    const recovered = snapshotNativeSubagents(
      lost,
      [{ id: "a", agent: "scout", status: "running", parentToolCallId: "call-a" }],
      2,
      3,
      at,
    );
    expect(recovered[0]?.status).toBe("running");
    expect(subagentFlashFor(lost, recovered)).toBeNull();
  });
});

describe("subagent flash state", () => {
  it("restarts the hold on every event and keeps the most significant kind of a burst", () => {
    let state = reduceSubagentFlash(IDLE_SUBAGENT_FLASH, "spawn");
    expect(state).toEqual({ kind: "spawn", pulse: 1 });
    state = reduceSubagentFlash(state, "error");
    state = reduceSubagentFlash(state, "spawn");
    expect(state).toEqual({ kind: "error", pulse: 3 });
  });

  it("settles to neutral and a later event starts a fresh flash", () => {
    let state = reduceSubagentFlash(IDLE_SUBAGENT_FLASH, "error");
    state = reduceSubagentFlash(state, "settle");
    expect(state).toEqual({ kind: null, pulse: 1 });
    expect(reduceSubagentFlash(state, "spawn")).toEqual({ kind: "spawn", pulse: 2 });
    expect(reduceSubagentFlash(state, "settle")).toBe(state);
  });
});
