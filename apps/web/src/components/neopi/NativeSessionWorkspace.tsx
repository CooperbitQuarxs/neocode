import { LegendList } from "@legendapp/list/react";
import {
  nativeCatalogModels,
  nativeRecord,
  nativeSessionKey,
  nativeTranscriptRows,
  type NativeSessionTarget,
  type NativeTranscriptRow,
} from "@t3tools/client-runtime/neopi-native-sessions";
import { journalEntryLabel } from "@t3tools/client-runtime/neopi-journal";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  nativeDraft,
  nativeSessionAtoms,
  selectNativeSession,
  useNativeSession,
  useNativeSessionSelection,
} from "../../state/neopiNativeSessions";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Checkbox } from "../ui/checkbox";
import { SidebarInset } from "../ui/sidebar";
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { isElectron } from "../../env";
import { NeoPiJournalContent } from "./NeoPiJournalContent";
import { useCreateNativeSession } from "./NativeSessionSidebar";
import { NativeSessionTree } from "./NativeSessionTree";
import { useAtomCommand } from "../../state/use-atom-command";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";

type Request = ReturnType<typeof useNativeSession>["request"];
const answeredDialogs = new Map<string, Set<string>>();
const consumedEditors = new Map<string, string>();

export function NativeSessionWorkspace() {
  const target = useNativeSessionSelection((state) => state.target);
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      {target ? (
        <NativeSessionView key={nativeSessionKey(target)} target={target} />
      ) : (
        <NativeSessionStart />
      )}
    </SidebarInset>
  );
}
function NativeSessionStart() {
  const create = useCreateNativeSession();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <>
      <WorkspacePageHeader electron={isElectron} />
      <div className="m-auto flex max-w-lg flex-col items-center gap-4 p-6">
        <h1 className="text-xl font-semibold">Start a conversation</h1>
        <p className="text-sm text-muted-foreground">
          No project or repository required. NeoPi creates and owns the session.
        </p>
        <Button
          disabled={pending}
          onClick={() => {
            setPending(true);
            void create()
              .catch((cause) => setError(String(cause)))
              .finally(() => setPending(false));
          }}
        >
          New thread
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </>
  );
}

