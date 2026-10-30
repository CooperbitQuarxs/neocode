import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { useThread, useThreadStatus } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import { useFailedSendDraftStore } from "./chat/failedSendDraftRecovery";
import { stackedThreadToast, toastManager } from "./ui/toast";

/** Like the queued sender, recovery keeps only its outstanding thread streams mounted. */
export function FailedSendDraftRecovery() {
  const keys = useFailedSendDraftStore(
    useShallow((state) => Object.keys(state.submissionsByThreadKey)),
  );
  return keys.map((threadKey) => <ThreadRecovery key={threadKey} threadKey={threadKey} />);
}

function ThreadRecovery({ threadKey }: { threadKey: string }) {
  const target = useMemo(() => parseScopedThreadKey(threadKey), [threadKey]);
  const thread = useThread(target);
  const status = useThreadStatus(target);
  const activities = thread?.activities;
  const failedIds = useFailedSendDraftStore(
    useShallow((state) =>
      Object.entries(state.submissionsByThreadKey[threadKey] ?? {})
        .filter(([, entry]) => entry.status === "failed")
        .map(([id]) => id),
    ),
  );

  useEffect(() => {
    if (!target) return;
    if (status === "deleted") {
      useFailedSendDraftStore.getState().discardThread(target);
    } else if (activities) {
      useFailedSendDraftStore.getState().reconcile(target, activities);
    }
    // Streaming message deltas do not change activities and do no recovery work.
  }, [activities, status, target]);

  if (!target || status === "deleted") return null;
  return failedIds.map((messageId) => (
    <RecoveryNotice key={messageId} target={target} messageId={messageId} />
  ));
}

function RecoveryNotice({ target, messageId }: { target: ScopedThreadRef; messageId: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    const store = useFailedSendDraftStore.getState();
    if (store.restore(target, messageId)) return;
    if (store.submissionsByThreadKey[scopedThreadKey(target)]?.[messageId]?.status !== "failed")
      return;
    let unmounting = false;
    const toastId = toastManager.add({
      ...stackedThreadToast({
        type: "error",
        title: "A prompt could not be sent",
        description:
          "Your newer draft is unchanged. Restore the failed prompt when its composer is empty.",
        timeout: 0,
        actionProps: {
          children: "Restore prompt",
          onClick: () => {
            if (!useFailedSendDraftStore.getState().restore(target, messageId)) {
              toastManager.update(toastId, {
                description:
                  "Send or clear the original composer's current draft before restoring.",
              });
              return;
            }
            void navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams(target),
            });
            toastManager.close(toastId);
          },
        },
      }),
      // Base UI invokes this for every dismissal, including swipe and Escape.
      // A coordinator remount only hides its notice; it retains the recovery.
      onClose: () => {
        if (!unmounting) useFailedSendDraftStore.getState().discard(target, messageId);
      },
    });
    return () => {
      unmounting = true;
      toastManager.close(toastId);
    };
  }, [messageId, navigate, target]);
  return null;
}
