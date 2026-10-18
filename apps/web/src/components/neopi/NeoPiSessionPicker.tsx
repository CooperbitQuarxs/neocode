import type { NeoPiSessionScope, NeoPiSessionSummary, ScopedProjectRef } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { neopiSessionList, neopiSessionResume } from "../../state/neopiSessions";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";
import { filterNeoPiSessions, neopiSessionRowState } from "./neopiSessionPicker.logic";

export function NeoPiSessionPicker({
  target,
  onClose,
}: {
  target: ScopedProjectRef;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<NeoPiSessionScope>("project");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const result = useEnvironmentQuery(
    neopiSessionList({
      environmentId: target.environmentId,
      input: { projectId: target.projectId, scope },
    }),
  );
  const { refresh } = result;
  // The list is keyed by scope; refresh so reopening never shows a stale owner state.
  useEffect(() => {
    refresh();
  }, [refresh]);
  const resume = useAtomCommand(neopiSessionResume, { reportFailure: false });
  const navigate = useNavigate();
  const sessions =
    result.data?.status === "available" ? filterNeoPiSessions(result.data.sessions, query) : [];

  async function select(session: NeoPiSessionSummary) {
    const state = neopiSessionRowState(session);
    if (pending || state.disabledReason) return;
    setPending(true);
    setError(null);
    try {
      let threadId = state.threadId;
      if (!threadId) {
        if (!session.projectId) return;
        const resumed = await resume({
          environmentId: target.environmentId,
          input: { projectId: session.projectId, sessionFile: session.sessionFile },
        });
        if (resumed._tag === "Failure") {
          if (!isAtomCommandInterrupted(resumed)) throw squashAtomCommandFailure(resumed);
          return;
        }
        threadId = resumed.value.threadId;
      }
      await navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(target.environmentId, threadId)),
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to resume this NeoPi session.");
    } finally {
      setPending(false);
    }
  }

  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <CommandDialogPopup aria-label="Resume NeoPi session">
        <div className="flex items-center justify-between gap-3 px-4 pt-4">
          <h2 className="font-medium">Resume NeoPi session</h2>
          <Button
            size="xs"
            variant="ghost"
            onClick={refresh}
            disabled={pending || result.isPending}
          >
            Refresh
          </Button>
        </div>
        <div className="flex gap-2 px-4 py-2" role="group" aria-label="Session scope">
          <Button
            size="xs"
            variant={scope === "project" ? "secondary" : "ghost"}
            aria-pressed={scope === "project"}
            disabled={pending}
            onClick={() => setScope("project")}
          >
            This project
          </Button>
          <Button
            size="xs"
            variant={scope === "all" ? "secondary" : "ghost"}
            aria-pressed={scope === "all"}
            disabled={pending}
            onClick={() => setScope("all")}
          >
            All projects
          </Button>
        </div>
        <Command mode="none" value={query} onValueChange={setQuery}>
          <CommandInput
            placeholder="Search titles or first messages…"
            aria-label="Search NeoPi sessions"
          />
          <div className="max-h-72 overflow-y-auto" aria-busy={pending || result.isPending}>
            {error || result.error ? (
              <p role="alert" className="px-4 py-2 text-sm text-destructive">
                {error ?? result.error}
              </p>
            ) : null}
            {result.data?.status === "unavailable" ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">{result.data.reason}</p>
            ) : result.data === null ? (
              <p role="status" className="px-4 py-6 text-sm text-muted-foreground">
                {result.error ? "Could not load sessions. Try Refresh." : "Loading sessions…"}
              </p>
            ) : sessions.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                {query.trim() ? "No matching sessions." : "No NeoPi sessions found."}
              </p>
            ) : (
              <CommandList>
                {sessions.map((session) => {
                  const state = neopiSessionRowState(session);
                  return (
                    <CommandItem
                      key={session.sessionFile}
                      value={session.sessionFile}
                      disabled={pending || state.disabledReason !== null}
                      onClick={() => {
                        void select(session);
                      }}
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 flex-1 truncate">{state.title}</span>
                          <Badge variant="outline">{state.ownerLabel}</Badge>
                        </div>
                        <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                          <time dateTime={session.modifiedAt}>
                            {formatRelativeTimeLabel(session.modifiedAt)}
                          </time>
                          <span>
                            {session.messageCount}{" "}
                            {session.messageCount === 1 ? "message" : "messages"}
                          </span>
                        </div>
                        {scope === "all" ? (
                          <span className="truncate text-xs text-muted-foreground">
                            {session.cwd || "Unknown folder"}
                          </span>
                        ) : null}
                        {state.disabledReason ? (
                          <span className="text-xs text-muted-foreground">
                            {state.disabledReason}
                          </span>
                        ) : null}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandList>
            )}
          </div>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
