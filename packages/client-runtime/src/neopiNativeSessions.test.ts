import { describe, expect, it } from "vite-plus/test";
import {
  ProviderInstanceId,
  type NeoPiJournalEntry,
  type NeoPiJournalPage,
} from "@t3tools/contracts";
import {
  emptyNativeSessionFeed,
  nativeSessionKey,
  nativeTranscriptEntries,
  reduceNativeSessionFeed,
  type NativeSession,
} from "./neopiNativeSessions.ts";

const ref = {
  providerInstanceId: ProviderInstanceId.make("neopi"),
  sessionFile: "/sessions/conversation.jsonl",
};
const session: NativeSession = {
  ref,
  sessionId: "native-id",
  cwd: "/workspace",
  attachment: "terminal",
  capabilities: [],
  state: { isStreaming: true },
};
const user: NeoPiJournalEntry = {
  id: "user-a",
  parentId: null,
  timestamp: "2026-10-28T00:00:00Z",
  type: "message",
  message: { role: "user", content: "Question" },
};
const initial = () =>
  reduceNativeSessionFeed(emptyNativeSessionFeed(), {
    type: "snapshot",
    session,
    journal: {
      sessionId: session.sessionId,
      sessionFile: ref.sessionFile,
      leafId: user.id,
      entries: [user],
      totalEntries: 1,
    },
  });

