import type { OrchestrationThreadActivity } from "@t3tools/contracts";

import {
  composerDraftHasUserContent,
  useComposerDraftStore,
  type ComposerThreadDraftState,
  type ComposerThreadTarget,
} from "../../composerDraftStore";
import type { ChatMessage } from "../../types";
import { cloneComposerImageForRetry } from "../ChatView.logic";

export type SubmittedComposerDraft = Pick<
  ComposerThreadDraftState,
  "prompt" | "images" | "files" | "terminalContexts" | "previewAnnotations" | "reviewComments"
>;

/** A command being persisted is not proof that its provider accepted the prompt. */
export function takeFailedSendDrafts(
  pending: Map<string, SubmittedComposerDraft>,
  messages: readonly ChatMessage[],
  activities: readonly OrchestrationThreadActivity[],
): SubmittedComposerDraft[] {
  for (const message of messages) {
    if (message.role === "user" && message.turnId !== null) pending.delete(message.id);
  }
  const failed: SubmittedComposerDraft[] = [];
  for (const activity of activities) {
    if (activity.kind !== "provider.turn.start.failed") continue;
    const requestId =
      typeof activity.payload === "object" &&
      activity.payload !== null &&
      "requestId" in activity.payload &&
      typeof activity.payload.requestId === "string"
        ? activity.payload.requestId
        : null;
    if (requestId === null) continue;
    const draft = pending.get(requestId);
    if (!draft) continue;
    pending.delete(requestId);
    failed.push(draft);
  }
  return failed;
}

/** Restore only into an empty draft; a toast can retain the snapshot while newer work stays put. */
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
