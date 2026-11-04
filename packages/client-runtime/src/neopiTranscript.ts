import type { NeoPiJournalEntry } from "@t3tools/contracts";
import { journalRecord } from "./neopiJournal.ts";

/**
 * Projection of a native NeoPi journal branch into transcript rows the UI can
 * draw as a conversation: user bubbles, assistant prose, collapsed thought,
 * one row per tool call joined with its result, and quiet system notes.
 *
 * Native records stay attached to every row (`entry`) so a debug affordance
 * can reveal the canonical JSON without the projection losing anything.
 */

export interface TranscriptImage {
  readonly src: string;
  readonly mimeType: string;
}

export interface TranscriptFile {
  readonly path: string;
  readonly content: string | null;
  readonly skippedReason: string | null;
  readonly record: Record<string, unknown>;
}

interface RowBase {
  readonly id: string;
  readonly entry: NeoPiJournalEntry;
  readonly timestamp: string;
  /** A live (not yet persisted) message from the current turn. */
  readonly live: boolean;
}

export interface UserRow extends RowBase {
  readonly kind: "user";
  readonly text: string;
  readonly images: ReadonlyArray<TranscriptImage>;
  readonly files: ReadonlyArray<TranscriptFile>;
  readonly steering: boolean;
}

export interface AssistantRow extends RowBase {
  readonly kind: "assistant";
  readonly text: string;
  /** Last text block of a finished assistant message: meta is shown below it. */
  readonly meta: AssistantMeta | null;
}

export interface AssistantMeta {
  readonly model: string | null;
  readonly provider: string | null;
  readonly durationMs: number | null;
  readonly outputTokens: number | null;
  readonly stopReason: string | null;
  readonly errorMessage: string | null;
}

export interface ThinkingRow extends RowBase {
  readonly kind: "thinking";
  readonly text: string;
  readonly summary: boolean;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly intent: string | null;
  readonly arguments: Record<string, unknown>;
}

export interface ToolResult {
  readonly entry: NeoPiJournalEntry;
  readonly text: string;
  readonly images: ReadonlyArray<TranscriptImage>;
  readonly isError: boolean;
  readonly details: unknown;
}

export interface ToolRow extends RowBase {
  readonly kind: "tool";
  readonly call: ToolCall;
  readonly result: ToolResult | null;
  /** Human sentence for the row: the agent's stated intent, else a synthesized label. */
  readonly label: string;
  /** The one argument worth showing beside the label: a command, a path, a query. */
  readonly detail: string | null;
  readonly groupId: string;
}

export interface WorkToggleRow {
  readonly kind: "work-toggle";
  readonly id: string;
  readonly groupId: string;
  readonly count: number;
  readonly failed: number;
  readonly expanded: boolean;
  readonly entry: NeoPiJournalEntry;
  readonly timestamp: string;
  readonly live: boolean;
  /** Labels of the first few hidden steps, for the collapsed summary. */
  readonly preview: ReadonlyArray<string>;
}

export interface NoteRow extends RowBase {
  readonly kind: "note";
  readonly label: string;
  readonly text: string;
  readonly tone: "system" | "notice" | "error";
}

export interface DividerRow extends RowBase {
  readonly kind: "divider";
  readonly text: string;
}

export interface RecordRow extends RowBase {
  readonly kind: "record";
  readonly label: string;
}

export interface CommandRow {
  readonly kind: "command";
  readonly id: string;
  readonly text: string;
}

export type TranscriptRow =
  | UserRow
  | AssistantRow
  | ThinkingRow
  | ToolRow
  | WorkToggleRow
  | NoteRow
  | DividerRow
  | RecordRow
  | CommandRow;

export interface TranscriptSource {
  readonly entries: ReadonlyArray<NeoPiJournalEntry>;
  readonly pending: ReadonlyArray<{
    readonly messageId: string;
    readonly message: Readonly<Record<string, unknown>>;
  }>;
  readonly leafId: string | null;
}

