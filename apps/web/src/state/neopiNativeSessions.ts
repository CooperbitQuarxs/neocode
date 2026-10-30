import { useAtomValue } from "@effect/atom-react";
import { createNativeSessionAtoms } from "@t3tools/client-runtime/state/neopi-native-sessions";
import {
  emptyNativeSessionFeed,
  type NativeSessionTarget,
} from "@t3tools/client-runtime/neopi-native-sessions";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { NeoPiNativeSessionsRequestInput } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { connectionAtomRuntime } from "../connection/runtime";
import { useAtomCommand } from "./use-atom-command";

export const nativeSessionAtoms = createNativeSessionAtoms(connectionAtomRuntime);
export const useNativeSessionSelection = create(
  persist<{ target: NativeSessionTarget | null }>(() => ({ target: null }), {
    name: "neocode-native-selected-session",
  }),
);
export const selectNativeSession = (target: NativeSessionTarget | null) =>
  useNativeSessionSelection.setState({ target });

export function useNativeSession(target: NativeSessionTarget) {
  const result = useAtomValue(
    nativeSessionAtoms.watch({ environmentId: target.environmentId, input: { ref: target.ref } }),
  );
  const send = useAtomCommand(nativeSessionAtoms.request, { reportFailure: false });
  const request = useCallback(
    async (
      command: Record<string, unknown> & { type: string },
      attachments?: NeoPiNativeSessionsRequestInput["attachments"],
    ) => {
      const response = await send({
        environmentId: target.environmentId,
        input: { ref: target.ref, command, ...(attachments?.length ? { attachments } : {}) },
      });
      if (response._tag === "Failure") throw squashAtomCommandFailure(response);
      return response.value;
    },
    [send, target.environmentId, target.ref.providerInstanceId, target.ref.sessionFile],
  );
  const feed = AsyncResult.isSuccess(result)
    ? result.value
    : (nativeSessionAtoms.cached(target) ?? emptyNativeSessionFeed());
  return {
    feed,
    session: feed.session,
    conversation: feed.conversation,
    request,
    loading: AsyncResult.isInitial(result),
    error: AsyncResult.isFailure(result) ? String(Cause.squash(result.cause)) : feed.error,
  };
}
