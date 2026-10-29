import { describe, expect, it } from "vite-plus/test";
import { ComposerContextId, EnvironmentId } from "@t3tools/contracts";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import type { ComposerThreadDraftState } from "../../composerDraftStore";
import { terminalContextReference } from "../../lib/composerContextRecords";
import { remainingNativeDraft } from "./neopiNativeComposer";

const draft = (changes: Partial<ComposerThreadDraftState> = {}): ComposerThreadDraftState => ({
  prompt: "Explain the output",
  images: [],
  files: [],
  nonPersistedImageIds: [],
  persistedAttachments: [],
  terminalContexts: [],
  previewAnnotations: [],
  reviewComments: [],
  modelSelectionByProvider: {},
  activeProvider: null,
  runtimeMode: null,
  interactionMode: null,
  ...changes,
});
const selection = {
  id: "selected-lines",
  threadId: "native:resource",
  terminalId: "default",
  terminalLabel: "Terminal",
  lineStart: 1,
  lineEnd: 2,
  text: "original output",
  createdAt: "2026-10-29T00:00:00.000Z",
};
const terminalReference = terminalContextReference(selection);
const reference = formatComposerContextReference({
  ...terminalReference,
  contextId: ComposerContextId.make(terminalReference.contextId),
});
const imageFile = new File(["image"], "capture.png", { type: "image/png" });
const image = {
  type: "image" as const,
  id: "capture",
  name: imageFile.name,
  mimeType: imageFile.type,
  sizeBytes: imageFile.size,
  file: imageFile,
  previewUrl: "data:image/png;base64,aW1hZ2U=",
};
const file = new File(["notes"], "notes.txt", { type: "text/plain" });
const attachment = {
  type: "file" as const,
  id: "notes",
  name: file.name,
  mimeType: file.type,
  sizeBytes: file.size,
  file,
};

describe("accepted native composer snapshots", () => {
  it("consumes the accepted prefix and uploaded file while retaining appended text and new media", () => {
    const submitted = draft({
      files: [attachment],
      terminalContexts: [selection],
      prompt: `Explain ${reference}`,
    });
    const uploadedFile = {
      ...attachment,
      uploadedAttachmentId: "pending-upload",
      uploadEnvironmentId: EnvironmentId.make("remote"),
    };
    const current = {
      ...submitted,
      prompt: submitted.prompt + "\nNext question",
      files: [uploadedFile],
      images: [image],
      nonPersistedImageIds: [image.id],
    };
    const remaining = remainingNativeDraft(current, submitted);
    expect(remaining.prompt).toBe("\nNext question");
    expect(remaining.files).toEqual([]);
    expect(remaining.terminalContexts).toEqual([]);
    expect(remaining.images).toEqual([image]);
    expect(remaining.nonPersistedImageIds).toEqual([image.id]);
  });

  it("retains the whole revised draft when accepted text was edited during the send", () => {
    const submitted = draft({
      images: [image],
      files: [attachment],
      terminalContexts: [selection],
      prompt: `Explain ${reference}`,
    });
    const current = { ...submitted, prompt: `Actually compare ${reference}` };
    expect(remainingNativeDraft(current, submitted)).toEqual(current);
  });

  it("retains the prompt when a captured context record was revised without changing its reference", () => {
    const submitted = draft({ terminalContexts: [selection], prompt: `Explain ${reference}` });
    const current = {
      ...submitted,
      terminalContexts: [{ ...selection, text: "revised selection" }],
    };
    expect(remainingNativeDraft(current, submitted)).toEqual(current);
  });

  it("retains an accepted context explicitly referenced again in newly appended text", () => {
    const submitted = draft({ terminalContexts: [selection], prompt: `Explain ${reference}` });
    const current = { ...submitted, prompt: `${submitted.prompt}\nNow compare ${reference}` };
    const remaining = remainingNativeDraft(current, submitted);
    expect(remaining.prompt).toBe(`\nNow compare ${reference}`);
    expect(remaining.terminalContexts).toEqual([selection]);
  });
});
