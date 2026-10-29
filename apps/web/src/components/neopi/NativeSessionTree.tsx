import type { NeoPiJournalEntry } from "@t3tools/contracts";
import {
  nativeRecord,
  type NativeSessionTarget,
} from "@t3tools/client-runtime/neopi-native-sessions";
import { journalEntryLabel, journalTreeRows } from "@t3tools/client-runtime/neopi-journal";
import { nativeNavigationGuards } from "@t3tools/client-runtime/neopi-conversation";
import { useEffect, useState } from "react";
import { useNativeSession } from "../../state/neopiNativeSessions";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { NeoPiJournalContent } from "./NeoPiJournalContent";

type Request = (command: Record<string, unknown> & { type: string }) => Promise<unknown>;
export function NativeSessionTree({
  target,
  request,
  onClose,
}: {
  target: NativeSessionTarget;
  request: Request;
  onClose: () => void;
}) {
  const { conversation, session } = useNativeSession(target);
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
        const flattened: NeoPiJournalEntry[] = [];
        const remaining = Array.isArray(roots) ? [...roots].reverse() : [];
        while (remaining.length) {
          const node = nativeRecord(remaining.pop());
          const entry = nativeRecord(node.entry);
          if (
            typeof entry.id === "string" &&
            typeof entry.type === "string" &&
            typeof entry.timestamp === "string" &&
            (typeof entry.parentId === "string" || entry.parentId === null)
          )
            flattened.push(entry as NeoPiJournalEntry);
          if (Array.isArray(node.children)) remaining.push(...[...node.children].reverse());
        }
        setEntries(flattened);
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [request]);
  const navigate = async () => {
    if (!selected || !conversation.identity || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = nativeRecord(
        await request({
          type: "navigate_tree",
          targetId: selected.id,
          ...nativeNavigationGuards(conversation.identity),
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Session tree</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-auto px-6 pb-4">
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          {journalTreeRows(entries).map(({ entry, depth }) => (
            <div key={entry.id} style={{ paddingLeft: Math.min(depth, 12) * 12 }}>
              <Button
                size="sm"
                variant={selected?.id === entry.id ? "secondary" : "ghost"}
                onClick={() => setSelected(entry)}
              >
                {entry.id === conversation.identity?.leafId ? "● " : ""}
                {journalEntryLabel(entry)} · {entry.timestamp}
              </Button>
            </div>
          ))}
          {selected ? (
            <NeoPiJournalContent
              entry={selected}
              environmentId={target.environmentId}
              nativeRef={session?.ref ?? target.ref}
              cwd={session?.cwd}
            />
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            disabled={!selected || !conversation.identity || pending}
            onClick={() => void navigate()}
          >
            Navigate here
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