export interface TranscriptOptions {
  /** Show bookkeeping entries (model changes, usage, digests) as records. */
  readonly debug: boolean;
  /** Tool groups the user opened; a group above the fold size stays collapsed otherwise. */
  readonly expandedGroups: ReadonlySet<string>;
  /** Tool rows beyond this count in one run collapse behind a toggle. */
  readonly foldSize?: number;
  /** Local command outputs keyed by the entry id they follow (`null` = before everything). */
  readonly commandOutputs?: ReadonlyMap<string | null, ReadonlyArray<CommandRow>>;
}

const FOLD_SIZE = 6;

export function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((value) => journalRecord(value))
    .flatMap((block) =>
      block.type === "text" && typeof block.text === "string" ? [block.text] : [],
    )
    .join("\n");
}

function blockImages(content: unknown): TranscriptImage[] {
  const source = Array.isArray(content) ? content : [];
  return source.flatMap((value) => {
    const block = journalRecord(value);
    if (
      block.type !== "image" ||
      typeof block.data !== "string" ||
      block.data.length === 0 ||
      typeof block.mimeType !== "string" ||
      !/^image\/(png|jpeg|gif|webp|avif)$/.test(block.mimeType)
    )
      return [];
    return [{ src: `data:${block.mimeType};base64,${block.data}`, mimeType: block.mimeType }];
  });
}

