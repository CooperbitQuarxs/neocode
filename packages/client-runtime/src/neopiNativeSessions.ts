import type {
  EnvironmentId,
  NeoPiJournalEntry,
  NeoPiJournalPage,
  NeoPiNativeSessionRef,
  WS_METHODS,
} from "@t3tools/contracts";
import type { EnvironmentRpcSuccess, EnvironmentRpcStreamValue } from "./rpc/client.ts";
import {
  emptyNativeConversation,
  reduceNativeConversation,
  sameNativeSession,
  type NativeConversation,
  type NativeIdentity,
} from "./neopiConversation.ts";
import { applyNativeConversationEvent } from "./state/neopiConversation.ts";

export type NativeSession = EnvironmentRpcSuccess<typeof WS_METHODS.neopiNativeSessionsOpen>;
export type NativeSessionList = EnvironmentRpcSuccess<typeof WS_METHODS.neopiNativeSessionsList>;
export type NativeSessionEvent = EnvironmentRpcStreamValue<
  typeof WS_METHODS.neopiNativeSessionsWatch
>;
export type NativeSessionUpdate =
  | NativeSessionEvent
  | { type: "disconnected" }
  | { type: "state"; state: Record<string, unknown> }
  | {
      type: "page";
      page: NeoPiJournalPage;
      revision: number;
      older: boolean;
      identity?: NativeIdentity;
    }
  | { type: "reconciliation"; operation: "state" | "branch"; error: string | null };
export interface NativeSessionTarget {
  readonly environmentId: EnvironmentId;
  readonly ref: NeoPiNativeSessionRef;
}
export const nativeSessionKey = ({ environmentId, ref }: NativeSessionTarget) =>
  JSON.stringify([environmentId, ref.providerInstanceId, ref.sessionFile]);
export const nativeRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export interface NativeSessionFeed {
  readonly session: NativeSession | null;
  readonly conversation: NativeConversation;
  readonly connected: boolean;
  readonly busy: boolean;
  readonly dialogs: readonly Record<string, unknown>[];
  readonly notices: Readonly<Record<string, string>>;
  readonly editor: { readonly id: string; readonly text: string } | null;
  readonly error: string | null;
  readonly reconciliationError: {
    readonly operation: "state" | "branch";
    readonly message: string;
  } | null;
}
export const emptyNativeSessionFeed = (): NativeSessionFeed => ({
  session: null,
  conversation: emptyNativeConversation(),
  connected: false,
  busy: false,
  dialogs: [],
  notices: {},
  editor: null,
  error: null,
  reconciliationError: null,
});

export function nativeJournalPage(value: unknown): NeoPiJournalPage | null {
  const page = nativeRecord(value);
  if (
    typeof page.sessionId !== "string" ||
    typeof page.sessionFile !== "string" ||
    !(page.leafId === null || typeof page.leafId === "string") ||
    !Array.isArray(page.entries) ||
    typeof page.totalEntries !== "number"
  )
    return null;
  return page as unknown as NeoPiJournalPage;
}

function retainNativePending(
  previous: NativeConversation,
  next: NativeConversation,
): NativeConversation {
  if (!next.identity || !sameNativeSession(previous.identity, next.identity)) return next;
  // State/page reads can predate a turn. Only native persistence IDs retire
  // cached live messages; stream snapshots upsert their own stable message ID.
  const entries = new Set(next.entries.map((entry) => entry.id));
  return {
    ...next,
    persisted: previous.persisted,
    pending: previous.pending.filter(
      (message) => !entries.has(previous.persisted.get(message.messageId) ?? ""),
    ),
  };
}

