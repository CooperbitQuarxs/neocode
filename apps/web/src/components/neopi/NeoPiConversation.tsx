import { LegendList } from "@legendapp/list/react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { projectTranscript, type TranscriptRow } from "@t3tools/client-runtime/neopi-transcript";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../ui/button";
import { ExpandedImageDialog } from "../chat/ExpandedImageDialog";
import type { ExpandedImagePreview } from "../chat/ExpandedImagePreview";
import {
  NativeTranscriptCtx,
  NativeTranscriptRowView,
  transcriptRowClassName,
  transcriptRowType,
  useTranscriptOpenRows,
  type NativeTranscriptContext,
} from "./NativeTranscript";
import { useNativeDraftIdentity } from "./neopiNativeDraft";
import { useNeoPiConversation } from "./useNeoPiConversation";
import { nativeTreeSessionKey, useNativeTreeField } from "./neopiTreeState";

export function NeoPiConversation({
  threadRef,
  cwd,
  composerInset,
  onOpenTree,
  ownerStatus,
}: {
  threadRef: ScopedThreadRef;
  cwd?: string | undefined;
  composerInset: number;
  onOpenTree: () => void;
  ownerStatus: string | undefined;
}) {
  const { conversation, connection, loading, error, refresh, paging, loadOlder, busy } =
    useNeoPiConversation(threadRef);
  const connected = useRef(false);
  connected.current = connection?.status === "connected";
  useEffect(() => {
    // The provider's running native session is the only source of its live
    // messages; the provider state changing is the cue that it was replaced.
    if (!connected.current) return;
    const timer = setTimeout(() => refresh(), 0);
    return () => clearTimeout(timer);
  }, [ownerStatus, refresh]);
  useNativeDraftIdentity(threadRef, conversation.identity);
  const [pendingResume] = useNativeTreeField(
    nativeTreeSessionKey(threadRef.environmentId, conversation.identity),
    "resumeResult",
  );
  const [debug, setDebug] = useState(false);
  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroups((previous) => {
      const next = new Set(previous);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);
  const rows = useMemo(
    () =>
      projectTranscript(
        {
          entries: conversation.entries,
          pending: conversation.pending,
          leafId: conversation.identity?.leafId ?? null,
        },
        { debug, expandedGroups },
      ),
    [
      conversation.entries,
      conversation.pending,
      conversation.identity?.leafId,
      debug,
      expandedGroups,
    ],
  );
  const openRows = useTranscriptOpenRows();
  const transcriptContext = useMemo<NativeTranscriptContext>(
    () => ({
      environmentId: threadRef.environmentId,
      nativeRef: undefined,
      threadRef,
      cwd,
      debug,
      onToggleGroup: toggleGroup,
      onImageExpand: setExpandedImage,
      openRows,
    }),
    [threadRef, cwd, debug, toggleGroup, openRows],
  );
  const renderRow = useCallback(
    ({ item }: { item: TranscriptRow }) => (
      <div
        className={transcriptRowClassName(item)}
        data-native-entry-id={item.kind === "command" ? undefined : item.entry.id}
      >
        <NativeTranscriptRowView row={item} />
      </div>
    ),
    [],
  );
  const attached = connection?.status === "connected";
  const status = loading
    ? "Connecting"
    : connection?.ownership === "stopped"
      ? "Stopped session · read-only"
      : !attached
        ? connection?.status === "disconnected" || connection?.status === "gap"
          ? "Reconnecting"
          : "Native conversation unavailable"
        : connection?.ownership === "gui"
          ? busy
            ? "Working"
            : "Ready"
          : connection?.ownership === "terminal"
            ? "Following the terminal"
            : "Native owner unknown";
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Native conversation">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-1.5 text-xs">
        <div role="status" className="min-w-0 text-muted-foreground">
          <p>{status}</p>
          {connection?.reason ? <p>{connection.reason}</p> : null}
          {conversation.needsSnapshot ? <p>Rebuilding the native branch.</p> : null}
          {pendingResume?.resumeToken ? (
            <p>A saved ask answer is waiting for review in the session tree.</p>
          ) : null}
        </div>
        <div className="flex gap-1">
          <Button size="xs" variant="ghost" onClick={onOpenTree}>
            Session tree
          </Button>
          <Button
            size="xs"
            variant="ghost"
            aria-pressed={debug}
            onClick={() => setDebug((value) => !value)}
          >
            Debug
          </Button>
          <Button size="xs" variant="ghost" onClick={() => refresh()}>
            Refresh
          </Button>
        </div>
      </header>
      {error ? (
        <p role="alert" className="border-b px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {rows.length ? (
        <NativeTranscriptCtx value={transcriptContext}>
          <LegendList
            data={rows}
            keyExtractor={(row) => row.id}
            getItemType={transcriptRowType}
            renderItem={renderRow}
            estimatedItemSize={64}
            recycleItems
            maintainVisibleContentPosition
            maintainScrollAtEnd={{ animated: false }}
            maintainScrollAtEndThreshold={0.1}
            ListHeaderComponent={
              <div className="mx-auto w-full max-w-(--chat-max-width) px-5 pt-3">
                {conversation.identity &&
                (conversation.cursor ||
                  conversation.cursorLeaf !== conversation.identity.leafId) ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={paging || conversation.needsSnapshot}
                    onClick={() => void loadOlder()}
                  >
                    {paging ? "Loading earlier messages…" : "Load earlier messages"}
                  </Button>
                ) : null}
              </div>
            }
            ListFooterComponent={<div style={{ height: composerInset + 16 }} />}
            className="min-h-0 flex-1 overflow-auto"
            aria-label="Native conversation"
          />
        </NativeTranscriptCtx>
      ) : (
        <div className="px-5 py-8 text-sm text-muted-foreground">
          {loading
            ? "Reading history…"
            : attached
              ? "Nothing here yet. Say something below."
              : "History is not available while the session is disconnected."}
        </div>
      )}
      {expandedImage ? (
        <ExpandedImageDialog preview={expandedImage} onClose={() => setExpandedImage(null)} />
      ) : null}
    </section>
  );
}
