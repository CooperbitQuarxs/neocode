import { BracesIcon, GitForkIcon, UnplugIcon } from "lucide-react";
import type { LegendListRef } from "@legendapp/list/react";
import {
  nativeRecord,
  nativeSessionKey,
  type NativeSessionTarget,
} from "@t3tools/client-runtime/neopi-native-sessions";
import {
  projectTranscript,
  transcriptUserText,
  type CommandRow,
} from "@t3tools/client-runtime/neopi-transcript";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerSurface } from "../chat/ComposerSurface";
import { cn } from "../../lib/utils";
import {
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
import { useCreateNativeSession } from "./NativeSessionSidebar";
import { NativeSessionTree } from "./NativeSessionTree";
import { NativeTimelineView, nativeTimelineKey } from "./NativeTimelineView";
import { nativeQueuedMessages, parseNativeQueuedMessageId } from "./nativeTimeline";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useAtomValue } from "@effect/atom-react";
import { clampFileAttachmentUploadBytes } from "@t3tools/client-runtime/state/attachments";
import {
  composerDraftHasUserContent,
  useComposerDraftStore,
  type ComposerImageAttachment,
  type ComposerFileAttachment,
} from "../../composerDraftStore";
import { useComposerHandleContext } from "../../composerHandleContext";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import {
  EMPTY_SERVER_PROVIDERS,
  primaryServerKeybindingsAtom,
  serverEnvironment,
} from "../../state/server";
import { selectThreadRightPanelState, useRightPanelStore } from "../../rightPanelStore";
import type { TerminalContextDraft } from "../../lib/terminalContext";
import { ChatComposer, type ChatComposerHandle } from "../chat/ChatComposer";
import { ExpandedImageDialog } from "../chat/ExpandedImageDialog";
import type { ExpandedImagePreview } from "../chat/ExpandedImagePreview";
import { createPageScrollController } from "../chat/pageScrollController";
import type { NativeModelChoice } from "../chat/neopiModelSwitcher";
import { NativeSessionModelPicker } from "./NativeSessionModelPicker";
import { NativeSessionWorkspacePanels } from "./NativeSessionWorkspacePanels";
import { consumeNativeDraft, prepareNativePrompt } from "./neopiNativeComposer";
import type { ComposerSubmissionIntent } from "../../composer-logic";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../../terminalUiStateStore";

type Request = ReturnType<typeof useNativeSession>["request"];
const answeredDialogs = new Map<string, Set<string>>();
const consumedEditors = new Map<string, string>();

