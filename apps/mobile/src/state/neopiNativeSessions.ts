import { useAtomValue } from "@effect/atom-react";
import { createNativeSessionAtoms } from "@t3tools/client-runtime/state/neopi-native-sessions";
import {
  emptyNativeSessionFeed,
  nativeSessionKey,
  type NativeSessionTarget,
} from "@t3tools/client-runtime/neopi-native-sessions";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useSyncExternalStore } from "react";
import { connectionAtomRuntime } from "../connection/runtime";
import { useAtomCommand } from "./use-atom-command";

export const nativeSessionAtoms = createNativeSessionAtoms(connectionAtomRuntime);
const drafts = new Map<string, string>();
const listeners = new Set<() => void>();
export function setNativeDraft(target: NativeSessionTarget, text: string) {
  drafts.set(nativeSessionKey(target), text);
  for (const listener of listeners) listener();
}
export const getNativeDraft = (target: NativeSessionTarget) =>
  drafts.get(nativeSessionKey(target)) ?? "";
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function useNativeSession(target: NativeSessionTarget) {
  const result = useAtomValue(
    nativeSessionAtoms.watch({ environmentId: target.environmentId, input: { ref: target.ref } }),
  );
  const send = useAtomCommand(nativeSessionAtoms.request, { reportFailure: false });
  const request = useCallback(
    async (command: Record<string, unknown> & { type: string }) => {
      const response = await send({
        environmentId: target.environmentId,
        input: { ref: target.ref, command },
      });
      if (response._tag === "Failure") throw squashAtomCommandFailure(response);
      return response.value;
    },
    [send, target.environmentId, target.ref.providerInstanceId, target.ref.sessionFile],
  );
  const feed = AsyncResult.isSuccess(result)
    ? result.value
    : (nativeSessionAtoms.cached(target) ?? emptyNativeSessionFeed());
  const draft = useSyncExternalStore(subscribe, () => getNativeDraft(target));
  return {
    feed,
    request,
    draft,
    setDraft: (text: string) => setNativeDraft(target, text),
    error: AsyncResult.isFailure(result) ? String(Cause.squash(result.cause)) : feed.error,
  };
}
