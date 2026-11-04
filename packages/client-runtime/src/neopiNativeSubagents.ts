import {
  isTerminalSubagentStatus,
  type RuntimeSubagent,
  type RuntimeSubagentStatus,
  type SubagentUsage,
} from "./state/subagentRuntime.ts";

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === "string" ? value : null);
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

/** Observed facts the source-neutral panel model has no field for; absent until NeoPi reports them. */
export interface NativeSubagentFacts {
  /** The assignment NeoPi gave the child, else its short task line. */
  readonly task: string | null;
  readonly requests: number | null;
  readonly cost: number | null;
  /** Current per-turn context size against the model's window. */
  readonly contextTokens: number | null;
  readonly contextWindow: number | null;
  /** Only `get_subagents` rows carry live fast-mode state. */
  readonly fast: { readonly enabled: boolean; readonly active: boolean } | null;
  readonly recentTools: readonly {
    readonly tool: string;
    readonly args: string;
    readonly isError: boolean;
  }[];
}

/** Native ownership and read barriers stay out of the source-neutral panel model. */
export interface NativeSubagent extends RuntimeSubagent {
  readonly native: {
    readonly revision: number;
    readonly parentToolCallId: string | null;
    readonly sessionFile: string | null;
    readonly disconnected: boolean;
    readonly usageBase: SubagentUsage | null;
    readonly facts: NativeSubagentFacts;
  };
}

const EMPTY_FACTS: NativeSubagentFacts = {
  task: null,
  requests: null,
  cost: null,
  contextTokens: null,
  contextWindow: null,
  fast: null,
  recentTools: [],
};

function facts(
  previous: NativeSubagentFacts | undefined,
  payload: Record<string, unknown>,
  progress: Record<string, unknown>,
): NativeSubagentFacts {
  const before = previous ?? EMPTY_FACTS;
  const enabled = payload.fastModeEnabled ?? progress.fastModeEnabled;
  const active = payload.fastModeActive ?? progress.fastModeActive;
  const tools = Array.isArray(progress.recentTools)
    ? progress.recentTools.flatMap((value) => {
        const tool = record(value);
        return typeof tool.tool === "string"
          ? [{ tool: tool.tool, args: text(tool.args) ?? "", isError: tool.isError === true }]
          : [];
      })
    : null;
  return {
    task:
      text(payload.assignment) ??
      text(payload.task) ??
      text(progress.assignment) ??
      text(progress.task) ??
      before.task,
    requests: number(progress.requests) ?? before.requests,
    cost: number(progress.cost) ?? before.cost,
    contextTokens: number(progress.contextTokens) ?? before.contextTokens,
    contextWindow: number(progress.contextWindow) ?? before.contextWindow,
    fast:
      typeof enabled === "boolean"
        ? { enabled, active: typeof active === "boolean" ? active : enabled }
        : before.fast,
    recentTools: tools ? tools.slice(-8) : before.recentTools,
  };
}

function status(value: unknown): RuntimeSubagentStatus | null {
  switch (value) {
    case "started":
      return "running";
    case "pending":
    case "running":
    case "completed":
    case "failed":
      return value;
    case "aborted":
      return "cancelled";
    default:
      return null;
  }
}

function sameOwner(agent: NativeSubagent, payload: Record<string, unknown>) {
  if (agent.native.parentToolCallId && typeof payload.parentToolCallId === "string")
    return agent.native.parentToolCallId === payload.parentToolCallId;
  return (
    !agent.native.sessionFile ||
    typeof payload.sessionFile !== "string" ||
    agent.native.sessionFile === payload.sessionFile
  );
}

function usage(
  previous: SubagentUsage | null,
  base: SubagentUsage | null,
  progress: Record<string, unknown>,
): SubagentUsage | null {
  const tokens = number(progress.tokens);
  const tools = number(progress.toolCount);
  const duration = number(progress.durationMs);
  if (tokens === undefined && tools === undefined && duration === undefined) return previous;
  // Progress is cumulative per activation. Never add the same snapshot twice.
  return {
    totalTokens: Math.max(previous?.totalTokens ?? 0, (base?.totalTokens ?? 0) + (tokens ?? 0)),
    ...(tools !== undefined || previous?.toolUses !== undefined
      ? {
          toolUses: Math.max(previous?.toolUses ?? 0, (base?.toolUses ?? 0) + (tools ?? 0)),
        }
      : {}),
    ...(duration !== undefined || previous?.durationMs !== undefined
      ? {
          durationMs: Math.max(
            previous?.durationMs ?? 0,
            (base?.durationMs ?? 0) + (duration ?? 0),
          ),
        }
      : {}),
  };
}

