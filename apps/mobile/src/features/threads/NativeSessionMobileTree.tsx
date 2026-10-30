import type { NeoPiJournalEntry } from "@t3tools/contracts";
import {
  nativeRecord,
  type NativeSessionTarget,
} from "@t3tools/client-runtime/neopi-native-sessions";
import { journalEntryLabel, journalTreeRows } from "@t3tools/client-runtime/neopi-journal";
import { nativeNavigationGuards } from "@t3tools/client-runtime/neopi-conversation";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { MaterialButton } from "../../components/MaterialButton";
import { useNativeSession } from "../../state/neopiNativeSessions";
import { NativeError, NativeModal } from "./NativeNeoPiControls";
import { NeoPiJournalContent } from "./NeoPiJournalContent";

type Request = (command: Record<string, unknown> & { type: string }) => Promise<unknown>;
export function NativeSessionMobileTree({
  target,
  request,
  onClose,
}: {
  target: NativeSessionTarget;
  request: Request;
  onClose: () => void;
}) {
  const { feed } = useNativeSession(target);
  const [entries, setEntries] = useState<readonly NeoPiJournalEntry[]>([]);
  const [selected, setSelected] = useState<NeoPiJournalEntry | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void request({ type: "get_tree" })
      .then((value) => {
        if (!active) return;
        const roots = nativeRecord(value).tree;
        const entries: NeoPiJournalEntry[] = [];
        const remaining = Array.isArray(roots) ? [...roots].reverse() : [];
        while (remaining.length) {
          const node = nativeRecord(remaining.pop());
          const entry = nativeRecord(node.entry);
          if (
            typeof entry.id === "string" &&
            typeof entry.type === "string" &&
            typeof entry.timestamp === "string" &&
            (entry.parentId === null || typeof entry.parentId === "string")
          )
            entries.push(entry as NeoPiJournalEntry);
          if (Array.isArray(node.children)) remaining.push(...[...node.children].reverse());
        }
        setEntries(entries);
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [request]);
  const navigate = async () => {
    if (!selected || !feed.conversation.identity || pending) return;
    setPending(true);
    try {
      const result = nativeRecord(
        await request({
          type: "navigate_tree",
          targetId: selected.id,
          ...nativeNavigationGuards(feed.conversation.identity),
        }),
      );
      if (result.cancelled !== true) onClose();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setPending(false);
    }
  };
  return (
    <NativeModal title="Session tree" onClose={onClose}>
      <ScrollView contentContainerClassName="gap-2 px-4 pb-6">
        <NativeError message={error} />
        {journalTreeRows(entries).map(({ entry, depth }) => (
          <View key={entry.id} style={{ paddingLeft: Math.min(depth, 12) * 12 }}>
            <MaterialButton
              label={`${entry.id === feed.conversation.identity?.leafId ? "● " : ""}${journalEntryLabel(entry)}`}
              tone="text"
              onPress={() => setSelected(entry)}
            />
          </View>
        ))}
        {selected ? (
          <NeoPiJournalContent
            entry={selected}
            environmentId={target.environmentId}
            nativeRef={feed.session?.ref ?? target.ref}
            cwd={feed.session?.cwd ?? null}
          />
        ) : null}
        <MaterialButton
          label="Continue from here"
          disabled={!selected || !feed.conversation.identity || pending}
          onPress={() => void navigate()}
        />
      </ScrollView>
    </NativeModal>
  );
}
