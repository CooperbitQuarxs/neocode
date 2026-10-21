import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { NeoPiSessionConfigurationResult, ScopedThreadRef } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/unstable/reactivity";
import { InfoIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useServerConfigs, useThreadShell } from "../../state/entities";
import {
  neopiSessionConfiguration,
  neopiSessionConfigurationChanges,
} from "../../state/neopiSessions";
import { formatEnvironmentQueryError } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Switch } from "../ui/switch";

type SnapshotState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; result: NeoPiSessionConfigurationResult };

export function NeoPiSessionConfiguration({ threadRef }: { threadRef: ScopedThreadRef | null }) {
  const thread = useThreadShell(threadRef);
  const configs = useServerConfigs();
  const provider =
    threadRef && thread
      ? configs
          .get(threadRef.environmentId)
          ?.providers.find(
            (entry) =>
              entry.instanceId ===
              (thread.session?.providerInstanceId ?? thread.modelSelection.instanceId),
          )
      : null;
  if (!threadRef || !thread || provider?.driver !== "neopi") return null;

  return (
    <SessionConfigurationControl
      key={JSON.stringify([threadRef.environmentId, threadRef.threadId, provider.instanceId])}
      threadRef={threadRef}
    />
  );
}

function SessionConfigurationControl({ threadRef }: { threadRef: ScopedThreadRef }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <DialogTrigger
              render={
                <Button size="icon-sm" variant="ghost" aria-label="NeoPi session configuration" />
              }
            />
          }
        >
          <InfoIcon className="size-4" />
        </TooltipTrigger>
        <TooltipPopup>NeoPi session configuration</TooltipPopup>
      </Tooltip>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>NeoPi session configuration</DialogTitle>
          <DialogDescription>
            Read-only view of the connected native session. Values are read separately and may
            change during observation. Refresh to read again, or follow model and effort changes
            while this inspector is open.
          </DialogDescription>
        </DialogHeader>
        {open ? <SessionConfigurationSnapshot threadRef={threadRef} /> : null}
      </DialogPopup>
    </Dialog>
  );
}

function SessionConfigurationSnapshot({ threadRef }: { threadRef: ScopedThreadRef }) {
  const [follow, setFollow] = useState(false);

  return (
    <>
      <DialogPanel>
        <div className="space-y-2 text-sm">
          <label className="flex items-center justify-between gap-4">
            Follow model changes
            <Switch checked={follow} onCheckedChange={setFollow} />
          </label>
          <p className="text-muted-foreground">
            Follows native model and effort events. Use Refresh for role-definition changes. Advisor
            configuration is not shown here.
          </p>
        </div>
      </DialogPanel>
      {follow ? (
        <FollowingSessionConfiguration threadRef={threadRef} />
      ) : (
        <ManualSessionConfiguration threadRef={threadRef} />
      )}
    </>
  );
}

function FollowingSessionConfiguration({ threadRef }: { threadRef: ScopedThreadRef }) {
  const atom = neopiSessionConfigurationChanges({
    environmentId: threadRef.environmentId,
    input: { threadId: threadRef.threadId },
  });
  const result = useAtomValue(atom);
  const refresh = useAtomRefresh(atom);
  // A live stream stays waiting between events; its successful snapshot is usable.
  const state: SnapshotState = AsyncResult.isFailure(result)
    ? { status: "error", message: formatEnvironmentQueryError(result.cause) }
    : !AsyncResult.isSuccess(result) || result.value === null
      ? { status: "loading" }
      : { status: "loaded", result: result.value };

  return <SessionConfigurationView state={state} refresh={refresh} />;
}

function ManualSessionConfiguration({ threadRef }: { threadRef: ScopedThreadRef }) {
  const readConfiguration = useAtomCommand(neopiSessionConfiguration, { reportFailure: false });
  const [state, setState] = useState<SnapshotState>({ status: "loading" });
  const requestVersion = useRef(0);
  const { environmentId, threadId } = threadRef;

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const response = await readConfiguration({ environmentId, input: { threadId } });
      if (requestVersion.current !== version) return;
      if (response._tag === "Failure") {
        if (isAtomCommandInterrupted(response)) {
          setState({ status: "error", message: "The read was interrupted. Try Refresh." });
          return;
        }
        throw squashAtomCommandFailure(response);
      }
      setState({ status: "loaded", result: response.value });
    } catch (cause) {
      if (requestVersion.current !== version) return;
      setState({
        status: "error",
        message: cause instanceof Error ? cause.message : "Unable to read this NeoPi session.",
      });
    }
  }, [environmentId, threadId, readConfiguration]);

  useEffect(() => {
    void refresh();
    return () => {
      // Closing or switching the scoped thread invalidates every in-flight read.
      requestVersion.current += 1;
    };
  }, [refresh]);

  return (
    <SessionConfigurationView
      state={state}
      refresh={() => {
        // A requested refresh replaces the old snapshot even if the read fails.
        setState({ status: "loading" });
        void refresh();
      }}
    />
  );
}

