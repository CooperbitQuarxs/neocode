import { workspaceResourceId, type WorkspaceRef } from "@t3tools/client-runtime/environment";
import { randomUUID } from "../lib/utils";

const rendererId = randomUUID();

/**
 * The server only guarantees preview tab ids are unique within one process.
 * Each renderer owns its webviews, even when windows share the same environment
 * and thread. A reload gets a new identity rather than adopting dead guests.
 */
export function previewRuntimeTabId(
  threadRef: WorkspaceRef,
  serverEpoch: string | null,
  tabId: string,
): string {
  return JSON.stringify([
    rendererId,
    threadRef.environmentId,
    workspaceResourceId(threadRef),
    serverEpoch,
    tabId,
  ]);
}

export function isCurrentPreviewRuntimeTab(
  threadRef: WorkspaceRef,
  serverEpoch: string | null,
  tabId: string,
  runtimeTabId: string,
): boolean {
  return previewRuntimeTabId(threadRef, serverEpoch, tabId) === runtimeTabId;
}