function HeaderIconButton(props: {
  readonly label: string;
  readonly pressed?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={props.label}
            {...(props.pressed !== undefined ? { "aria-pressed": props.pressed } : {})}
            onClick={props.onClick}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

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
  const draftStore = useComposerDraftStore;
  const panelOpen = useRightPanelStore(
    (value) => selectThreadRightPanelState(value.byThreadKey, target).isOpen,
  );
  // The sidebar's own entry, so the header and the session list always agree on the title.
  const listed = useEnvironmentQuery(
    nativeSessionAtoms.list({ environmentId: target.environmentId, input: {} }),
  ).data?.sessions.find(
    (entry) =>
      entry.ref.sessionFile === target.ref.sessionFile &&
      entry.ref.providerInstanceId === target.ref.providerInstanceId,
  );
  const settings = useEnvironmentSettings(target.environmentId);
  const { resolvedTheme } = useTheme();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(target.environmentId));
  const fileAttachmentBytes =
    serverConfig?.environment.capabilities.fileAttachments?.maxUploadBytes ?? null;
  const terminalOpen = useTerminalUiStateStore(
    (value) => selectThreadTerminalUiState(value.terminalUiStateByThreadKey, target).terminalOpen,
  );
  // ChatComposer keeps this ref in sync with its own draft subscription. Read the
  // stored prompt once here: subscribing would re-render the whole workspace
  // (transcript, panels) on every keystroke.
  const [initialPrompt] = useState(
    () => draftStore.getState().getComposerDraft(target)?.prompt ?? "",
  );
  const promptRef = useRef(initialPrompt);
  const imagesRef = useRef<ComposerImageAttachment[]>([]);
  const filesRef = useRef<ComposerFileAttachment[]>([]);
  const terminalContextsRef = useRef<TerminalContextDraft[]>([]);
  const localComposerRef = useRef<ChatComposerHandle | null>(null);
  const composerRef = useComposerHandleContext() ?? localComposerRef;
  const timelineRef = useRef<LegendListRef | null>(null);
  const [followSignal, setFollowSignal] = useState(0);
  const submit = useCallback<Request>(
    async (command, attachments) => {
      const result = await request(command, attachments);
      if (command.type === "prompt") setFollowSignal((value) => value + 1);
      return result;
    },
    [request],
  );
  const [composerElement, setComposerElement] = useState<HTMLDivElement | null>(null);
  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null);
  const sendingRef = useRef(false);
  const focusComposer = useCallback(() => composerRef.current?.focusAtEnd(), [composerRef]);
  // The workspace remounts after Models Back; the draft stays in its store.
  useEffect(() => focusComposer(), [focusComposer]);
  const pageScroll = useMemo(
    () =>
      createPageScrollController({
        getContainer: () => timelineRef.current?.getScrollableNode() ?? null,
        getScrollPaddingBottomPx: () => 0,
      }),
    [],
  );
  useEffect(() => () => pageScroll.dispose(), [pageScroll]);
  const [debug, setDebug] = useState(false);
  const [tree, setTree] = useState(false);
  const [models, setModels] = useState(false);
  const [sending, setSending] = useState(false);
  const [paging, setPaging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [state, setState] = useState<Record<string, unknown>>({});
  const [commands, setCommands] = useState<readonly Record<string, unknown>[]>([]);
  const [dismissed, setDismissed] = useState(() => answeredDialogs.get(key) ?? new Set<string>());
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
    if (!composerDraftHasUserContent(draftStore.getState().getComposerDraft(target))) {
      draftStore.getState().setPrompt(target, feed.editor.text);
    }
  }, [feed.editor, key, target]);
  const execute = useCallback(
    async (command: Record<string, unknown> & { type: string }) => {
      setLocalError(null);
      const result = await submit(command);
      if (command.type !== "prompt" && command.type !== "extension_ui_response") {
        const observed = await request({ type: "get_state" });
        setState(nativeRecord(observed));
      }
      return result;
    },
    [request, submit],
  );
  // While NeoPi runs, a prompt steers in at the next tool boundary, which is
  // what T3's queue promises; the alternate intent waits for the whole run.
  const send = useCallback(
    async (intent?: ComposerSubmissionIntent) => {
      const snapshot = draftStore.getState().getComposerDraft(target);
      if (
        !composerDraftHasUserContent(snapshot) ||
        !snapshot ||
        sendingRef.current ||
        !feed.connected
      )
        return;
      if (composerRef.current?.hasPendingAttachments()) {
        setLocalError("Wait for the attachment to finish preparing before sending.");
        return;
      }
      sendingRef.current = true;
      setSending(true);
      setLocalError(null);
      try {
        const prompt = await prepareNativePrompt(target, snapshot);
        const busy = nativeSessionAtoms.cached(target)?.busy ?? feed.busy;
        await submit(
          {
            type: "prompt",
            message: prompt.message,
            ...(busy ? { streamingBehavior: intent === "alternate" ? "followUp" : "steer" } : {}),
          },
          prompt.attachments,
        );
        consumeNativeDraft(target, snapshot, prompt.attachments);
      } catch (cause) {
        setLocalError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        sendingRef.current = false;
        setSending(false);
        focusComposer();
      }
    },
    [target, feed.connected, feed.busy, submit, composerRef, focusComposer],
  );
  const commandOutputs = useMemo(() => {
    // Command results are local display history anchored after the entry they followed.
    const outputs = new Map<string | null, CommandRow[]>();
    for (const output of feed.commandOutputs) {
      const anchor = output.afterMessageId
        ? (conversation.persisted.get(output.afterMessageId) ?? `live:${output.afterMessageId}`)
        : output.afterEntryId;
      const row: CommandRow = { kind: "command", id: output.id, text: output.text };
      const group = outputs.get(anchor);
      if (group) group.push(row);
      else outputs.set(anchor, [row]);
    }
    return outputs;
  }, [feed.commandOutputs, conversation.persisted]);
  const rows = useMemo(
    () =>
      projectTranscript(
        {
          entries: conversation.entries,
          pending: conversation.pending,
          leafId: conversation.identity?.leafId ?? null,
        },
        { debug, commandOutputs },
      ),
    [
      conversation.entries,
      conversation.pending,
      conversation.identity?.leafId,
      debug,
      commandOutputs,
    ],
  );
  const queueStamp = conversation.entries.at(-1)?.timestamp ?? "";
  const queuedMessages = useMemo(
    () => nativeQueuedMessages(feed.queue, queueStamp),
    [feed.queue, queueStamp],
  );
  const steerQueued = useCallback(
    (id: string) => {
      const queued = parseNativeQueuedMessageId(id);
      if (!queued) return;
      void request({ type: "promote_queued_message", message: queued.text }).catch((cause) =>
        setLocalError(String(cause)),
      );
    },
    [request],
  );
  const removeQueued = useCallback(
    (id: string) => {
      const queued = parseNativeQueuedMessageId(id);
      const parsed = queuedMessages.find((message) => message.id === id);
      if (!queued || !parsed) return;
      void request({ type: "remove_queued_message", message: queued.text, queue: queued.lane })
        .then(() => {
          // Cancel returns the draft, context included, without destroying a newer one.
          const store = draftStore.getState();
          const current = store.getComposerDraft(target)?.prompt ?? "";
          store.setPrompt(
            target,
            current.trim() ? `${parsed.prompt}\n\n${current}` : parsed.prompt,
          );
          if (parsed.terminalContexts.length > 0)
            store.addTerminalContexts(target, parsed.terminalContexts);
          for (const annotation of parsed.previewAnnotations)
            store.addPreviewAnnotation(target, annotation);
          for (const comment of parsed.reviewComments) store.addReviewComment(target, comment);
          focusComposer();
        })
        .catch((cause) => setLocalError(String(cause)));
    },
    [request, draftStore, target, focusComposer, queuedMessages],
  );
  const loadEarlier = useMemo(
    () =>
      conversation.cursor
        ? { loading: paging, cursor: conversation.cursor, onLoadEarlier: () => void loadOlder() }
        : null,
    // loadOlder reads the latest cursor and paging state on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversation.cursor, paging],
  );
  const promptHistory = useMemo(
    () => transcriptUserText(conversation.entries),
    [conversation.entries],
  );
  const model = nativeRecord(state.model);
  const modelLabel = String(model.name ?? model.id ?? "Choose native model");
  const displayState =
    [
      state.thinkingLevel,
      // Chat mode is NeoPi's no-tools conversation mode; only an active one is news.
      typeof state.chatMode === "string" && state.chatMode !== "off"
        ? `Chat ${state.chatMode}`
        : null,
    ]
      .filter((value) => typeof value === "string")
      .join(" · ") || null;
  const nativeCommands = useMemo(
    () =>
      commands.flatMap((command) =>
        typeof command.name === "string"
          ? [
              {
                name: command.name,
                ...(typeof command.description === "string"
                  ? { description: command.description }
                  : {}),
              },
            ]
          : [],
      ),
    [commands],
  );
  const selectModel = useCallback(
    (choice: NativeModelChoice) => {
      setModels(false);
      void execute(
        choice.kind === "role"
          ? { type: "set_role", role: choice.role }
          : { type: "set_model", provider: choice.provider, modelId: choice.modelId },
      ).catch((cause) => setLocalError(String(cause)));
    },
    [execute],
  );
  const interrupt = useCallback(() => {
    void execute({ type: "abort" }).catch((cause) => setLocalError(String(cause)));
  }, [execute]);
  const dialog = feed.dialogs.find(
    (item) => typeof item.id === "string" && !dismissed.has(item.id),
  );
  const status = feed.connected
    ? feed.busy
      ? { label: "Working", dot: "bg-warning" }
      : session?.attachment === "terminal"
        ? { label: "Following a terminal", dot: "bg-info" }
        : { label: "Ready", dot: "bg-success" }
    : loading
      ? { label: "Connecting", dot: "bg-muted-foreground/50" }
      : { label: "Reconnecting · showing cached conversation", dot: "bg-muted-foreground/50" };
  return (
    <>
      <WorkspacePageHeader electron={isElectron}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            role="status"
            aria-label={status.label}
            title={status.label}
            className={cn("size-2 shrink-0 rounded-full", status.dot)}
          />
          <h2 className="min-w-0 truncate text-sm font-medium">
            {listed?.title ??
              (typeof state.sessionName === "string" && state.sessionName.trim()
                ? state.sessionName
                : listed?.firstMessage ||
                  promptHistory[0]?.text.split("\n")[0]?.trim() ||
                  "New session")}
          </h2>
          {session?.cwd ? (
            <span
              className="hidden min-w-0 truncate text-xs text-muted-foreground lg:inline"
              title={session.cwd}
            >
              {session.cwd.replace(/\/+$/, "").split("/").at(-1) || session.cwd}
            </span>
          ) : null}
        </div>
        {/* Leaves room for the fixed terminal and panel toggles at the titlebar edge. */}
        <div
          className={cn(
            "flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]",
            // The fixed titlebar controls gain a maximize button while the panel is open.
            panelOpen ? "pr-26.5 sm:pr-22.5" : "pr-18.25 sm:pr-14.25",
          )}
        >
          <HeaderIconButton label="Session tree" onClick={() => setTree(true)}>
            <GitForkIcon className="size-4" />
          </HeaderIconButton>
          <HeaderIconButton
            label={debug ? "Hide native records" : "Show native records"}
            pressed={debug}
            onClick={() => setDebug((value) => !value)}
          >
            <BracesIcon className="size-4" />
          </HeaderIconButton>
          <HeaderIconButton
            label="Disconnect session"
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
            <UnplugIcon className="size-4" />
          </HeaderIconButton>
        </div>
      </WorkspacePageHeader>
      <NativeSessionWorkspacePanels
        target={target}
        cwd={session?.cwd ?? null}
        agents={feed.agents}
        keybindings={keybindings}
        composerRef={composerRef}
        composerOverlayElement={composerElement}
        workspaceMutationId={conversation.entries.at(-1)?.id ?? null}
        onAddTerminalContext={(selection) => composerRef.current?.addTerminalContext(selection)}
        onSendAnnotation={() => void send()}
        onOpenTree={() => setTree(true)}
        onOpenModels={() => setModels((value) => !value)}
        onInterrupt={interrupt}
        busy={feed.busy}
      >
        {error || localError ? (
          <p role="alert" className="shrink-0 px-5 py-1 text-xs text-destructive">
            {localError ?? error}
          </p>
        ) : null}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <NativeTimelineView
            rows={rows}
            busy={feed.busy}
            environmentId={target.environmentId}
            timelineKey={nativeTimelineKey(target.environmentId, target.ref.sessionFile)}
            cwd={session?.cwd}
            listRef={timelineRef}
            loadEarlier={loadEarlier}
            followSignal={followSignal}
            onImageExpand={setExpandedImage}
            queuedMessages={queuedMessages}
            onSteerQueuedMessage={steerQueued}
            onRemoveQueuedMessage={removeQueued}
          />
        </div>
        <ComposerSurface.Shell ref={setComposerElement} className="shrink-0">
          {Object.values(feed.notices).some(Boolean) ? (
            <div className="flex flex-col gap-0.5 ps-(--workspace-gutter-start) pe-(--workspace-gutter-end) pt-2 text-xs text-muted-foreground">
              {Object.values(feed.notices)
                .filter(Boolean)
                .map((notice, index) => (
                  <p key={index} className="whitespace-pre-wrap">
                    {notice}
                  </p>
                ))}
            </div>
          ) : null}
          <ComposerSurface.Host>
            <ChatComposer
              routeKind="native"
              routeThreadRef={target}
              composerDraftTarget={target}
              environmentId={target.environmentId}
              attachmentUploadsCapabilityKnown={serverConfig !== null}
              supportsAttachmentUploads={
                serverConfig?.environment.capabilities.attachmentUploads === true
              }
              maxFileAttachmentBytes={
                fileAttachmentBytes === null
                  ? null
                  : clampFileAttachmentUploadBytes(fileAttachmentBytes)
              }
              phase={feed.connected ? (feed.busy ? "running" : "ready") : "disconnected"}
              isConnecting={loading}
              isSendBusy={sending}
              sendDisabledReason={feed.connected ? null : "Reconnect NeoPi before sending."}
              settings={settings}
              resolvedTheme={resolvedTheme}
              keybindings={keybindings}
              terminalOpen={terminalOpen}
              gitCwd={session?.cwd ?? null}
              promptRef={promptRef}
              composerImagesRef={imagesRef}
              composerFilesRef={filesRef}
              composerTerminalContextsRef={terminalContextsRef}
              composerRef={composerRef}
              onPageScrollKeyDown={pageScroll.handleKeyDown}
              onPageScrollKeyUp={pageScroll.handleKeyUp}
              onPageScrollRelease={pageScroll.releaseActiveKey}
              onSend={(event, intent) => {
                event?.preventDefault();
                void send(intent);
              }}
              onInterrupt={interrupt}
              focusComposer={focusComposer}
              scheduleComposerFocus={focusComposer}
              setThreadError={(_, message) => setLocalError(message)}
              onExpandImage={setExpandedImage}
              onFileOpen={(attachment) =>
                useRightPanelStore.getState().openAttachment(target, attachment)
              }
              nativeSession={{
                modelControl: (
                  <NativeSessionModelPicker
                    target={target}
                    providers={serverConfig?.providers ?? EMPTY_SERVER_PROVIDERS}
                    settings={settings}
                    keybindings={keybindings}
                    modelLabel={modelLabel}
                    modelSelector={
                      typeof model.provider === "string" && typeof model.id === "string"
                        ? `${model.provider}/${model.id}`
                        : ""
                    }
                    displayState={displayState}
                    open={models}
                    onOpenChange={setModels}
                    disabled={sending}
                    terminalOpen={terminalOpen}
                    onSelect={selectModel}
                  />
                ),
                commands: nativeCommands,
                promptHistory,
                modelPickerOpen: models,
                onOpenModelPicker: () => setModels(true),
                onOpenSessionTree: () => setTree(true),
                onOpenModeControl: () => {
                  void execute({ type: "prompt", message: "/chat" }).catch((cause) =>
                    setLocalError(String(cause)),
                  );
                },
                onToggleModelPicker: () => setModels((value) => !value),
                onCompactContext: () => {
                  void execute({ type: "prompt", message: "/compact" }).catch((cause) =>
                    setLocalError(String(cause)),
                  );
                },
              }}
            />
          </ComposerSurface.Host>
        </ComposerSurface.Shell>
      </NativeSessionWorkspacePanels>
      {expandedImage ? (
        <ExpandedImageDialog preview={expandedImage} onClose={() => setExpandedImage(null)} />
      ) : null}
      {tree ? (
        <NativeSessionTree
          target={target}
          request={execute}
          onClose={() => setTree(false)}
          onReturnFocus={focusComposer}
        />
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