/** Cache is a projection of the canonical native file, never a second session journal. */
export function reduceNativeSessionFeed(
  feed: NativeSessionFeed,
  event: NativeSessionUpdate,
): NativeSessionFeed {
  if (event.type === "reconciliation") {
    if (event.error !== null)
      return {
        ...feed,
        error: event.error,
        reconciliationError: { operation: event.operation, message: event.error },
      };
    return feed.reconciliationError?.operation === event.operation
      ? {
          ...feed,
          error: feed.error === feed.reconciliationError.message ? null : feed.error,
          reconciliationError: null,
        }
      : feed;
  }
  if (event.type === "state")
    return feed.session &&
      (typeof event.state.sessionFile !== "string" ||
        event.state.sessionFile === feed.session.ref.sessionFile) &&
      (typeof event.state.sessionId !== "string" ||
        event.state.sessionId === feed.session.sessionId)
      ? { ...feed, session: { ...feed.session, state: event.state } }
      : feed;
  if (event.type === "answered")
    return { ...feed, dialogs: feed.dialogs.filter((dialog) => dialog.id !== event.id) };
  if (event.type === "page") {
    if (
      !event.older &&
      (event.revision !== feed.conversation.revision ||
        !sameNativeSession(feed.conversation.identity, event.page) ||
        (event.identity &&
          (!sameNativeSession(event.identity, event.page) ||
            event.identity.leafId !== feed.conversation.identity?.leafId ||
            event.page.leafId !== event.identity.leafId)))
    )
      return feed;
    const conversation = reduceNativeConversation(
      feed.conversation,
      event.older
        ? { type: "older", page: event.page, revision: event.revision }
        : { type: "snapshot", page: event.page },
    );
    const next = {
      ...feed,
      conversation: event.older
        ? conversation
        : retainNativePending(feed.conversation, conversation),
    };
    return !event.older && next.reconciliationError?.operation === "branch"
      ? {
          ...next,
          error: next.error === next.reconciliationError.message ? null : next.error,
          reconciliationError: null,
        }
      : next;
  }
  if (event.type === "disconnected") return { ...feed, connected: false };
  if (event.type === "closed")
    return { ...feed, connected: false, busy: false, error: event.reason };
  if (event.type === "snapshot") {
    const page = nativeJournalPage(event.journal);
    const previous = feed.conversation;
    const sameFile =
      feed.session?.ref.sessionFile === event.session.ref.sessionFile &&
      feed.session.sessionId === event.session.sessionId;
    const conversation = page
      ? retainNativePending(
          previous,
          reduceNativeConversation(previous, { type: "snapshot", page }),
        )
      : sameFile
        ? previous
        : emptyNativeConversation();
    return {
      ...feed,
      session: event.session,
      conversation,
      connected: true,
      busy: event.session.state.isStreaming === true,
      error: null,
      reconciliationError: null,
    };
  }
  const frame = event.frame;
  if (
    frame.type === "journal_state" &&
    typeof frame.sessionFile === "string" &&
    feed.session &&
    frame.sessionFile !== feed.session.ref.sessionFile
  ) {
    // This cache and its command target belong to the old file. Do not relabel
    // its transcript or silently follow a terminal owner's file switch.
    return {
      ...feed,
      connected: false,
      busy: false,
      dialogs: [],
      editor: null,
      error:
        "The native owner changed session. Select its new native file before sending commands.",
    };
  }
  const projected = applyNativeConversationEvent(
    { conversation: feed.conversation, busy: feed.busy, connection: null },
    { type: "native", event: frame },
  );
  let next: NativeSessionFeed = {
    ...feed,
    conversation: projected.conversation,
    busy: projected.busy ?? feed.busy,
  };
  if (
    frame.type === "journal_state" &&
    typeof frame.sessionId === "string" &&
    next.session &&
    frame.sessionFile === next.session.ref.sessionFile
  )
    next = {
      ...next,
      session: { ...next.session, sessionId: frame.sessionId },
      ...(frame.sessionId !== next.session.sessionId
        ? { busy: false, dialogs: [], editor: null }
        : {}),
    };
  if (
    (frame.type === "tool_approval_request" || frame.type === "plan_proposal_request") &&
    typeof frame.id === "string"
  )
    next = {
      ...next,
      dialogs: [...next.dialogs.filter((dialog) => dialog.id !== frame.id), frame],
    };
  if (frame.type === "tool_approval_cancel" && typeof frame.targetId === "string")
    next = { ...next, dialogs: next.dialogs.filter((dialog) => dialog.id !== frame.targetId) };
  if (frame.type === "plan_proposal_cancel" && typeof frame.id === "string")
    next = { ...next, dialogs: next.dialogs.filter((dialog) => dialog.id !== frame.id) };
  if (frame.type === "extension_ui_request" && typeof frame.id === "string") {
    const method = frame.method;
    if (["select", "confirm", "input", "editor", "ask"].includes(String(method)))
      next = {
        ...next,
        dialogs: [...next.dialogs.filter((dialog) => dialog.id !== frame.id), frame],
      };
    else if (method === "cancel")
      next = { ...next, dialogs: next.dialogs.filter((dialog) => dialog.id !== frame.targetId) };
    else if (method === "set_editor_text" && typeof frame.text === "string")
      next = { ...next, editor: { id: frame.id, text: frame.text } };
    else if (method === "notify" && typeof frame.message === "string")
      next = { ...next, notices: { ...next.notices, notification: frame.message } };
    else if (method === "setStatus" && typeof frame.statusKey === "string")
      next = {
        ...next,
        notices: {
          ...next.notices,
          [frame.statusKey]: typeof frame.statusText === "string" ? frame.statusText : "",
        },
      };
    else if (method === "setWidget" && typeof frame.widgetKey === "string")
      next = {
        ...next,
        notices: {
          ...next.notices,
          [frame.widgetKey]: Array.isArray(frame.widgetLines) ? frame.widgetLines.join("\n") : "",
        },
      };
  }
  if (frame.type === "prompt_result" && frame.status === "error")
    next = {
      ...next,
      error: String(nativeRecord(frame.error).message ?? "Native command failed."),
    };
  if (frame.type === "prompt_result" && frame.status !== "error" && !next.reconciliationError)
    next = { ...next, error: null };
  return next;
}

export function nativeTranscriptEntries(
  conversation: NativeConversation,
  debug: boolean,
): readonly NeoPiJournalEntry[] {
  const entries = debug
    ? conversation.entries
    : conversation.entries.filter(
        (entry) =>
          entry.type === "message" || (entry.type === "custom_message" && entry.display !== false),
      );
  return [
    ...entries,
    ...conversation.pending.map(({ messageId, message }) => ({
      id: `live:${messageId}`,
      parentId: conversation.identity?.leafId ?? null,
      type: "message",
      timestamp: "",
      message,
    })),
  ];
}

export interface NativeCatalogModel {
  readonly provider: string;
  readonly id: string;
  readonly name: string;
  readonly raw: Record<string, unknown>;
}
export function nativeCatalogModels(value: unknown): readonly NativeCatalogModel[] {
  const source = nativeRecord(value).models;
  if (!Array.isArray(source)) return [];
  return source.flatMap((item) => {
    const model = nativeRecord(item);
    return typeof model.provider === "string" && typeof model.id === "string"
      ? [
          {
            provider: model.provider,
            id: model.id,
            name: typeof model.name === "string" ? model.name : model.id,
            raw: model,
          },
        ]
      : [];
  });
}
