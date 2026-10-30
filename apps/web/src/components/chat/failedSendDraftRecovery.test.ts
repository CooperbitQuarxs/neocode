import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  EventId,
  MessageId,
  ThreadId,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { useComposerDraftStore } from "../../composerDraftStore";
import {
  restoreFailedSendDraft,
  useFailedSendDraftStore,
  type SubmittedComposerDraft,
} from "./failedSendDraftRecovery";

const target = scopeThreadRef(EnvironmentId.make("local"), ThreadId.make("thread"));
const otherTarget = scopeThreadRef(EnvironmentId.make("remote"), target.threadId);
const messageId = MessageId.make("submitted-message");
const createdAt = "2026-10-30T10:00:00.000Z";
const imageFile = new File(["image bytes"], "capture.png", { type: "image/png" });
const file = new File(["file bytes"], "notes.txt", { type: "text/plain" });
const submitted: SubmittedComposerDraft = {
  prompt: "Keep my prompt and its attachments.",
  images: [
    {
      type: "image",
      id: "capture",
      name: imageFile.name,
      mimeType: imageFile.type,
      sizeBytes: imageFile.size,
      file: imageFile,
      previewUrl: "data:image/png;base64,aW1hZ2UgYnl0ZXM=",
    },
  ],
  files: [
    {
      type: "file",
      id: "notes",
      name: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      file,
    },
  ],
  terminalContexts: [
    {
      id: "output",
      threadId: target.threadId,
      terminalId: "terminal",
      terminalLabel: "Terminal",
      lineStart: 1,
      lineEnd: 1,
      text: "original output",
      createdAt,
    },
  ],
  reviewComments: [
    {
      id: "review",
      sectionId: "section",
      sectionTitle: "Change",
      filePath: "file.ts",
      startIndex: 1,
      endIndex: 1,
      rangeLabel: "Line 1",
      text: "Keep this context too",
      diff: "+change",
    },
  ],
  previewAnnotations: [],
};
const failure = (requestId: string = messageId): OrchestrationThreadActivity => ({
  id: EventId.make(`failure-${requestId}`),
  tone: "error",
  kind: "provider.turn.start.failed",
  summary: "Provider turn start failed",
  payload: { requestId, detail: "Native session unavailable" },
  turnId: null,
  createdAt,
});
const success = (requestId: string = messageId): OrchestrationThreadActivity => ({
  ...failure(requestId),
  id: EventId.make(`success-${requestId}`),
  tone: "info",
  kind: "provider.turn.start.succeeded",
  summary: "Provider accepted prompt",
  payload: { requestId, timelineBypass: true },
});
const reset = () => {
  useFailedSendDraftStore.setState({ submissionsByThreadKey: {} });
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
    stickyModelSelectionByProvider: {},
    stickyActiveProvider: null,
  });
};

beforeEach(reset);
afterEach(reset);