function SessionConfigurationView({
  state,
  refresh,
}: {
  state: SnapshotState;
  refresh: () => void;
}) {
  return (
    <>
      <DialogPanel>
        <div aria-busy={state.status === "loading"} className="space-y-4 text-sm">
          {state.status === "loading" ? (
            <p role="status" className="text-muted-foreground">
              Reading connected NeoPi session...
            </p>
          ) : state.status === "error" ? (
            <p role="alert" className="text-destructive">
              {state.message}
            </p>
          ) : state.result.status === "unavailable" ? (
            <p role="alert">{state.result.reason}</p>
          ) : (
            <ConfigurationDetails snapshot={state.result} />
          )}
        </div>
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Close</DialogClose>
        <Button variant="secondary" disabled={state.status === "loading"} onClick={refresh}>
          Refresh
        </Button>
      </DialogFooter>
    </>
  );
}

function ConfigurationDetails({
  snapshot,
}: {
  snapshot: Extract<NeoPiSessionConfigurationResult, { status: "available" }>;
}) {
  return (
    <>
      <p className="text-muted-foreground">
        Observed{" "}
        <time dateTime={snapshot.observedAt}>{new Date(snapshot.observedAt).toLocaleString()}</time>
      </p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
        <dt className="text-muted-foreground">Native session</dt>
        <dd className="break-all font-mono">{snapshot.sessionId}</dd>
        <dt className="text-muted-foreground">Provider instance</dt>
        <dd className="break-all font-mono">{snapshot.providerInstanceId}</dd>
        <dt className="text-muted-foreground">Ownership</dt>
        <dd>
          {snapshot.attachment === "terminal"
            ? "Terminal-owned, NeoCode attached"
            : "NeoCode-owned"}
        </dd>
        <dt className="text-muted-foreground">Model</dt>
        <dd className="break-words">
          {snapshot.model ? (
            <>
              {snapshot.model.name ? <div>{snapshot.model.name}</div> : null}
              <div className="font-mono">
                {snapshot.model.provider}/{snapshot.model.id}
              </div>
            </>
          ) : (
            "Not reported"
          )}
        </dd>
        <dt className="text-muted-foreground">Effort</dt>
        <dd>{snapshot.thinkingLevel ?? "Not reported"}</dd>
        <dt className="text-muted-foreground">Active role</dt>
        <dd className="break-words">{snapshot.activeRole ?? "No active role reported"}</dd>
      </dl>
      <section className="space-y-3" aria-label="Model roles">
        <h3 className="font-medium">Model roles</h3>
        {snapshot.roles.status === "unsupported" ? (
          <p className="text-muted-foreground">Role details unavailable: {snapshot.roles.reason}</p>
        ) : snapshot.roles.items.length === 0 ? (
          <p className="text-muted-foreground">No model roles reported.</p>
        ) : (
          <ul className="space-y-4">
            {snapshot.roles.items.map((role) => (
              <li key={role.id} className="space-y-2 border-t pt-3">
                <h4 className="break-words font-medium">
                  {role.name} <span className="font-mono">{role.alias}</span>
                  {role.hidden ? " · Hidden from picker" : null}
                </h4>
                <dl className="space-y-1">
                  <dt className="text-muted-foreground">Role ID</dt>
                  <dd className="break-all font-mono">{role.id}</dd>
                  <dt className="text-muted-foreground">Configured selector</dt>
                  <dd className="break-words font-mono">{role.configured ?? "Not configured"}</dd>
                  <dt className="text-muted-foreground">Fallback patterns, in order</dt>
                  <dd>
                    {role.patterns.length === 0 ? (
                      "No fallback patterns reported"
                    ) : (
                      <ol className="list-inside list-decimal space-y-1">
                        {role.patterns.map((pattern, index) => (
                          // oxlint-disable-next-line react/no-array-index-key -- Native fallback patterns can repeat; their ordered positions distinguish them.
                          <li key={`${index}:${pattern}`} className="break-words font-mono">
                            {pattern}
                          </li>
                        ))}
                      </ol>
                    )}
                  </dd>
                  <dt className="text-muted-foreground">Native resolution</dt>
                  <dd className="break-words">
                    {role.resolved ? (
                      <>
                        <div className="font-mono">
                          {role.resolved.provider}/{role.resolved.modelId}
                        </div>
                        <div>Effort: {role.resolved.thinkingLevel ?? "Not reported"}</div>
                      </>
                    ) : (
                      "Unresolved"
                    )}
                  </dd>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
