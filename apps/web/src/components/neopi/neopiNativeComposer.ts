import type { NativeSessionTarget } from "@t3tools/client-runtime/neopi-native-sessions";
import { serializeLegacyContextMessage } from "@t3tools/shared/composerContextLegacySend";
import { collectComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import {
  composerTargetKey,
  useComposerDraftStore,
  type ComposerThreadDraftState,
} from "../../composerDraftStore";
import {
  awaitAttachmentUploads,
  getUploadedAttachments,
  readAttachmentUpload,
  releaseDraftAttachments,
  startAttachmentUpload,
} from "../../lib/attachmentUploadQueue";
import { toKindScopedComposerContextId } from "../../lib/composerContextReferences";
import {
  buildMessageContext,
  previewAnnotationContextId,
  reviewCommentContextId,
  terminalContextReference,
} from "../../lib/composerContextRecords";

/** Upload the submitted snapshot, not whatever draft happens to be visible after the await. */
export async function prepareNativePrompt(
  target: NativeSessionTarget,
  snapshot: ComposerThreadDraftState,
) {
  const media = [...snapshot.images, ...snapshot.files];
  for (const attachment of media) {
    startAttachmentUpload({
      environmentId: target.environmentId,
      image: attachment,
      draftTarget: target,
    });
  }
  await awaitAttachmentUploads(media.map((attachment) => attachment.id));
  const attachments = getUploadedAttachments({
    environmentId: target.environmentId,
    images: media,
  });
  if (!attachments) {
    const missing = media.find((attachment) => {
      const upload = readAttachmentUpload(attachment.id);
      return upload?.status !== "ready" || upload.environmentId !== target.environmentId;
    });
    const upload = missing ? readAttachmentUpload(missing.id) : undefined;
    throw new Error(
      upload?.status === "failed"
        ? upload.reason
        : `Attachment '${missing?.name ?? "file"}' did not finish uploading.`,
    );
  }
  const context = buildMessageContext({
    terminalContexts: snapshot.terminalContexts,
    reviewComments: snapshot.reviewComments,
    previewAnnotations: snapshot.previewAnnotations,
    attachments: media.map((attachment, index) => ({
      attachment,
      attachmentId: attachments[index]!.id,
    })),
  });
  return {
    message: serializeLegacyContextMessage({
      text: snapshot.prompt,
      records: context?.records ?? [],
    }),
    attachments,
  };
}

function hasRevisedRecord<T extends { id: string }>(
  submitted: readonly T[],
  current: readonly T[],
) {
  return submitted.some((sent) =>
    current.some((record) => record.id === sent.id && record !== sent),
  );
}

/** Remove only accepted content; edits and newly added records/media survive an in-flight send. */
export function remainingNativeDraft(
  current: ComposerThreadDraftState,
  submitted: ComposerThreadDraftState,
): ComposerThreadDraftState {
  if (
    !current.prompt.startsWith(submitted.prompt) ||
    hasRevisedRecord(submitted.terminalContexts, current.terminalContexts) ||
    hasRevisedRecord(submitted.previewAnnotations, current.previewAnnotations) ||
    hasRevisedRecord(submitted.reviewComments, current.reviewComments) ||
    submitted.images.some((sent) =>
      current.images.some((image) => image.id === sent.id && image.file !== sent.file),
    ) ||
    submitted.files.some((sent) =>
      current.files.some((file) => file.id === sent.id && file.file !== sent.file),
    )
  )
    return current;
  const prompt = current.prompt.slice(submitted.prompt.length);
  const referenced = new Set<string>(
    collectComposerContextReferences(prompt).map((reference) => reference.contextId),
  );
  const images = current.images.filter(
    (image) =>
      !submitted.images.some((sent) => sent.id === image.id && sent.file === image.file) ||
      referenced.has(toKindScopedComposerContextId("image", image.id)),
  );
  const files = current.files.filter(
    (file) =>
      !submitted.files.some((sent) => sent.id === file.id && sent.file === file.file) ||
      referenced.has(toKindScopedComposerContextId("file", file.id)),
  );
  const terminalContexts = current.terminalContexts.filter(
    (context) =>
      !submitted.terminalContexts.includes(context) ||
      referenced.has(terminalContextReference(context).contextId),
  );
  const previewAnnotations = current.previewAnnotations.filter(
    (annotation) =>
      !submitted.previewAnnotations.includes(annotation) ||
      referenced.has(previewAnnotationContextId(annotation.id)),
  );
  const reviewComments = current.reviewComments.filter(
    (comment) =>
      !submitted.reviewComments.includes(comment) ||
      referenced.has(reviewCommentContextId(comment.id)),
  );
  const imageIds = new Set(images.map((image) => image.id));
  return {
    ...current,
    prompt,
    images,
    files,
    terminalContexts,
    previewAnnotations,
    reviewComments,
    persistedAttachments: current.persistedAttachments.filter((image) => imageIds.has(image.id)),
    nonPersistedImageIds: current.nonPersistedImageIds.filter((id) => imageIds.has(id)),
  };
}

export function consumeNativeDraft(
  target: NativeSessionTarget,
  submitted: ComposerThreadDraftState,
) {
  const key = composerTargetKey(target);
  const consumed: (
    | ComposerThreadDraftState["images"][number]
    | ComposerThreadDraftState["files"][number]
  )[] = [];
  useComposerDraftStore.setState((state) => {
    const current = state.draftsByThreadKey[key];
    if (!current) return state;
    const remaining = remainingNativeDraft(current, submitted);
    consumed.push(
      ...current.images.filter((image) => !remaining.images.includes(image)),
      ...current.files.filter((file) => !remaining.files.includes(file)),
    );
    return { draftsByThreadKey: { ...state.draftsByThreadKey, [key]: remaining } };
  });
  // Native prompt acceptance guarantees durable model-readable copies before these draft uploads leave.
  releaseDraftAttachments(consumed);
  for (const attachment of consumed) {
    if (attachment.type === "image" && attachment.previewUrl.startsWith("blob:"))
      URL.revokeObjectURL(attachment.previewUrl);
  }
}
