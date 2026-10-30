import type { WorkspaceRef } from "@t3tools/client-runtime/environment";

import ChatMarkdown from "~/components/ChatMarkdown";
import { resolvePathLinkTarget } from "~/terminal-links";

export function FileMarkdownPreview(props: {
  readonly cwd: string;
  readonly relativePath: string;
  readonly text: string;
  readonly threadRef: WorkspaceRef;
  readonly onTaskListChange?:
    | ((input: { readonly markerOffset: number; readonly checked: boolean }) => void)
    | undefined;
}) {
  const lastSeparator = Math.max(
    props.relativePath.lastIndexOf("/"),
    props.relativePath.lastIndexOf("\\"),
  );
  const imageBaseDir =
    lastSeparator >= 0
      ? resolvePathLinkTarget(props.relativePath.slice(0, lastSeparator), props.cwd)
      : props.cwd;

  return (
    <ChatMarkdown
      text={props.text}
      cwd={props.cwd}
      imageBaseDir={imageBaseDir}
      environmentId={props.threadRef.environmentId}
      {...("threadId" in props.threadRef
        ? { threadRef: props.threadRef }
        : { nativeRef: props.threadRef.ref })}
      className="mx-auto max-w-4xl px-6 py-5"
      onTaskListChange={props.onTaskListChange}
    />
  );
}