export function NativeSessionView({ target }: { target: NativeSessionTarget }) {
  const { feed, session, conversation, request, loading, error } = useNativeSession(target);
  const close = useAtomCommand(nativeSessionAtoms.close, { reportFailure: false });
  const key = nativeSessionKey(target);
  const draft = useSyncExternalStore(nativeDraft.subscribe, () => nativeDraft.get(target));
  const [debug, setDebug] = useState(false);
  const [tree, setTree] = useState(false);
  const [models, setModels] = useState(false);
  const [sending, setSending] = useState(false);
  const [paging, setPaging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [state, setState] = useState<Record<string, unknown>>({});
  const [commands, setCommands] = useState<readonly Record<string, unknown>[]>([]);
  const [dismissed, setDismissed] = useState(() => answeredDialogs.get(key) ?? new Set<string>());
  const editorRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (session) setState(session.state);
  }, [session]);
  useEffect(() => {
    if (session && session.ref.sessionFile !== target.ref.sessionFile)
      selectNativeSession({ environmentId: target.environmentId, ref: session.ref });
  }, [session, target.environmentId, target.ref.sessionFile]);
  const loadOlder = async () => {
    if (paging || !conversation.cursor) return;
    setPaging(true);
    try {
      await request({
        type: "get_entries_page",
        scope: "branch",
        direction: "backward",
        limit: 128,
        cursor: conversation.cursor,
      });
    } catch (cause) {
      setLocalError(String(cause));
    } finally {
      setPaging(false);
    }
  };
  useEffect(() => {
    if (!feed.connected) return;
    let active = true;
    void request({ type: "get_available_commands" })
      .then((value) => {
        const items = nativeRecord(value).commands;
        if (active && Array.isArray(items)) setCommands(items.map(nativeRecord));
      })
      .catch((cause) => {
        if (active) setLocalError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [feed.connected, request]);
  useEffect(() => {
    if (!feed.editor || consumedEditors.get(key) === feed.editor.id) return;
    consumedEditors.set(key, feed.editor.id);
    // A native menu's editor text must not destroy a prompt the user is still composing.
    if (!nativeDraft.get(target)) nativeDraft.set(target, feed.editor.text);
  }, [feed.editor, key, target]);
  const execute = useCallback(
    async (command: Record<string, unknown> & { type: string }) => {
      setLocalError(null);
      const result = await request(command);
      if (command.type !== "prompt" && command.type !== "extension_ui_response") {
        const observed = await request({ type: "get_state" });
        setState(nativeRecord(observed));
      }
      return result;
    },
    [request],
  );
  const send = async () => {
    const message = nativeDraft.get(target);
    if (!message.trim() || sending || !feed.connected) return;
    setSending(true);
    setLocalError(null);
    try {
      await request({
        type: "prompt",
        message,
        ...(feed.busy ? { streamingBehavior: "followUp" } : {}),
      });
      if (nativeDraft.get(target) === message) nativeDraft.set(target, "");
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
      editorRef.current?.focus();
    }
  };
  const rows = useMemo(
    () => nativeTranscriptRows({ conversation, commandOutputs: feed.commandOutputs }, debug),
    [conversation, feed.commandOutputs, debug],
  );
  const renderEntry = useCallback(
    ({ item }: { item: NativeTranscriptRow }) =>
      item.kind === "command" ? (
        <article
          className="mx-auto w-full max-w-(--chat-max-width) px-5 py-4"
          aria-label="Command output"
        >
          <pre className="whitespace-pre-wrap break-words text-sm">{item.text}</pre>
        </article>
      ) : (
        <article
          className="mx-auto w-full max-w-(--chat-max-width) px-5 py-4"
          data-native-entry-id={item.entry.id}
        >
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            {journalEntryLabel(item.entry)}
          </p>
          <NeoPiJournalContent
            entry={item.entry}
            environmentId={target.environmentId}
            nativeRef={session?.ref ?? target.ref}
            cwd={session?.cwd}
          />
        </article>
      ),
    [target.environmentId, target.ref, session?.ref, session?.cwd],
  );
  const model = nativeRecord(state.model);
  const suggestions =
    draft.startsWith("/") && !draft.includes("\n") && !draft.includes(" ")
      ? commands
          .filter(
            (command) =>
              typeof command.name === "string" &&
              `/${command.name}`.toLowerCase().startsWith(draft.toLowerCase()),
          )
          .slice(0, 12)
      : [];
  const dialog = feed.dialogs.find(
    (item) => typeof item.id === "string" && !dismissed.has(item.id),
  );
  return (
    <>
      <WorkspacePageHeader electron={isElectron}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm">
            {String(state.sessionName ?? "Native conversation")}
          </span>
          <span className="truncate text-xs text-muted-foreground">{session?.cwd}</span>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setTree(true)}>
          Session tree
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setDebug((value) => !value)}
          aria-pressed={debug}
        >
          Debug
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void close({ environmentId: target.environmentId, input: { ref: target.ref } }).then(
              (result) => {
                if (result._tag === "Failure")
                  setLocalError(String(squashAtomCommandFailure(result)));
                else selectNativeSession(null);
              },
            )
          }
        >
          Disconnect session
        </Button>
      </WorkspacePageHeader>
      <div role="status" className="shrink-0 px-5 py-1 text-xs text-muted-foreground">
        {feed.connected
          ? feed.busy
            ? "Working"
            : session?.attachment === "terminal"
              ? "Attached to terminal"
              : "Ready"
          : loading
            ? "Connecting…"
            : "Reconnecting · showing cached conversation"}
      </div>
      {error || localError ? (
        <p role="alert" className="shrink-0 px-5 py-1 text-xs text-destructive">
          {localError ?? error}
        </p>
      ) : null}
      <LegendList
        data={rows}
        keyExtractor={(entry) => entry.id}
        renderItem={renderEntry}
        estimatedItemSize={160}
        recycleItems
        maintainVisibleContentPosition
        maintainScrollAtEnd={{ animated: false }}
        maintainScrollAtEndThreshold={0.1}
        ListHeaderComponent={
          conversation.cursor ? (
            <div className="p-3">
              <Button size="sm" variant="ghost" disabled={paging} onClick={() => void loadOlder()}>
                Load earlier messages
              </Button>
            </div>
          ) : null
        }
        className="min-h-0 flex-1 overflow-auto"
      />
      <div className="shrink-0 border-t p-4">
        {Object.values(feed.notices)
          .filter(Boolean)
          .map((notice, index) => (
            <p key={index} className="mb-1 whitespace-pre-wrap text-xs text-muted-foreground">
              {notice}
            </p>
          ))}
        {suggestions.length ? (
          <div className="mb-2 max-h-48 overflow-y-auto" aria-label="Native slash commands">
            {suggestions.map((command) => (
              <div key={String(command.name)}>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    nativeDraft.set(target, `/${command.name} `);
                    editorRef.current?.focus();
                  }}
                >
                  /{String(command.name)}
                  {typeof command.description === "string" ? ` · ${command.description}` : ""}
                </Button>
              </div>
            ))}
          </div>
        ) : null}
        <Textarea
          ref={editorRef}
          aria-label="Message NeoPi"
          placeholder="Ask anything, or type / for native commands"
          value={draft}
          onChange={(event) => nativeDraft.set(target, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setModels(true)}>
            {String(model.name ?? model.id ?? "Choose native model")}
          </Button>
          {typeof state.thinkingLevel === "string" ? (
            <span className="text-xs text-muted-foreground">{state.thinkingLevel}</span>
          ) : null}
          {typeof state.chatMode === "string" ? (
            <span className="text-xs text-muted-foreground">Chat: {state.chatMode}</span>
          ) : null}
          <div className="ml-auto flex gap-2">
            {feed.busy ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void execute({ type: "abort" }).catch((cause) => setLocalError(String(cause)))
                }
              >
                Stop
              </Button>
            ) : null}
            <Button
              size="sm"
              disabled={!draft.trim() || !feed.connected || sending}
              onClick={() => void send()}
            >
              {sending ? "Sending…" : feed.busy ? "Queue" : "Send"}
            </Button>
          </div>
        </div>
      </div>
      {models ? (
        <NativeSessionModelDialog request={execute} onClose={() => setModels(false)} />
      ) : null}
      {tree ? (
        <NativeSessionTree target={target} request={execute} onClose={() => setTree(false)} />
      ) : null}
      {dialog ? (
        <NativeSessionDialog
          key={String(dialog.id)}
          dialog={dialog}
          request={request}
          onAnswered={() => {
            const next = new Set(dismissed).add(String(dialog.id));
            answeredDialogs.set(key, next);
            setDismissed(next);
          }}
        />
      ) : null}
    </>
  );
}