describe("captured provider send recovery", () => {
  it("keeps an orchestration-accepted submission until its exact provider failure and restores once", async () => {
    const recovery = useFailedSendDraftStore.getState();
    recovery.capture(target, messageId, submitted);
    recovery.reconcile(target, []);
    expect(recovery.restore(target, messageId)).toBeNull();
    recovery.reconcile(target, [failure("another-message")]);
    expect(recovery.restore(target, messageId)).toBeNull();
    recovery.reconcile(target, [failure()]);
    const restored = recovery.restore(target, messageId);
    expect(restored?.prompt).toBe(submitted.prompt);
    expect(await restored?.images[0]?.file.text()).toBe("image bytes");
    expect(await restored?.files[0]?.file?.text()).toBe("file bytes");
    expect(restored?.terminalContexts).toEqual(submitted.terminalContexts);
    expect(restored?.reviewComments).toEqual(submitted.reviewComments);
    expect(recovery.restore(target, messageId)).toBeNull();
    expect(useComposerDraftStore.getState().getComposerDraft(target)?.images).toHaveLength(1);
    expect(useComposerDraftStore.getState().getComposerDraft(target)?.files).toHaveLength(1);
  });

  it("releases exact successful sends and does not replay a later failure", () => {
    const recovery = useFailedSendDraftStore.getState();
    recovery.capture(target, messageId, submitted);
    recovery.reconcile(target, [success("another-message")]);
    expect(useFailedSendDraftStore.getState().submissionsByThreadKey).not.toEqual({});
    recovery.reconcile(target, [success()]);
    expect(useFailedSendDraftStore.getState().submissionsByThreadKey).toEqual({});
    recovery.reconcile(target, [failure()]);
    expect(recovery.restore(target, messageId)).toBeNull();
    expect(useComposerDraftStore.getState().getComposerDraft(target)).toBeNull();
  });

  it("leaves newer prose, attachments and explicit settings unchanged until the user clears the draft", () => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(target, "My next draft");
    store.addFiles(target, [{ ...submitted.files[0]!, id: "new-file" }]);
    store.setRuntimeMode(target, "approval-required");
    store.setPrompt(otherTarget, "Another environment, same thread ID");
    const newer = store.getComposerDraft(target);
    const other = store.getComposerDraft(otherTarget);
    expect(restoreFailedSendDraft(target, submitted)).toBeNull();
    expect(store.getComposerDraft(target)).toBe(newer);
    expect(store.getComposerDraft(otherTarget)).toBe(other);

    store.clearComposerContent(target);
    const restored = restoreFailedSendDraft(target, submitted);
    expect(restored?.prompt).toBe(submitted.prompt);
    expect(restored?.runtimeMode).toBe("approval-required");
    expect(restored?.files.map((entry) => entry.id)).toEqual(["notes"]);
    expect(store.getComposerDraft(otherTarget)).toBe(other);
  });

  it("prefers a durable success over a stale failure in a catch-up snapshot", () => {
    const recovery = useFailedSendDraftStore.getState();
    recovery.capture(target, messageId, submitted);
    recovery.reconcile(target, [failure(), success()]);
    expect(useFailedSendDraftStore.getState().submissionsByThreadKey).toEqual({});
    expect(recovery.restore(target, messageId)).toBeNull();
  });

  it("does not revisit historical activity on append, but reconciles replacement snapshots", () => {
    const recovery = useFailedSendDraftStore.getState();
    recovery.capture(target, messageId, submitted);
    let historicalReads = 0;
    const history: OrchestrationThreadActivity = {
      ...failure("old-message"),
      get kind() {
        historicalReads++;
        return "tool.completed";
      },
    };
    recovery.reconcile(target, [history]);
    historicalReads = 0;
    recovery.reconcile(target, [history, failure("other-message")]);
    expect(historicalReads).toBe(0);
    // A reconnect can replace all array rows, not merely append.
    recovery.reconcile(target, [failure(), { ...history }]);
    expect(recovery.restore(target, messageId)?.prompt).toBe(submitted.prompt);
  });

  it("isolates identical message ids across environments", () => {
    const recovery = useFailedSendDraftStore.getState();
    recovery.capture(target, messageId, submitted);
    recovery.capture(otherTarget, messageId, { ...submitted, images: [], files: [] });
    recovery.reconcile(otherTarget, [success()]);
    recovery.reconcile(target, [failure()]);
    expect(recovery.restore(otherTarget, messageId)).toBeNull();
    expect(recovery.restore(target, messageId)?.prompt).toBe(submitted.prompt);
    expect(useComposerDraftStore.getState().getComposerDraft(otherTarget)).toBeNull();
  });

  it("does not overwrite an attachment-only or context-only newer draft", () => {
    const store = useComposerDraftStore.getState();
    store.addImages(target, submitted.images);
    const attachmentDraft = store.getComposerDraft(target);
    expect(restoreFailedSendDraft(target, submitted)).toBeNull();
    expect(store.getComposerDraft(target)).toBe(attachmentDraft);

    store.clearComposerContent(target);
    store.setTerminalContexts(target, submitted.terminalContexts);
    const contextDraft = store.getComposerDraft(target);
    expect(restoreFailedSendDraft(target, submitted)).toBeNull();
    expect(store.getComposerDraft(target)).toBe(contextDraft);
  });

  it("leaves even unfinished whitespace edits untouched", () => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(target, " \n");
    const newer = store.getComposerDraft(target);
    expect(restoreFailedSendDraft(target, submitted)).toBeNull();
    expect(store.getComposerDraft(target)).toBe(newer);
    expect(store.getComposerDraft(target)?.prompt).toBe(" \n");
  });

  it("rebuilds a live image preview after the optimistic message releases the old blob URL", async () => {
    const oldPreview = URL.createObjectURL(imageFile);
    URL.revokeObjectURL(oldPreview);
    const restored = restoreFailedSendDraft(target, {
      ...submitted,
      images: [{ ...submitted.images[0]!, previewUrl: oldPreview }],
    });
    const preview = restored!.images[0]!.previewUrl;
    try {
      expect(preview).not.toBe(oldPreview);
      expect(await (await fetch(preview)).text()).toBe("image bytes");
    } finally {
      URL.revokeObjectURL(preview);
    }
  });
});