describe("canonical native client projection", () => {
  it("recovers missed persistence from an idle snapshot without matching message content", () => {
    let feed = initial();
    const message = { role: "assistant", content: "Identical text is not an identity" };
    for (const messageId of ["finished-live", "unmatched-live"]) {
      feed = reduceNativeSessionFeed(feed, {
        type: "event",
        frame: { type: "message_update", messageId, message },
      });
    }
    feed = reduceNativeSessionFeed(feed, { type: "disconnected" });
    const reply = { ...user, id: "finished-entry", parentId: user.id, message };
    const identity = {
      sessionId: session.sessionId,
      sessionFile: ref.sessionFile,
      leafId: reply.id,
    };
    feed = reduceNativeSessionFeed(feed, {
      type: "snapshot",
      session: { ...session, state: { isStreaming: false } },
      journal: { ...identity, entries: [user, reply], totalEntries: 2 },
    });
    feed = reduceNativeSessionFeed(feed, {
      type: "event",
      frame: {
        type: "journal_state",
        reason: "snapshot",
        ...identity,
        messageEntryIds: [{ messageId: "finished-live", entryId: reply.id }],
      },
    });
    expect(feed.conversation.pending).toEqual([{ messageId: "unmatched-live", message }]);
    expect(nativeTranscriptEntries(feed.conversation, false).map((entry) => entry.id)).toEqual([
      user.id,
      reply.id,
      "live:unmatched-live",
    ]);
    expect(feed.busy).toBe(false);
  });

  it("retains recovery associations until their durable entries arrive on an older page", () => {
    const message = { role: "assistant", content: "Finished before newer turns" };
    let feed = reduceNativeSessionFeed(initial(), {
      type: "event",
      frame: {
        type: "message_update",
        messageId: "missed-live",
        message,
      },
    });
    const reply = { ...user, id: "missed-entry", parentId: user.id, message };
    const latest = { ...user, id: "latest-entry", parentId: reply.id };
    const identity = {
      sessionId: session.sessionId,
      sessionFile: ref.sessionFile,
      leafId: latest.id,
    };
    feed = reduceNativeSessionFeed(feed, {
      type: "event",
      frame: {
        type: "journal_state",
        reason: "snapshot",
        ...identity,
        messageEntryIds: [{ messageId: "missed-live", entryId: reply.id }],
      },
    });
    expect(feed.conversation.pending).toEqual([{ messageId: "missed-live", message }]);
    feed = reduceNativeSessionFeed(feed, {
      type: "snapshot",
      session,
      journal: { ...identity, entries: [latest], totalEntries: 3, nextCursor: "older" },
    });
    expect(feed.conversation.pending).toEqual([{ messageId: "missed-live", message }]);
    feed = reduceNativeSessionFeed(feed, {
      type: "page",
      older: true,
      revision: feed.conversation.revision,
      page: { ...identity, entries: [user, reply], totalEntries: 3 },
    });
    expect(feed.conversation.pending).toEqual([]);
    expect(feed.conversation.entries.map((entry) => entry.id)).toEqual([
      user.id,
      reply.id,
      latest.id,
    ]);
  });

  it("does not infer discarded output from an absent or empty recovery window", () => {
    const message = { role: "assistant", content: "Retained output" };
    const seeded = reduceNativeSessionFeed(initial(), {
      type: "event",
      frame: {
        type: "message_update",
        messageId: "outside-window",
        message,
      },
    });
    for (const recovery of [{}, { messageEntryIds: [] }]) {
      const feed = reduceNativeSessionFeed(seeded, {
        type: "event",
        frame: {
          type: "journal_state",
          reason: "snapshot",
          sessionId: session.sessionId,
          sessionFile: ref.sessionFile,
          leafId: user.id,
          ...recovery,
        },
      });
      expect(feed.conversation.pending).toEqual([{ messageId: "outside-window", message }]);
    }
    const otherFile = reduceNativeSessionFeed(seeded, {
      type: "event",
      frame: {
        type: "journal_state",
        reason: "snapshot",
        sessionId: session.sessionId,
        sessionFile: "/sessions/another.jsonl",
        leafId: user.id,
        messageEntryIds: [{ messageId: "outside-window", entryId: user.id }],
      },
    });
    expect(otherFile.conversation.pending).toEqual([{ messageId: "outside-window", message }]);
    expect(otherFile.conversation.persisted.has("outside-window")).toBe(false);
  });

  it("uses snapshot recovery IDs without rewinding an already hydrated leaf", () => {
    const message = { role: "assistant", content: "Finished" };
    let feed = reduceNativeSessionFeed(initial(), {
      type: "event",
      frame: {
        type: "message_update",
        messageId: "finished-live",
        message,
      },
    });
    const reply = { ...user, id: "finished-entry", parentId: user.id, message };
    const identity = {
      sessionId: session.sessionId,
      sessionFile: ref.sessionFile,
      leafId: reply.id,
    };
    feed = reduceNativeSessionFeed(feed, {
      type: "snapshot",
      session,
      journal: { ...identity, entries: [user, reply], totalEntries: 2 },
    });
    const entries = feed.conversation.entries;
    feed = reduceNativeSessionFeed(feed, {
      type: "event",
      frame: {
        type: "journal_state",
        reason: "snapshot",
        ...identity,
        leafId: user.id,
        messageEntryIds: [{ messageId: "finished-live", entryId: reply.id }],
      },
    });
    expect(feed.conversation.identity?.leafId).toBe(reply.id);
    expect(feed.conversation.entries).toBe(entries);
    expect(feed.conversation.pending).toEqual([]);
  });

  it("retains durable and live content across disconnect and unavailable hydration", () => {
    let feed = reduceNativeSessionFeed(initial(), {
      type: "event",
      frame: {
        type: "message_update",
        messageId: "live-a",
        message: { role: "assistant", content: "Still working" },
      },
    });
    const conversation = feed.conversation;
    feed = reduceNativeSessionFeed(feed, { type: "disconnected" });
    expect(feed.connected).toBe(false);
    expect(feed.conversation).toBe(conversation);
    feed = reduceNativeSessionFeed(feed, { type: "snapshot", session, journal: null });
    expect(nativeTranscriptEntries(feed.conversation, false).map((entry) => entry.message)).toEqual(
      [user.message, { role: "assistant", content: "Still working" }],
    );
  });

  it("continues live updates between a native leaf notification and its durable entry", () => {
    let feed = initial();
    const identity = {
      sessionId: session.sessionId,
      sessionFile: ref.sessionFile,
      leafId: "assistant-b",
    };
    feed = reduceNativeSessionFeed(feed, {
      type: "event",
      frame: { type: "journal_state", reason: "leaf", ...identity },
    });
    feed = reduceNativeSessionFeed(feed, {
      type: "event",
      frame: {
        type: "message_update",
        messageId: "live-b",
        message: { role: "assistant", content: "Answer" },
      },
    });
    expect(feed.conversation.pending[0]?.message.content).toBe("Answer");
    feed = reduceNativeSessionFeed(feed, {
      type: "event",
      frame: {
        type: "message_persisted",
        ...identity,
        messageId: "live-b",
        entryId: "assistant-b",
      },
    });
    feed = reduceNativeSessionFeed(feed, {
      type: "event",
      frame: {
        type: "journal_entry",
        ...identity,
        entry: {
          ...user,
          id: "assistant-b",
          parentId: user.id,
          message: { role: "assistant", content: "Answer" },
        },
      },
    });
    expect(feed.conversation.entries.map((entry) => entry.id)).toEqual(["user-a", "assistant-b"]);
    expect(feed.conversation.pending).toEqual([]);
  });

  it("does not retire pending messages from a pre-turn idle state on reconnect", () => {
    let feed = reduceNativeSessionFeed(initial(), {
      type: "event",
      frame: {
        type: "message_update",
        messageId: "reply-live",
        message: { role: "assistant", content: "Partial reply" },
      },
    });
    feed = reduceNativeSessionFeed(feed, { type: "disconnected" });
    feed = reduceNativeSessionFeed(feed, {
      type: "snapshot",
      session: { ...session, state: { isStreaming: false } },
      journal: {
        sessionId: session.sessionId,
        sessionFile: ref.sessionFile,
        leafId: user.id,
        entries: [user],
        totalEntries: 1,
      },
    });
    expect(nativeTranscriptEntries(feed.conversation, false).map((entry) => entry.message)).toEqual(
      [user.message, { role: "assistant", content: "Partial reply" }],
    );
    feed = reduceNativeSessionFeed(feed, {
      type: "event",
      frame: {
        type: "message_start",
        snapshot: true,
        sessionId: session.sessionId,
        sessionFile: ref.sessionFile,
        leafId: user.id,
        messageId: "reply-live",
        message: { role: "assistant", content: "Reconnected reply" },
      },
    });
    expect(feed.conversation.pending).toEqual([
      { messageId: "reply-live", message: { role: "assistant", content: "Reconnected reply" } },
    ]);
    expect(feed.busy).toBe(true);
  });

  it("reconciles persisted IDs without dropping unrelated pending messages on a stream snapshot", () => {
    let feed = initial();
    for (const [messageId, content] of [
      ["reply-done", "Finished"],
      ["reply-next", "Working"],
    ]) {
      feed = reduceNativeSessionFeed(feed, {
        type: "event",
        frame: {
          type: "message_update",
          messageId,
          message: { role: "assistant", content },
        },
      });
    }
    const reply = {
      ...user,
      id: "reply-entry",
      parentId: user.id,
      message: { role: "assistant", content: "Finished" },
    };
    feed = reduceNativeSessionFeed(feed, {
      type: "event",
      frame: {
        type: "message_persisted",
        sessionId: session.sessionId,
        sessionFile: ref.sessionFile,
        leafId: reply.id,
        messageId: "reply-done",
        entryId: reply.id,
      },
    });
    feed = reduceNativeSessionFeed(feed, {
      type: "snapshot",
      session,
      journal: {
        sessionId: session.sessionId,
        sessionFile: ref.sessionFile,
        leafId: reply.id,
        entries: [user, reply],
        totalEntries: 2,
      },
    });
    feed = reduceNativeSessionFeed(feed, {
      type: "event",
      frame: {
        type: "message_start",
        snapshot: true,
        messageId: "reply-next",
        message: { role: "assistant", content: "Still working" },
      },
    });
    expect(nativeTranscriptEntries(feed.conversation, false).map((entry) => entry.message)).toEqual(
      [user.message, reply.message, { role: "assistant", content: "Still working" }],
    );
    feed = reduceNativeSessionFeed(feed, {
      type: "event",
      frame: {
        type: "message_start",
        snapshot: true,
        messageId: "reply-done",
        message: reply.message,
      },
    });
    expect(feed.conversation.pending.map((message) => message.messageId)).toEqual(["reply-next"]);
  });

  it("rejects an older hydration response after a newer durable append", () => {
    let feed = initial();
    const identity = {
      sessionId: session.sessionId,
      sessionFile: ref.sessionFile,
      leafId: "reply-entry",
    };
    feed = reduceNativeSessionFeed(feed, {
      type: "event",
      frame: { type: "journal_state", reason: "leaf", ...identity },
    });
    const revision = feed.conversation.revision;
    const reply = {
      ...user,
      id: identity.leafId,
      parentId: user.id,
      message: { role: "assistant", content: "Durable" },
    };
    const page: NeoPiJournalPage = { ...identity, entries: [user, reply], totalEntries: 2 };
    feed = reduceNativeSessionFeed(feed, {
      type: "event",
      frame: { type: "journal_entry", ...identity, entry: reply },
    });
    const latest = { ...reply, id: "latest-entry", parentId: reply.id };
    feed = reduceNativeSessionFeed(feed, {
      type: "event",
      frame: { type: "journal_entry", ...identity, leafId: latest.id, entry: latest },
    });
    const durable = feed.conversation;
    feed = reduceNativeSessionFeed(feed, { type: "page", page, revision, identity, older: false });
    expect(feed.conversation).toBe(durable);
    expect(feed.conversation.entries.map((entry) => entry.id)).toEqual([
      user.id,
      reply.id,
      latest.id,
    ]);
    expect(feed.conversation.needsSnapshot).toBe(false);
  });

  it("does not let an older reconnect boundary move a hydrated leaf backwards", () => {
    let feed = initial();
    const identity = {
      sessionId: session.sessionId,
      sessionFile: ref.sessionFile,
      leafId: "reply-entry",
    };
    const reply = { ...user, id: identity.leafId, parentId: user.id };
    feed = reduceNativeSessionFeed(feed, {
      type: "event",
      frame: { type: "journal_entry", ...identity, entry: reply },
    });
    const conversation = feed.conversation;
    feed = reduceNativeSessionFeed(feed, {
      type: "event",
      frame: {
        type: "journal_state",
        reason: "snapshot",
        ...identity,
        leafId: user.id,
      },
    });
    expect(feed.conversation).toBe(conversation);
    expect(feed.conversation.identity?.leafId).toBe(reply.id);
  });

  it("rejects branch pages from a different leaf and stale older-page cursors", () => {
    let feed = initial();
    const identity = feed.conversation.identity!;
    const revision = feed.conversation.revision;
    const page: NeoPiJournalPage = {
      ...identity,
      sessionFile: ref.sessionFile,
      leafId: "other-leaf",
      entries: [user],
      totalEntries: 1,
      nextCursor: "wrong-branch",
    };
    const conversation = feed.conversation;
    feed = reduceNativeSessionFeed(feed, { type: "page", page, revision, identity, older: false });
    expect(feed.conversation).toBe(conversation);
    feed = reduceNativeSessionFeed(feed, {
      type: "page",
      page: { ...page, leafId: identity.leafId },
      revision: revision - 1,
      older: true,
    });
    expect(feed.conversation).toBe(conversation);
    feed = reduceNativeSessionFeed(feed, { type: "page", page, revision, older: true });
    expect(feed.conversation).toBe(conversation);
  });

  it("does not relabel cached content or the command ref when a terminal changes files", () => {
    let feed = initial();
    const conversation = feed.conversation;
    feed = reduceNativeSessionFeed(feed, {
      type: "event",
      frame: {
        type: "journal_state",
        reason: "identity",
        sessionId: "other-session",
        sessionFile: "/sessions/other.jsonl",
        leafId: "other-entry",
      },
    });
    expect(feed.session?.ref).toEqual(ref);
    expect(feed.conversation).toBe(conversation);
    expect(feed.conversation.entries).toEqual([user]);
    expect(feed.connected).toBe(false);
    expect(feed.error).not.toBeNull();
  });

  it("resets the transcript and old dialogs when native replaces identity within the same file", () => {
    let feed = reduceNativeSessionFeed(initial(), {
      type: "event",
      frame: {
        type: "tool_approval_request",
        id: "old-approval",
        toolName: "bash",
      },
    });
    feed = reduceNativeSessionFeed(feed, {
      type: "event",
      frame: {
        type: "message_update",
        messageId: "old-live",
        message: { role: "assistant", content: "Old session" },
      },
    });
    const identity = { sessionId: "replacement", sessionFile: ref.sessionFile, leafId: null };
    feed = reduceNativeSessionFeed(feed, {
      type: "event",
      frame: { type: "journal_state", reason: "identity", ...identity },
    });
    expect(feed.session?.sessionId).toBe(identity.sessionId);
    expect(feed.session?.ref).toEqual(ref);
    expect(feed.conversation.entries).toEqual([]);
    expect(feed.conversation.pending).toEqual([]);
    expect(feed.dialogs).toEqual([]);
    expect(feed.busy).toBe(false);
    feed = reduceNativeSessionFeed(feed, {
      type: "page",
      revision: feed.conversation.revision,
      identity,
      older: false,
      page: { ...identity, entries: [], totalEntries: 0 },
    });
    expect(feed.conversation.identity).toMatchObject(identity);
    expect(feed.conversation.needsSnapshot).toBe(false);
  });

  it("does not clear a newer command error when branch reconciliation recovers", () => {
    let feed = reduceNativeSessionFeed(initial(), {
      type: "reconciliation",
      operation: "branch",
      error: "Branch read failed",
    });
    feed = reduceNativeSessionFeed(feed, {
      type: "event",
      frame: { type: "prompt_result", status: "error", error: { message: "Prompt rejected" } },
    });
    feed = reduceNativeSessionFeed(feed, {
      type: "page",
      revision: feed.conversation.revision,
      older: false,
      page: {
        sessionId: session.sessionId,
        sessionFile: ref.sessionFile,
        leafId: user.id,
        entries: [user],
        totalEntries: 1,
      },
    });
    expect(feed.reconciliationError).toBeNull();
    expect(feed.error).toBe("Prompt rejected");
    expect(feed.conversation.entries).toEqual([user]);
  });

  it("preserves native approval payloads and removes only the native cancellation target", () => {
    const approval = {
      type: "tool_approval_request",
      id: "approval",
      toolCallId: "tool-1",
      toolName: "computer",
      args: { action: "publish" },
      tier: "exec",
      approvalMode: "ask",
      details: ["Publish"],
      safetyChecks: [{ id: "check-1", code: "confirmation", message: "Confirm publish" }],
      timeout: 600_000,
    };
    const plan = {
      type: "plan_proposal_request",
      id: "plan",
      title: "Proposal",
      planFilePath: "/plans/proposal.md",
      planMarkdown: "Plan",
    };
    let feed = reduceNativeSessionFeed(initial(), { type: "event", frame: approval });
    feed = reduceNativeSessionFeed(feed, { type: "event", frame: plan });
    feed = reduceNativeSessionFeed(feed, { type: "event", frame: approval });
    expect(feed.dialogs).toEqual([plan, approval]);
    feed = reduceNativeSessionFeed(feed, {
      type: "event",
      frame: { type: "tool_approval_cancel", id: "new-cancel-id", targetId: approval.id },
    });
    expect(feed.dialogs).toEqual([plan]);
    feed = reduceNativeSessionFeed(feed, {
      type: "event",
      frame: { type: "plan_proposal_cancel", id: plan.id, reason: "mode_change" },
    });
    expect(feed.dialogs).toEqual([]);
  });

  it("clears answered approval IDs without answering another native dialog", () => {
    const approval = { type: "tool_approval_request", id: "approval", toolName: "bash" };
    const plan = { type: "plan_proposal_request", id: "plan", title: "Review" };
    let feed = reduceNativeSessionFeed(initial(), { type: "event", frame: approval });
    feed = reduceNativeSessionFeed(feed, { type: "event", frame: plan });
    feed = reduceNativeSessionFeed(feed, { type: "answered", id: approval.id });
    expect(feed.dialogs).toEqual([plan]);
    feed = reduceNativeSessionFeed(feed, { type: "answered", id: plan.id });
    expect(feed.dialogs).toEqual([]);
  });

  it("keeps bookkeeping inspectable without adding it to ordinary conversation", () => {
    const feed = initial();
    const entries = [
      user,
      { ...user, id: "model", type: "model_change" },
      { ...user, id: "digest", type: "custom", customType: "system-prompt-digest" },
      { ...user, id: "tool", message: { role: "toolResult", content: "Tool output" } },
    ];
    const conversation = { ...feed.conversation, entries };
    expect(nativeTranscriptEntries(conversation, false).map((entry) => entry.id)).toEqual([
      "user-a",
      "tool",
    ]);
    expect(nativeTranscriptEntries(conversation, true)).toEqual(entries);
  });

  it("does not share cache identity across configured profiles or environments", () => {
    const target = { environmentId: "host-a" as import("@t3tools/contracts").EnvironmentId, ref };
    expect(nativeSessionKey(target)).not.toBe(
      nativeSessionKey({
        ...target,
        ref: { ...ref, providerInstanceId: ProviderInstanceId.make("other-profile") },
      }),
    );
    expect(nativeSessionKey(target)).not.toBe(
      nativeSessionKey({
        ...target,
        environmentId: "host-b" as import("@t3tools/contracts").EnvironmentId,
      }),
    );
  });
});