function observe(
  previous: NativeSubagent | undefined,
  payload: Record<string, unknown>,
  progress: Record<string, unknown>,
  id: string,
  nextStatus: RuntimeSubagentStatus,
  revision: number,
  at: string,
  reactivate: boolean,
): NativeSubagent {
  const fresh = !previous || reactivate;
  const base = reactivate ? (previous?.usage ?? null) : (previous?.native.usageBase ?? null);
  const output = Array.isArray(progress.recentOutput)
    ? progress.recentOutput
        .filter((line): line is string => typeof line === "string")
        .join("\n")
        .slice(-2000)
    : null;
  const summary = text(progress.lastIntent) ?? output;
  const terminal = isTerminalSubagentStatus(nextStatus);
  const history = fresh ? [] : previous.recentActivity;
  const recentSummary = summary?.slice(-180);
  const recentActivity =
    recentSummary && history.at(-1)?.summary !== recentSummary
      ? [...history, { at, summary: recentSummary }].slice(-6)
      : history;
  return {
    id,
    kind: "subagent",
    title:
      text(payload.description) ??
      text(progress.description) ??
      text(payload.task) ??
      (fresh ? null : previous.title) ??
      text(payload.agent) ??
      id,
    role: text(payload.agent) ?? previous?.role ?? null,
    // Configured modelOverride/model/role selectors are not observed execution facts.
    model:
      text(payload.resolvedModelIdentity) ??
      text(progress.resolvedModelIdentity) ??
      text(payload.resolvedModel) ??
      text(progress.resolvedModel) ??
      (fresh ? null : previous.model),
    effort:
      text(payload.resolvedThinkingLevel) ??
      text(progress.resolvedThinkingLevel) ??
      (fresh ? null : previous.effort),
    status: nextStatus,
    activationCount: (previous?.activationCount ?? 0) + (fresh ? 1 : 0),
    usage: usage(previous?.usage ?? null, base, progress),
    progress: summary ?? (fresh ? null : previous.progress),
    lastToolName: text(progress.currentTool) ?? (fresh ? null : previous.lastToolName),
    result: terminal ? (output ?? (fresh ? null : previous.result)) : null,
    error: terminal
      ? (text(record(progress.retryFailure).errorMessage) ?? (fresh ? null : previous.error))
      : null,
    outputFile: null,
    parentAgentId: null,
    agentIndex: number(payload.index) ?? previous?.agentIndex ?? null,
    phaseIndex: null,
    phaseTitle: null,
    attempt: null,
    workflowName: null,
    phases: previous?.phases ?? [],
    runHandles: null,
    recentActivity,
    firstSeenAt: previous?.firstSeenAt ?? at,
    startedAt: fresh ? (terminal ? null : at) : previous.startedAt,
    completedAt: terminal ? (fresh ? at : (previous.completedAt ?? at)) : null,
    updatedAt: at,
    native: {
      revision,
      parentToolCallId: text(payload.parentToolCallId) ?? previous?.native.parentToolCallId ?? null,
      sessionFile: text(payload.sessionFile) ?? previous?.native.sessionFile ?? null,
      disconnected: false,
      usageBase: base,
      facts: facts(fresh ? undefined : previous.native.facts, payload, progress),
    },
  };
}

/** Direct projection of native frames; no orchestration activities or journal writes. */
export function reduceNativeSubagents(
  agents: readonly NativeSubagent[],
  frame: Record<string, unknown>,
  revision: number,
  at: string,
): readonly NativeSubagent[] {
  if (frame.type !== "subagent_lifecycle" && frame.type !== "subagent_progress") return agents;
  const payload = record(frame.payload);
  const progress = frame.type === "subagent_progress" ? record(payload.progress) : {};
  const id = text(frame.type === "subagent_progress" ? progress.id : payload.id);
  const nextStatus = status(frame.type === "subagent_progress" ? progress.status : payload.status);
  if (!id || !nextStatus) return agents;
  const previous = agents.find((agent) => agent.id === id);
  const ownerChanged = previous !== undefined && !sameOwner(previous, payload);
  const start = frame.type === "subagent_lifecycle" && payload.status === "started";
  if (ownerChanged && !start) return agents;
  // Lifecycle is ordered by the native connection. Progress queued before the
  // terminal lifecycle may not revive a finished activation.
  if (
    previous &&
    isTerminalSubagentStatus(previous.status) &&
    !previous.native.disconnected &&
    !start &&
    !isTerminalSubagentStatus(nextStatus)
  )
    return agents;
  const reactivate =
    previous !== undefined &&
    (ownerChanged ||
      (start && isTerminalSubagentStatus(previous.status) && !previous.native.disconnected));
  const agent = observe(previous, payload, progress, id, nextStatus, revision, at, reactivate);
  return previous ? agents.map((item) => (item.id === id ? agent : item)) : [...agents, agent];
}

/** Lost observation is not completion or cancellation; stop advertising liveness. */
export function disconnectNativeSubagents(
  agents: readonly NativeSubagent[],
  revision: number,
  at: string,
): readonly NativeSubagent[] {
  return agents.map((agent) =>
    isTerminalSubagentStatus(agent.status)
      ? agent
      : {
          ...agent,
          status: "interrupted",
          updatedAt: at,
          native: { ...agent.native, disconnected: true, revision },
        },
  );
}

/** get_subagents is an active inventory, not a history of completed children. */
export function snapshotNativeSubagents(
  agents: readonly NativeSubagent[],
  snapshots: readonly unknown[],
  readRevision: number,
  revision: number,
  at: string,
): readonly NativeSubagent[] {
  const inventory = new Map<string, Record<string, unknown>>();
  for (const value of snapshots) {
    const snapshot = record(value);
    const id = text(snapshot.id);
    if (id && status(snapshot.status)) inventory.set(id, snapshot);
  }
  const result = agents.map((agent) => {
    const snapshot = inventory.get(agent.id);
    inventory.delete(agent.id);
    if (agent.native.revision > readRevision) return agent;
    if (!snapshot) {
      if (isTerminalSubagentStatus(agent.status)) return agent;
      return disconnectNativeSubagents([agent], revision, at)[0]!;
    }
    const nextStatus = status(snapshot.status)!;
    const reactivate =
      !sameOwner(agent, snapshot) ||
      (isTerminalSubagentStatus(agent.status) &&
        !agent.native.disconnected &&
        !isTerminalSubagentStatus(nextStatus));
    return observe(
      agent,
      snapshot,
      record(snapshot.progress),
      agent.id,
      nextStatus,
      revision,
      at,
      reactivate,
    );
  });
  for (const [id, snapshot] of inventory)
    result.push(
      observe(
        undefined,
        snapshot,
        record(snapshot.progress),
        id,
        status(snapshot.status)!,
        revision,
        at,
        false,
      ),
    );
  return result;
}
