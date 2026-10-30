import type {
  AssetResource,
  EnvironmentId,
  NeoPiNativeSessionRef,
  ThreadId,
} from "@t3tools/contracts";
import { useMemo } from "react";

import { useAssetUrlState, useRefreshAssetUrl } from "../../state/assets";
import {
  isAbsolutePath,
  isAudioPreviewFile,
  isVideoPreviewFile,
  resolveWorkspaceFilePath,
} from "./filePath";

export function useWorkspaceFileAssetUrlState(props: {
  readonly cwd: string | null;
  readonly environmentId: EnvironmentId | null;
  readonly relativePath: string | null;
  readonly threadId: ThreadId | null;
  readonly nativeRef?: NeoPiNativeSessionRef | undefined;
  /** A draft's workspace root, used only when there is no thread to resolve one from. */
  readonly draftCwd?: string | null;
}) {
  const absolutePath = useMemo(
    () =>
      props.cwd !== null && props.relativePath !== null
        ? resolveWorkspaceFilePath(props.cwd, props.relativePath)
        : null,
    [props.cwd, props.relativePath],
  );

  // Video and audio stream from an exact-file URL, and so does anything outside
  // the workspace, where no workspace-scoped URL can exist.
  const relativePath = props.relativePath;
  const draftCwd = props.draftCwd ?? null;
  const resource = useMemo<AssetResource | null>(() => {
    if (absolutePath === null || relativePath === null) return null;
    if (props.nativeRef) {
      return {
        _tag:
          isVideoPreviewFile(absolutePath) ||
          isAudioPreviewFile(absolutePath) ||
          isAbsolutePath(relativePath)
            ? "native-media-file"
            : "native-workspace-file",
        ref: props.nativeRef,
        path: relativePath,
      };
    }
    if (props.threadId !== null) {
      return {
        _tag:
          isVideoPreviewFile(absolutePath) ||
          isAudioPreviewFile(absolutePath) ||
          isAbsolutePath(relativePath)
            ? "media-file"
            : "workspace-file",
        threadId: props.threadId,
        path: absolutePath,
      };
    }
    // A project draft has no thread, so it names its workspace root explicitly.
    if (draftCwd === null) return null;
    return { _tag: "draft-workspace-file", cwd: draftCwd, path: relativePath };
  }, [absolutePath, relativePath, props.threadId, props.nativeRef, draftCwd]);
  const state = useAssetUrlState(props.environmentId, resource);
  const refresh = useRefreshAssetUrl(props.environmentId, resource);
  return { ...state, resource, refresh };
}
