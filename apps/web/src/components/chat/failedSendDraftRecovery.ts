import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { OrchestrationThreadActivity, ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

import {
  composerDraftHasUserContent,
  useComposerDraftStore,
  type ComposerThreadDraftState,
  type ComposerThreadTarget,
} from "../../composerDraftStore";
import { readAttachmentUpload, releaseDraftAttachments } from "../../lib/attachmentUploadQueue";
import { cloneComposerImageForRetry } from "../ChatView.logic";

export type SubmittedComposerDraft = Pick<
  ComposerThreadDraftState,
  "prompt" | "images" | "files" | "terminalContexts" | "previewAnnotations" | "reviewComments"
>;

type CapturedSubmission = {
  readonly draft: SubmittedComposerDraft;
  readonly status: "pending" | "failed";
};

interface FailedSendDraftStore {
  readonly submissionsByThreadKey: Readonly<
    Record<string, Readonly<Record<string, CapturedSubmission>>>
  >;
  capture: (target: ScopedThreadRef, messageId: string, draft: SubmittedComposerDraft) => void;
  reconcile: (target: ScopedThreadRef, activities: readonly OrchestrationThreadActivity[]) => void;
  fail: (target: ScopedThreadRef, messageId: string) => void;
  restore: (target: ScopedThreadRef, messageId: string) => ComposerThreadDraftState | null;
  discard: (target: ScopedThreadRef, messageId: string) => void;
  discardThread: (target: ScopedThreadRef) => void;
}

/** In-memory ownership survives routes, not a renderer reload or window close. */
export const useFailedSendDraftStore = create<FailedSendDraftStore>((set, get) => {
  const previousActivities = new Map<string, readonly OrchestrationThreadActivity[]>();
  const entries = (target: ScopedThreadRef) =>
    get().submissionsByThreadKey[scopedThreadKey(target)] ?? {};
  const remove = (target: ScopedThreadRef, messageId: string) => {
    set((state) => {
      const key = scopedThreadKey(target);
      const submissions = { ...state.submissionsByThreadKey[key] };
      delete submissions[messageId];
      const submissionsByThreadKey = { ...state.submissionsByThreadKey };
      if (Object.keys(submissions).length === 0) {
        delete submissionsByThreadKey[key];
        previousActivities.delete(key);
      } else submissionsByThreadKey[key] = submissions;
      return { submissionsByThreadKey };
    });
  };
  return {
    submissionsByThreadKey: {},
    capture: (target, messageId, draft) => {
      // Uploads can finish after the composer snapshot was taken. Keep the current
      // server id, especially for a hydrated file whose only bytes live there.
      const files = draft.files.map((file) => {
        const upload = readAttachmentUpload(file.id);
        return upload?.status === "ready" && upload.environmentId === target.environmentId
          ? {
              ...file,
              uploadedAttachmentId: upload.attachmentId,
              uploadEnvironmentId: upload.environmentId,
            }
          : file;
      });
      set((state) => ({
        submissionsByThreadKey: {
          ...state.submissionsByThreadKey,
          [scopedThreadKey(target)]: {
            ...entries(target),
            [messageId]: { draft: { ...draft, files }, status: "pending" },
          },
        },
      }));
    },
    reconcile: (target, activities) => {
      const key = scopedThreadKey(target);
      if (!get().submissionsByThreadKey[key]) return;
      const previous = previousActivities.get(key);
      if (previous === activities) return;
      // Live reducers append immutable events. Snapshots, history prepends and
      // replacement rows lose this tail identity and get a full reconciliation.
      const appended =
        previous !== undefined &&
        previous.length > 0 &&
        activities.length > previous.length &&
        activities[previous.length - 1] === previous[previous.length - 1];
      const changed = appended ? activities.slice(previous.length) : activities;
      previousActivities.set(key, activities);
      // Success is emitted after the provider accepts this exact request, not
      // orchestration admission. Prefer it over a stale failure in a catch-up.
      for (const activity of changed) {
        if (activity.kind !== "provider.turn.start.succeeded") continue;
        const requestId = activityRequestId(activity);
        if (requestId !== null) get().discard(target, requestId);
      }
      for (const activity of changed) {
        if (activity.kind !== "provider.turn.start.failed") continue;
        const requestId = activityRequestId(activity);
        if (requestId !== null) get().fail(target, requestId);
      }
    },
    fail: (target, messageId) => {
      const entry = entries(target)[messageId];
      if (!entry || entry.status === "failed") return;
      set((state) => ({
        submissionsByThreadKey: {
          ...state.submissionsByThreadKey,
          [scopedThreadKey(target)]: {
            ...entries(target),
            [messageId]: { ...entry, status: "failed" },
          },
        },
      }));
    },
    restore: (target, messageId) => {
      const submissions = entries(target);
      const entry = submissions[messageId];
      if (
        !entry ||
        entry.status !== "failed" ||
        Object.values(submissions).some((other) => other !== entry && other.status === "pending")
      )
        return null;
      const restored = restoreFailedSendDraft(target, entry.draft);
      // This is a transfer: the restored composer now owns the pending uploads.
      if (restored) remove(target, messageId);
      return restored;
    },
    discard: (target, messageId) => {
      const entry = entries(target)[messageId];
      if (!entry) return;
      remove(target, messageId);
      releaseDraftAttachments([...entry.draft.images, ...entry.draft.files]);
    },
    discardThread: (target) => {
      for (const messageId of Object.keys(entries(target))) get().discard(target, messageId);
    },
  };
});

function activityRequestId(activity: OrchestrationThreadActivity): string | null {
  const payload = activity.payload;
  return typeof payload === "object" &&
    payload !== null &&
    "requestId" in payload &&
    typeof payload.requestId === "string"
    ? payload.requestId
    : null;
}

/** Restore only into an empty draft; a retained recovery never overwrites newer work. */
export function restoreFailedSendDraft(
  target: ComposerThreadTarget,
  submitted: SubmittedComposerDraft,
): ComposerThreadDraftState | null {
  const store = useComposerDraftStore.getState();
  const current = store.getComposerDraft(target);
  if ((current?.prompt.length ?? 0) > 0 || composerDraftHasUserContent(current)) return null;
  store.addImages(target, submitted.images.map(cloneComposerImageForRetry), {
    allowDuplicates: true,
  });
  store.addFiles(target, submitted.files, { allowDuplicates: true, appendReference: false });
  store.setTerminalContexts(target, submitted.terminalContexts);
  store.setPreviewAnnotations(target, submitted.previewAnnotations);
  store.setReviewComments(target, submitted.reviewComments);
  store.setPrompt(target, submitted.prompt);
  return useComposerDraftStore.getState().getComposerDraft(target);
}
