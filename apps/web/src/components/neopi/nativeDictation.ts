import type { EnvironmentId } from "@t3tools/contracts";

import { folderDropTarget } from "../chat/folderDrop";

/**
 * NeoPi records the microphone of the machine that runs it. That is the user's own
 * only when this is the desktop app talking to its own backend, and only an owned
 * session accepts the dictation commands (an attached terminal does not).
 */
export function nativeDictationAvailable(input: {
  readonly isDesktop: boolean;
  readonly localEnvironmentDisabled: boolean;
  readonly environmentId: EnvironmentId;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly attachment: "owned" | "terminal" | undefined;
}): boolean {
  return input.isDesktop && input.attachment === "owned" && folderDropTarget(input) === "local";
}