export function NativeSessionModelDialog({
  request,
  onClose,
}: {
  request: Request;
  onClose: () => void;
}) {
  const [catalog, setCatalog] = useState<ReturnType<typeof nativeCatalogModels>>([]);
  const [roles, setRoles] = useState<readonly Record<string, unknown>[]>([]);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([request({ type: "get_available_models" }), request({ type: "get_roles" })])
      .then(([models, result]) => {
        if (!active) return;
        setCatalog(nativeCatalogModels(models));
        const items = nativeRecord(result).roles;
        if (Array.isArray(items)) setRoles(items.map(nativeRecord));
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [request]);
  const select = async (command: Record<string, unknown> & { type: string }) => {
    setPending(true);
    try {
      await request(command);
      onClose();
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
          <DialogTitle>Session model</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 px-6 pb-4">
          <Input
            aria-label="Search native models and roles"
            placeholder="Search models and roles"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <div className="max-h-80 overflow-auto">
            {roles
              .filter(
                (role) =>
                  role.hidden !== true &&
                  `${role.name} ${role.id}`.toLowerCase().includes(query.toLowerCase()),
              )
              .map((role) => (
                <div key={String(role.id)}>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => void select({ type: "set_role", role: role.id })}
                  >
                    {String(role.alias ?? role.id)}
                  </Button>
                </div>
              ))}
            {catalog
              .filter((model) =>
                `${model.name} ${model.provider}/${model.id}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .map((model) => (
                <div key={`${model.provider}/${model.id}`}>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      void select({
                        type: "set_model",
                        provider: model.provider,
                        modelId: model.id,
                      })
                    }
                  >
                    {model.name} · {model.provider}
                  </Button>
                </div>
              ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function NativeSessionDialog({
  dialog,
  request,
  onAnswered,
}: {
  dialog: Record<string, unknown>;
  request: Request;
  onAnswered: () => void;
}) {
  const [value, setValue] = useState(typeof dialog.prefill === "string" ? dialog.prefill : "");
  const [answers, setAnswers] = useState<
    Record<string, { selectedOptions: string[]; customInput: string }>
  >({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toolApproval = dialog.type === "tool_approval_request";
  const planProposal = dialog.type === "plan_proposal_request";
  const responseType = toolApproval
    ? "tool_approval_response"
    : planProposal
      ? "plan_proposal_response"
      : "extension_ui_response";
  const respond = async (answer: Record<string, unknown>) => {
    if (pending) return;
    setPending(true);
    try {
      await request({ type: responseType, id: dialog.id, ...answer });
      onAnswered();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setPending(false);
    }
  };
  const cancel = () =>
    respond(
      planProposal
        ? { decision: "refine", feedback: value || "Plan review cancelled." }
        : { cancelled: true },
    );
  const questions = Array.isArray(dialog.questions) ? dialog.questions.map(nativeRecord) : [];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void cancel();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>
            {String(dialog.title ?? (toolApproval ? `Allow ${dialog.toolName}?` : "NeoPi asks"))}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-96 space-y-3 overflow-auto px-6 pb-4">
          {dialog.message ? <p className="text-sm">{String(dialog.message)}</p> : null}
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          {toolApproval ? (
            <>
              {typeof dialog.reason === "string" ? (
                <p className="text-sm">{dialog.reason}</p>
              ) : null}
              <pre className="overflow-auto whitespace-pre-wrap text-xs">
                {JSON.stringify(dialog.args, null, 2)}
              </pre>
              {Array.isArray(dialog.details)
                ? dialog.details.map((detail, index) => (
                    <p key={index} className="text-sm">
                      {String(detail)}
                    </p>
                  ))
                : null}
              {Array.isArray(dialog.safetyChecks)
                ? dialog.safetyChecks.map((item, index) => {
                    const check = nativeRecord(item);
                    return (
                      <p key={index} role="alert" className="text-sm text-destructive">
                        {String(check.message ?? check.code ?? check.id)}
                      </p>
                    );
                  })
                : null}
            </>
          ) : null}
          {planProposal ? (
            <>
              <pre className="whitespace-pre-wrap text-sm">{String(dialog.planMarkdown ?? "")}</pre>
              <Textarea
                aria-label="Plan feedback"
                placeholder="Feedback for refinement"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </>
          ) : null}
          {dialog.method === "select" && Array.isArray(dialog.options)
            ? dialog.options.map((option, index) => (
                <div key={index}>
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => void respond({ value: option })}
                  >
                    {String(option)}
                  </Button>
                </div>
              ))
            : null}
          {dialog.method === "input" ? (
            <Input
              autoFocus
              type={dialog.secret === true ? "password" : "text"}
              aria-label={String(dialog.title)}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          ) : null}
          {dialog.method === "editor" ? (
            <Textarea
              autoFocus
              aria-label={String(dialog.title)}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          ) : null}
          {questions.map((question) => {
            const id = String(question.id);
            const answer = answers[id] ?? { selectedOptions: [], customInput: "" };
            return (
              <fieldset key={id} className="space-y-2">
                <legend className="text-sm font-medium">{String(question.question)}</legend>
                {(Array.isArray(question.options) ? question.options : []).map((item, index) => {
                  const option = nativeRecord(item);
                  const label = String(option.label);
                  return (
                    <label key={index} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={answer.selectedOptions.includes(label)}
                        onCheckedChange={() =>
                          setAnswers({
                            ...answers,
                            [id]: {
                              ...answer,
                              selectedOptions: question.multi
                                ? answer.selectedOptions.includes(label)
                                  ? answer.selectedOptions.filter((value) => value !== label)
                                  : [...answer.selectedOptions, label]
                                : [label],
                            },
                          })
                        }
                      />
                      {label}
                      {typeof option.description === "string" ? ` · ${option.description}` : ""}
                    </label>
                  );
                })}
                <Input
                  aria-label={`Other answer: ${String(question.question)}`}
                  value={answer.customInput}
                  onChange={(event) =>
                    setAnswers({ ...answers, [id]: { ...answer, customInput: event.target.value } })
                  }
                />
              </fieldset>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={pending} onClick={() => void cancel()}>
            Cancel
          </Button>
          {toolApproval ? (
            <>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => void respond({ decision: "deny" })}
              >
                Deny
              </Button>
              {!Array.isArray(dialog.safetyChecks) || dialog.safetyChecks.length === 0 ? (
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => void respond({ decision: "allow_session" })}
                >
                  Allow for session
                </Button>
              ) : null}
              <Button disabled={pending} onClick={() => void respond({ decision: "allow_once" })}>
                Allow once
              </Button>
            </>
          ) : null}
          {planProposal ? (
            <>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => void respond({ decision: "refine", feedback: value })}
              >
                Refine
              </Button>
              <Button disabled={pending} onClick={() => void respond({ decision: "approve" })}>
                Approve plan
              </Button>
            </>
          ) : null}
          {dialog.method === "confirm" ? (
            <>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => void respond({ confirmed: false })}
              >
                No
              </Button>
              <Button disabled={pending} onClick={() => void respond({ confirmed: true })}>
                Yes
              </Button>
            </>
          ) : null}
          {dialog.method === "input" || dialog.method === "editor" ? (
            <Button disabled={pending} onClick={() => void respond({ value })}>
              Submit
            </Button>
          ) : null}
          {dialog.method === "ask" ? (
            <Button
              disabled={pending}
              onClick={() =>
                void respond({
                  answers: questions.map((question) => ({
                    id: question.id,
                    ...(answers[String(question.id)] ?? { selectedOptions: [], customInput: "" }),
                  })),
                })
              }
            >
              Submit answers
            </Button>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