function messageFiles(value: unknown): TranscriptFile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const file = journalRecord(item);
    if (typeof file.path !== "string") return [];
    return [
      {
        path: file.path,
        content: typeof file.content === "string" ? file.content : null,
        skippedReason: typeof file.skippedReason === "string" ? file.skippedReason : null,
        record: file,
      },
    ];
  });
}

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function firstLine(text: string, max = 120): string {
  const line = text.split("\n").find((part) => part.trim().length > 0) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Strip wrapper tags NeoPi uses for injected notices so a preview reads as prose. */
function stripNoticeTags(text: string): string {
  return text
    .replace(/<\/?(system-notice|system-reminder|context-window-rollover|task-result[^>]*)>/g, "")
    .trim();
}

/** Rows that sit between tool calls without starting a new conversational beat. */
export function isWorkFiller(row: TranscriptRow): row is ThinkingRow | NoteRow {
  return row.kind === "thinking" || (row.kind === "note" && row.tone === "system");
}

const TOOL_DETAIL_KEYS: Record<string, ReadonlyArray<string>> = {
  bash: ["command"],
  read: ["path"],
  write: ["path"],
  edit: ["input"],
  glob: ["path"],
  grep: ["pattern"],
  find: ["query"],
  web_search: ["query"],
  eval: ["title", "language"],
  task: ["name"],
  ctl: ["op", "target"],
  todo: ["op"],
  manage_skill: ["name"],
  ask: ["question"],
};

const TOOL_VERB: Record<string, string> = {
  bash: "Ran",
  read: "Read",
  write: "Wrote",
  edit: "Edited",
  glob: "Listed",
  grep: "Searched for",
  find: "Looked up",
  web_search: "Searched the web for",
  eval: "Evaluated",
  task: "Dispatched agents",
  wait: "Waited for background work",
  todo: "Updated the plan",
  ask: "Asked",
  ctl: "Steered a session",
  context_notes: "Saved context notes",
  manage_skill: "Managed a skill",
  new_context: "Requested a new context window",
};

export function toolDetail(name: string, args: Record<string, unknown>): string | null {
  for (const key of TOOL_DETAIL_KEYS[name] ?? []) {
    const value = args[key];
    if (typeof value === "string" && value.trim().length > 0) {
      if (name === "edit") {
        const match = /^\[([^\]#]+)#/.exec(value);
        return match?.[1] ?? firstLine(value);
      }
      return firstLine(value, 160);
    }
    if (typeof value === "number") return String(value);
  }
  return null;
}

export function toolLabel(call: ToolCall, detail: string | null): string {
  if (call.intent) return call.intent;
  const verb = TOOL_VERB[call.name];
  if (verb && detail) return `${verb} ${detail}`;
  if (verb) return verb;
  return call.name;
}

function toolCallFromBlock(block: Record<string, unknown>): ToolCall | null {
  if (block.type !== "toolCall" || typeof block.name !== "string") return null;
  const rawArgs = block.arguments;
  const args =
    typeof rawArgs === "string"
      ? (() => {
          try {
            return journalRecord(JSON.parse(rawArgs));
          } catch {
            return { input: rawArgs };
          }
        })()
      : journalRecord(rawArgs);
  const intent =
    str(block.intent) ??
    str(args.i) ??
    str(args.title) ??
    (typeof args.intent === "string" ? args.intent : null);
  return {
    id: typeof block.id === "string" ? block.id : "",
    name: block.name,
    intent: intent && intent.trim().length > 0 ? intent.trim() : null,
    arguments: args,
  };
}

function assistantMeta(message: Record<string, unknown>): AssistantMeta {
  const usage = journalRecord(message.usage);
  const started = num(message.timestamp);
  const completed = num(message.completedAt);
  return {
    model: str(message.model),
    provider: str(message.provider),
    durationMs:
      num(message.duration) ??
      (started !== null && completed !== null && completed >= started ? completed - started : null),
    outputTokens: num(usage.output),
    stopReason: str(message.stopReason),
    errorMessage: str(message.errorMessage),
  };
}

const bookkeepingLabel = (entry: NeoPiJournalEntry): string => {
  switch (entry.type) {
    case "model_usage":
      return "Model usage";
    case "credential_pin":
      return "Credential pin";
    case "title_change":
      return "Title change";
    case "custom":
      return `Native record · ${String(entry.customType ?? "custom")}`;
    case "session":
      return "Session header";
    default:
      return `Native record · ${entry.type}`;
  }
};

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}k`;
  return String(count);
}

function dividerText(entry: NeoPiJournalEntry): string | null {
  switch (entry.type) {
    case "compaction": {
      const before = num(entry.tokensBefore);
      const after = num(entry.tokensAfter);
      if (before !== null && after !== null)
        return `Context compacted · ${formatTokens(before)} → ${formatTokens(after)} tokens`;
      return "Context compacted";
    }
    case "model_change":
      return `Model changed to ${String(entry.model ?? "unknown")}`;
    case "thinking_level_change":
      return `Reasoning set to ${String(entry.thinkingLevel ?? "unknown")}`;
    case "service_tier_change":
      return "Service tier changed";
    case "reset_boundary":
      return "Context reset · earlier entries stay in the journal";
    case "branch_summary":
      return "Branch summary";
    default:
      return null;
  }
}

/** Entry kinds that mean something to a reader even outside debug mode. */
const VISIBLE_DIVIDERS = new Set([
  "compaction",
  "model_change",
  "thinking_level_change",
  "reset_boundary",
  "branch_summary",
]);

export function projectTranscript(
  source: TranscriptSource,
  options: TranscriptOptions,
): readonly TranscriptRow[] {
  const foldSize = options.foldSize ?? FOLD_SIZE;
  const rows: TranscriptRow[] = [];
  const pendingTools = new Map<string, number>();
  let groupCounter = 0;
  let currentGroup: string | null = null;
  let lastAssistantIndex = -1;

  const appendOutputs = (anchor: string | null) => {
    for (const output of options.commandOutputs?.get(anchor) ?? []) rows.push(output);
    if (options.commandOutputs?.get(anchor)?.length) currentGroup = null;
  };

  const push = (row: TranscriptRow) => {
    rows.push(row);
    if (row.kind !== "tool" && !isWorkFiller(row)) currentGroup = null;
  };

  const openGroup = (seed: string) => {
    if (!currentGroup) currentGroup = `group:${seed}:${groupCounter++}`;
    return currentGroup;
  };

  const visitMessage = (entry: NeoPiJournalEntry, live: boolean) => {
    const message = journalRecord(entry.message);
    const base = { entry, timestamp: entry.timestamp, live };
    const role = str(message.role);
    if (role === "user") {
      push({
        ...base,
        kind: "user",
        id: `${entry.id}:user`,
        text: blockText(message.content),
        images: [...blockImages(message.content), ...blockImages(message.images)],
        files: messageFiles(message.files),
        steering: message.steering === true,
      });
      return;
    }
    if (role === "assistant") {
      const content = Array.isArray(message.content) ? message.content : [];
      const meta = assistantMeta(message);
      const textIndexes = content
        .map((value, index) => (journalRecord(value).type === "text" ? index : -1))
        .filter((index) => index >= 0);
      const lastText = textIndexes.at(-1) ?? -1;
      const finished = !live && meta.stopReason !== null && meta.stopReason !== "toolUse";
      content.forEach((value, index) => {
        const block = journalRecord(value);
        if (block.type === "text" && typeof block.text === "string") {
          if (block.text.trim().length === 0) return;
          push({
            ...base,
            kind: "assistant",
            id: `${entry.id}:${index}`,
            text: block.text,
            meta: finished && index === lastText ? meta : null,
          });
          lastAssistantIndex = rows.length - 1;
          return;
        }
        if (block.type === "thinking" && typeof block.thinking === "string") {
          if (block.thinking.trim().length === 0) return;
          const groupId = openGroup(entry.id);
          rows.push({
            ...base,
            kind: "thinking",
            id: `${entry.id}:${index}`,
            text: block.thinking,
            summary: block.summary === true,
          });
          void groupId;
          return;
        }
        if (block.type === "redactedThinking") return;
        const call = toolCallFromBlock(block);
        if (call) {
          const detail = toolDetail(call.name, call.arguments);
          const groupId = openGroup(entry.id);
          rows.push({
            ...base,
            kind: "tool",
            id: `${entry.id}:${index}`,
            call,
            result: null,
            label: toolLabel(call, detail),
            detail,
            groupId,
          });
          if (call.id) pendingTools.set(call.id, rows.length - 1);
          return;
        }
        if (block.type === "image") {
          push({
            ...base,
            kind: "assistant",
            id: `${entry.id}:${index}`,
            text: "",
            meta: null,
          });
          return;
        }
        if (options.debug)
          push({
            ...base,
            kind: "record",
            id: `${entry.id}:${index}`,
            label: `${String(block.type ?? "unknown")} block`,
          });
      });
      if (content.length === 0 && meta.errorMessage) {
        push({
          ...base,
          kind: "note",
          id: `${entry.id}:error`,
          label: meta.stopReason === "aborted" ? "Interrupted" : "Model error",
          text: meta.errorMessage,
          tone: meta.stopReason === "aborted" ? "system" : "error",
        });
      } else if (meta.errorMessage && finished && lastAssistantIndex < 0) {
        push({
          ...base,
          kind: "note",
          id: `${entry.id}:error`,
          label: "Model error",
          text: meta.errorMessage,
          tone: "error",
        });
      }
      return;
    }
    if (role === "toolResult") {
      const callId = str(message.toolCallId) ?? "";
      const index = pendingTools.get(callId);
      const result: ToolResult = {
        entry,
        text: blockText(message.content),
        images: blockImages(message.content),
        isError: message.isError === true,
        details: message.details,
      };
      if (index !== undefined && rows[index]?.kind === "tool") {
        rows[index] = { ...(rows[index] as ToolRow), result };
        pendingTools.delete(callId);
        return;
      }
      // Orphan result (call not on this page): still a tool row.
      const call: ToolCall = {
        id: callId,
        name: str(message.toolName) ?? "tool",
        intent: null,
        arguments: {},
      };
      const groupId = openGroup(entry.id);
      rows.push({
        ...base,
        kind: "tool",
        id: `${entry.id}:result`,
        call,
        result,
        label: toolLabel(call, null),
        detail: null,
        groupId,
      });
      return;
    }
    if (role === "developer" || role === "custom" || role === "system") {
      const text = blockText(message.content);
      if (message.display === false && !options.debug) return;
      push({
        ...base,
        kind: "note",
        id: `${entry.id}:note`,
        label:
          role === "developer"
            ? "System notice"
            : (str(message.customType)?.replaceAll("-", " ") ?? "Native message"),
        text: stripNoticeTags(text),
        tone: "system",
      });
      return;
    }
    if (options.debug || role !== null)
      push({
        ...base,
        kind: "record",
        id: `${entry.id}:record`,
        label: role ? `${role} message` : "Native message",
      });
  };

  appendOutputs(null);
  for (const entry of source.entries) {
    const base = { entry, timestamp: entry.timestamp, live: false };
    if (entry.type === "message") visitMessage(entry, false);
    else if (entry.type === "custom_message") {
      if (entry.display !== false || options.debug) {
        const customType = str(entry.customType);
        push({
          ...base,
          kind: "note",
          id: `${entry.id}:custom`,
          label:
            customType === "async-result"
              ? "Background result"
              : (customType?.replaceAll("-", " ") ?? "Notice"),
          text: stripNoticeTags(blockText(entry.content)),
          tone: "notice",
        });
      }
    } else if (VISIBLE_DIVIDERS.has(entry.type)) {
      const text = dividerText(entry);
      if (text) push({ ...base, kind: "divider", id: `${entry.id}:divider`, text });
      if (entry.type === "compaction" && options.debug && typeof entry.summary === "string")
        push({
          ...base,
          kind: "note",
          id: `${entry.id}:summary`,
          label: "Compaction summary",
          text: stripNoticeTags(entry.summary),
          tone: "system",
        });
    } else if (options.debug) {
      push({ ...base, kind: "record", id: `${entry.id}:record`, label: bookkeepingLabel(entry) });
    }
    appendOutputs(entry.id);
  }
  for (const { messageId, message } of source.pending) {
    visitMessage(
      { id: `live:${messageId}`, parentId: source.leafId, type: "message", timestamp: "", message },
      true,
    );
  }

  return foldToolRuns(rows, foldSize, options.expandedGroups);
}

/**
 * Long runs of tool work collapse behind one toggle so the conversation keeps
 * its rhythm; the run still in progress at the very end stays open.
 */
function foldToolRuns(
  rows: readonly TranscriptRow[],
  foldSize: number,
  expandedGroups: ReadonlySet<string>,
): readonly TranscriptRow[] {
  const out: TranscriptRow[] = [];
  let index = 0;
  while (index < rows.length) {
    const row = rows[index]!;
    if (row.kind !== "tool" && !isWorkFiller(row)) {
      out.push(row);
      index++;
      continue;
    }
    const groupId =
      row.kind === "tool" ? row.groupId : (findGroupId(rows, index) ?? `group:${row.id}`);
    let end = index + 1;
    while (end < rows.length) {
      const candidate = rows[end]!;
      if (candidate.kind === "tool" && candidate.groupId === groupId) end++;
      else if (isWorkFiller(candidate) && findGroupId(rows, end) === groupId) end++;
      else break;
    }
    const run = rows.slice(index, end);
    const toolRows = run.filter((item): item is ToolRow => item.kind === "tool");
    const trailing = end === rows.length;
    const inProgress = trailing && toolRows.some((item) => item.result === null);
    const expanded = expandedGroups.has(groupId) || inProgress || toolRows.length <= foldSize;
    if (expanded) {
      out.push(...run);
    } else {
      const first = run[0] as ToolRow | ThinkingRow | NoteRow;
      out.push({
        kind: "work-toggle",
        id: `${groupId}:toggle`,
        groupId,
        count: toolRows.length,
        failed: toolRows.filter((item) => item.result?.isError).length,
        expanded: false,
        entry: first.entry,
        timestamp: first.timestamp,
        live: first.live,
        preview: toolRows.slice(0, 3).map((item) => item.label),
      });
    }
    index = end;
  }
  return out;
}

/** A thinking row belongs to the tool group that surrounds it. */
function findGroupId(rows: readonly TranscriptRow[], index: number): string | null {
  for (let cursor = index + 1; cursor < rows.length; cursor++) {
    const row = rows[cursor]!;
    if (row.kind === "tool") return row.groupId;
    if (!isWorkFiller(row)) break;
  }
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const row = rows[cursor]!;
    if (row.kind === "tool") return row.groupId;
    if (!isWorkFiller(row)) break;
  }
  return null;
}

export function transcriptUserText(entries: ReadonlyArray<NeoPiJournalEntry>) {
  return entries.flatMap((entry) => {
    const message = journalRecord(entry.message);
    if (entry.type !== "message" || message.role !== "user") return [];
    return [{ id: entry.id, role: "user" as const, text: blockText(message.content) }];
  });
}
