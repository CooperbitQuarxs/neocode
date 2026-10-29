import { useAtomValue } from "@effect/atom-react";
import { workspaceKey, workspaceResourceId } from "@t3tools/client-runtime/environment";
import type { NativeSessionTarget } from "@t3tools/client-runtime/neopi-native-sessions";
import {
  deriveAgentPanelModel,
  type RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { PreviewAnnotationPayload, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { nextTerminalId, resolveTerminalSessionLabel } from "@t3tools/shared/terminalLabels";
import * as Arr from "effect/Array";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { ComposerImageAttachment } from "~/composerDraftStore";
import { isCommandPaletteOpen } from "~/commandPaletteBus";
import { requestConfirmDialog } from "~/confirmDialog";
import { isElectron } from "~/env";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { resolveShortcutCommand } from "~/keybindings";
import { getTerminalFocusOwner } from "~/lib/terminalFocus";
import { isPreviewFocused } from "~/lib/previewFocus";
import { confirmTerminalClose, isTerminalCloseConfirmPending } from "~/lib/terminalCloseConfirm";
import {
  preventRepeatedTerminalCloseShortcut,
  preventTerminalCloseShortcut,
} from "~/lib/terminalCloseShortcut";
import type { TerminalContextSelection } from "~/lib/terminalContext";
import { previewRuntimeTabId } from "~/browser/previewRuntimeTabId";
import {
  isPreviewSupportedInRuntime,
  setActivePreviewTab,
  useThreadPreviewState,
} from "~/previewStateStore";
import { selectThreadPreviewMiniPlayer, usePreviewMiniPlayerStore } from "~/previewMiniPlayerStore";
import {
  selectThreadRightPanelState,
  useRightPanelStore,
  type RightPanelSurface,
} from "~/rightPanelStore";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "~/rightPanelLayout";
import { useEnvironmentQuery } from "~/state/query";
import { previewEnvironment } from "~/state/preview";
import { serverEnvironment } from "~/state/server";
import { terminalEnvironment } from "~/state/terminal";
import { useKnownTerminalSessions } from "~/state/terminalSessions";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment } from "~/state/vcs";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "~/terminalUiStateStore";
import { AgentsPanel } from "../AgentsPanel";
import type { ChatComposerHandle } from "../chat/ChatComposer";
import { makeWorkspaceFileDropHandlers } from "../chat/workspaceFileDrop";
import { RightPanelTabs } from "../RightPanelTabs";
import { RightPanelSheet } from "../RightPanelSheet";
import { Button } from "../ui/button";
import { addBrowserSurface } from "../preview/addBrowserSurface";
import { closePreviewSession } from "../preview/closePreviewSession";
import { subscribePreviewAction } from "../preview/previewActionBus";
import { ThreadPreviewMiniPlayer } from "../preview/ThreadPreviewMiniPlayer";
import { usePreviewSession } from "../preview/usePreviewSession";
import { NativeSessionTerminal, type NativeSessionTerminalHandle } from "./NativeSessionTerminal";

const PreviewPanel = lazy(() =>
  import("../preview/PreviewPanel").then((module) => ({ default: module.PreviewPanel })),
);
const FilePreviewPanel = lazy(() => import("../files/FilePreviewPanel"));
const DiffPanel = lazy(() => import("../DiffPanel"));
const DevicePanel = lazy(() =>
  import("../device/DevicePanel").then((module) => ({ default: module.DevicePanel })),
);

/** Only workspace presentation lives here. Conversation, execution and native connection ownership stay in the feed. */
export function NativeSessionWorkspacePanels({
  target,
  cwd,
  agents,
  keybindings,
  composerRef,
  composerOverlayElement,
  workspaceMutationId,
  onAddTerminalContext,
  onSendAnnotation,
  onOpenTree,
  onOpenModels,
  onInterrupt,
  busy,
  children,
}: {
  target: NativeSessionTarget;
  cwd: string | null;
  agents: readonly RuntimeSubagent[];
  keybindings: ResolvedKeybindingsConfig;
  composerRef: RefObject<ChatComposerHandle | null>;
  composerOverlayElement: HTMLElement | null;
  workspaceMutationId: string | null;
  onAddTerminalContext: (selection: TerminalContextSelection) => void;
  onSendAnnotation: (
    annotation: PreviewAnnotationPayload,
    image: ComposerImageAttachment | null,
  ) => void;
  onOpenTree: () => void;
  onOpenModels: () => void;
  onInterrupt: () => void;
  busy: boolean;
  children: ReactNode;
}) {
  const key = workspaceKey(target);
  const resourceId = workspaceResourceId(target);
  // Remains subscribed even when the browser has moved to its floating surface.
  usePreviewSession(target);
  const preview = useThreadPreviewState(target);
  const panel = useRightPanelStore((state) =>
    selectThreadRightPanelState(state.byThreadKey, target),
  );
  const miniPlayer = usePreviewMiniPlayerStore((state) =>
    selectThreadPreviewMiniPlayer(state.byThreadKey, target),
  );
  const terminalUi = useTerminalUiStateStore((state) =>
    selectThreadTerminalUiState(state.terminalUiStateByThreadKey, target),
  );
  const sessions = useKnownTerminalSessions({
    environmentId: target.environmentId,
    threadId: resourceId,
  });
  const labels = useMemo(
    () =>
      new Map(
        sessions.map((session) => [
          session.target.terminalId,
          resolveTerminalSessionLabel(session.target.terminalId, session.state.summary),
        ]),
      ),
    [sessions],
  );
  const agentModel = useMemo(() => deriveAgentPanelModel({ agents }), [agents]);
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(target.environmentId));
  const gitStatus = useEnvironmentQuery(
    cwd ? vcsEnvironment.status({ environmentId: target.environmentId, input: { cwd } }) : null,
  );
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const closePreview = useAtomCommand(previewEnvironment.close, { reportFailure: false });
  const openTerminal = useAtomCommand(terminalEnvironment.open, { reportFailure: false });
  const closeTerminal = useAtomCommand(terminalEnvironment.close, { reportFailure: false });
  const [error, setError] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<ReadonlySet<string>>(new Set());
  const [maximized, setMaximized] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const drawerRef = useRef<NativeSessionTerminalHandle | null>(null);
  const panelRef = useRef<NativeSessionTerminalHandle | null>(null);
  const sheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const activeSurface =
    panel.surfaces.find((surface) => surface.id === panel.activeSurfaceId) ??
    panel.surfaces[0] ??
    null;

  const pendingSurfaceIds = useMemo(
    () =>
      new Set(
        panel.surfaces
          .filter((surface) => surface.kind === "file" && pendingFiles.has(surface.relativePath))
          .map((surface) => surface.id),
      ),
    [panel.surfaces, pendingFiles],
  );

  const report = useCallback(
    (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    [],
  );
  const createBrowser = useCallback(
    (profileId?: string) => {
      void addBrowserSurface({
        threadRef: target,
        openPreview,
        ...(profileId ? { profileId } : {}),
      }).then((result) => {
        if (result._tag === "Failure") report(squashAtomCommandFailure(result));
      }, report);
    },
    [target, openPreview, report],
  );
  const createTerminal = useCallback(() => {
    if (!cwd) return;
    const terminalId = nextTerminalId([
      ...terminalUi.terminalIds,
      ...sessions.map((session) => session.target.terminalId),
      ...panel.surfaces.flatMap((surface) =>
        surface.kind === "terminal" ? surface.terminalIds : [],
      ),
    ]);
    useRightPanelStore.getState().openTerminal(target, terminalId);
    void openTerminal({
      environmentId: target.environmentId,
      input: {
        threadId: resourceId,
        terminalId,
        cwd,
        providerInstanceId: target.ref.providerInstanceId,
      },
    }).then((result) => {
      if (result._tag === "Failure") report(squashAtomCommandFailure(result));
    }, report);
  }, [
    cwd,
    target,
    terminalUi.terminalIds,
    sessions,
    panel.surfaces,
    openTerminal,
    resourceId,
    report,
  ]);

  const closeSurfaces = useCallback(
    async (surfaces: readonly RightPanelSurface[]) => {
      if (
        surfaces.some((surface) => pendingSurfaceIds.has(surface.id)) &&
        !(await requestConfirmDialog("Discard unsaved file changes?", { variant: "destructive" }))
      )
        return;
      const terminalIds = surfaces.flatMap((surface) =>
        surface.kind === "terminal" ? surface.terminalIds : [],
      );
      if (
        Arr.isArrayNonEmpty(terminalIds) &&
        !(await confirmTerminalClose(Arr.map(terminalIds, (id) => labels.get(id) ?? id)))
      )
        return;
      for (const surface of surfaces) {
        if (surface.kind === "preview" && surface.resourceId) {
          const result = await closePreviewSession({
            closePreview,
            threadRef: target,
            tabId: surface.resourceId,
            snapshot: preview.sessions[surface.resourceId] ?? null,
          });
          if (result._tag === "Failure") {
            report(squashAtomCommandFailure(result));
            continue;
          }
        }
        if (surface.kind === "terminal") {
          let failed = false;
          for (const terminalId of surface.terminalIds) {
            const result = await closeTerminal({
              environmentId: target.environmentId,
              input: { threadId: resourceId, terminalId, deleteHistory: true },
            });
            if (result._tag === "Failure") {
              report(squashAtomCommandFailure(result));
              failed = true;
            } else {
              useTerminalUiStateStore.getState().closeTerminal(target, terminalId);
              useRightPanelStore.getState().closeTerminal(target, surface.id, terminalId);
            }
          }
          if (failed) continue;
        }
        useRightPanelStore.getState().closeSurface(target, surface.id);
      }
    },
    [
      target,
      pendingSurfaceIds,
      labels,
      closePreview,
      preview.sessions,
      closeTerminal,
      resourceId,
      report,
    ],
  );

  useEffect(() => {
    if (preview.serverEpoch !== null)
      useRightPanelStore.getState().reconcileBrowserSurfaces(target, Object.keys(preview.sessions));
  }, [target, preview.serverEpoch, preview.sessions]);
  useEffect(
    () =>
      subscribePreviewAction((action) => {
        if (action === "toggle-panel") useRightPanelStore.getState().toggle(target, "preview");
      }),
    [target],
  );
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (
        preventRepeatedTerminalCloseShortcut(event, keybindings) ||
        (isTerminalCloseConfirmPending() && preventTerminalCloseShortcut(event, keybindings))
      ) {
        event.stopPropagation();
        return;
      }
      if (isCommandPaletteOpen()) return;
      const terminalFocus = getTerminalFocusOwner();
      if (event.defaultPrevented && terminalFocus === null) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: terminalFocus !== null,
          terminalOpen: terminalUi.terminalOpen,
          previewFocus: isPreviewFocused(),
          previewOpen: panel.isOpen && activeSurface?.kind === "preview",
          modelPickerOpen: composerRef.current?.isModelPickerOpen() ?? false,
          editableFocus:
            event.target instanceof HTMLElement &&
            Boolean(event.target.closest("input,textarea,select,[contenteditable=true]")),
          isWeb: !isElectron,
          isDesktop: isElectron,
        },
      });
      let action: (() => void) | null = null;
      const terminalController =
        terminalFocus === "right-panel" ? panelRef.current : drawerRef.current;
      switch (command) {
        case "terminal.toggle":
          action = () =>
            useTerminalUiStateStore.getState().setTerminalOpen(target, !terminalUi.terminalOpen);
          break;
        case "rightPanel.toggle":
          action = () => useRightPanelStore.getState().toggleVisibility(target);
          break;
        case "rightPanel.toggleMaximized":
          action = () => setMaximized((value) => !value);
          break;
        case "rightPanel.close":
          if (panel.isOpen && activeSurface) action = () => void closeSurfaces([activeSurface]);
          break;
        case "terminal.new":
          if (cwd)
            action = () => {
              if (terminalFocus === "right-panel") createTerminal();
              else {
                useTerminalUiStateStore.getState().setTerminalOpen(target, true);
                terminalController?.newTerminal();
              }
            };
          break;
        case "terminal.split":
        case "terminal.splitVertical":
          if (cwd)
            action = () => {
              if (terminalFocus !== "right-panel")
                useTerminalUiStateStore.getState().setTerminalOpen(target, true);
              terminalController?.splitTerminal(
                command === "terminal.splitVertical" ? "vertical" : "horizontal",
              );
            };
          break;
        case "terminal.close":
          if (terminalFocus || terminalUi.terminalOpen)
            action = () => terminalController?.closeActiveTerminal();
          break;
        case "diff.toggle":
          if (gitStatus.data?.isRepo)
            action = () => useRightPanelStore.getState().toggle(target, "diff");
          break;
        case "modelPicker.toggle":
          action = onOpenModels;
          break;
        case "composer.effort":
        case "composer.mode":
          action = () => composerRef.current?.openControl(command);
          break;
        case "thread.stop":
          if (
            busy &&
            !document.querySelector('[data-slot="dialog-popup"],[data-slot="menu-popup"]')
          )
            action = onInterrupt;
          break;
      }
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) action();
    };
    window.addEventListener("keydown", handle, true);
    return () => window.removeEventListener("keydown", handle, true);
  }, [
    target,
    keybindings,
    terminalUi.terminalOpen,
    panel.isOpen,
    activeSurface,
    composerRef,
    cwd,
    createTerminal,
    closeSurfaces,
    gitStatus.data?.isRepo,
    onOpenModels,
    onInterrupt,
    busy,
  ]);

  const openFile = (path: string) => useRightPanelStore.getState().openFile(target, path);
  const active = (surface: RightPanelSurface) => panel.isOpen && activeSurface?.id === surface.id;
  const tabs = (
    <RightPanelTabs
      mode={sheet ? "sheet" : "inline"}
      widthStorageKey={`t3code:preview-panel-width:${key}`}
      open={panel.isOpen}
      maximized={!sheet && maximized}
      surfaces={panel.surfaces}
      environmentId={target.environmentId}
      activeSurfaceId={activeSurface?.id ?? null}
      pendingSurfaceIds={pendingSurfaceIds}
      previewSessions={preview.sessions}
      desktopByTabId={preview.desktopByTabId}
      previewRuntimeTabId={(tabId) => previewRuntimeTabId(target, preview.serverEpoch, tabId)}
      terminalLabelsById={labels}
      onActivate={(surface) => {
        useRightPanelStore.getState().activateSurface(target, surface.id);
        if (surface.kind === "preview" && surface.resourceId)
          setActivePreviewTab(target, surface.resourceId);
      }}
      onCloseSurface={(surface) => void closeSurfaces([surface])}
      onCloseOtherSurfaces={(surface) =>
        void closeSurfaces(panel.surfaces.filter((other) => other.id !== surface.id))
      }
      onCloseSurfacesToRight={(surface) =>
        void closeSurfaces(
          panel.surfaces.slice(panel.surfaces.findIndex((other) => other.id === surface.id) + 1),
        )
      }
      onCloseAllSurfaces={() => void closeSurfaces(panel.surfaces)}
      onCopyFilePath={(path) => {
        void writeTextToClipboard(path).catch(report);
      }}
      onRenameDevice={(id, title) => useRightPanelStore.getState().renameDevice(target, id, title)}
      onAddBrowser={() => createBrowser()}
      onAddBrowserInProfile={createBrowser}
      onAddTerminal={createTerminal}
      onAddDiff={() => useRightPanelStore.getState().open(target, "diff")}
      onAddFiles={() => useRightPanelStore.getState().open(target, "files")}
      onAddAgents={() => useRightPanelStore.getState().open(target, "agents")}
      onAddDevice={() => useRightPanelStore.getState().open(target, "device")}
      browserAvailable={isPreviewSupportedInRuntime()}
      terminalAvailable={cwd !== null}
      diffAvailable={gitStatus.data?.isRepo === true}
      filesAvailable={cwd !== null}
      pullRequestAvailable={false}
      pullRequestsAvailable={false}
      agentsAvailable
      deviceAvailable
      liveAgentCount={agentModel.liveCount}
      nativeHistory={{ onOpen: onOpenTree }}
    >
      <Suspense fallback={null}>
        {activeSurface?.kind === "preview" ? (
          <PreviewPanel
            mode="embedded"
            placement={sheet ? "sheet" : "inline"}
            threadRef={target}
            tabId={activeSurface.resourceId}
            visible={panel.isOpen}
            onSendAnnotation={onSendAnnotation}
          />
        ) : null}
        {activeSurface?.kind === "diff" && cwd ? (
          <DiffPanel
            mode="embedded"
            composerDraftTarget={target}
            nativeWorkspace={{ target, cwd }}
            workspaceMutationId={workspaceMutationId}
          />
        ) : null}
        {activeSurface?.kind === "agents" ? (
          <AgentsPanel model={agentModel} environmentId={target.environmentId} />
        ) : null}
        {activeSurface?.kind === "native-history" ? (
          <Button variant="ghost" onClick={onOpenTree}>
            Session tree
          </Button>
        ) : null}
        {panel.surfaces.map((surface) =>
          surface.kind === "terminal" && cwd ? (
            <div
              key={surface.id}
              className={active(surface) ? "flex min-h-0 flex-1 flex-col" : "hidden"}
            >
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  useRightPanelStore.getState().closeSurface(target, surface.id);
                  useTerminalUiStateStore.getState().setTerminalOpen(target, true);
                }}
              >
                Return to terminal drawer
              </Button>
              <NativeSessionTerminal
                target={target}
                cwd={cwd}
                mode="panel"
                surface={surface}
                visible={active(surface)}
                keybindings={keybindings}
                onAddTerminalContext={onAddTerminalContext}
                {...(activeSurface?.id === surface.id ? { controllerRef: panelRef } : {})}
              />
            </div>
          ) : surface.kind === "file" || surface.kind === "files" ? (
            <div
              key={surface.id}
              className={active(surface) ? "flex min-h-0 flex-1 flex-col" : "hidden"}
            >
              <FilePreviewPanel
                environmentId={target.environmentId}
                cwd={cwd ?? ""}
                projectName={cwd?.split(/[\\/]/).at(-1) ?? ""}
                threadRef={target}
                composerDraftTarget={target}
                availableEditors={serverConfig?.availableEditors ?? []}
                relativePath={surface.kind === "file" ? surface.relativePath : null}
                {...(surface.kind === "file" && surface.attachment
                  ? { attachment: surface.attachment }
                  : {})}
                revealLine={surface.kind === "file" ? surface.revealLine : null}
                revealRequestId={surface.kind === "file" ? surface.revealRequestId : 0}
                onOpenFile={openFile}
                onPendingChange={(path, pending) =>
                  setPendingFiles((current) => {
                    const next = new Set(current);
                    if (pending) next.add(path);
                    else next.delete(path);
                    return next;
                  })
                }
                selectedFilePending={
                  surface.kind === "file" && pendingFiles.has(surface.relativePath)
                }
                workspaceMutationId={workspaceMutationId}
              />
            </div>
          ) : surface.kind === "device" ? (
            <div
              key={surface.id}
              className={active(surface) ? "flex min-h-0 flex-1 flex-col" : "hidden"}
            >
              <DevicePanel
                mode="embedded"
                threadRef={target}
                surface={surface}
                visible={active(surface)}
                onDismissSetup={() =>
                  useRightPanelStore.getState().closeSurface(target, surface.id)
                }
              />
            </div>
          ) : null,
        )}
      </Suspense>
    </RightPanelTabs>
  );
  const dropHandlers = makeWorkspaceFileDropHandlers({
    setDragActive,
    addFiles: (files) => composerRef.current?.addDroppedFiles(files),
    addFolders: (folders) => composerRef.current?.addDroppedFolders(folders),
  });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="flex shrink-0 flex-wrap items-center gap-1 border-b px-4 py-1"
        aria-label="Workspace tools"
      >
        <Button
          size="xs"
          variant="ghost"
          aria-pressed={terminalUi.terminalOpen}
          disabled={!cwd}
          onClick={() =>
            useTerminalUiStateStore.getState().setTerminalOpen(target, !terminalUi.terminalOpen)
          }
        >
          Terminal
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={!cwd}
          onClick={() =>
            useRightPanelStore.getState().openTerminal(target, terminalUi.activeTerminalId)
          }
        >
          Move terminal to panel
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => useRightPanelStore.getState().toggle(target, "preview")}
        >
          Browser
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={!cwd}
          onClick={() => useRightPanelStore.getState().toggle(target, "files")}
        >
          Files
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={gitStatus.data?.isRepo !== true}
          onClick={() => useRightPanelStore.getState().toggle(target, "diff")}
        >
          Diff
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => useRightPanelStore.getState().toggle(target, "agents")}
        >
          Agents {agentModel.liveCount || ""}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => useRightPanelStore.getState().toggle(target, "device")}
        >
          Devices
        </Button>
        <Button
          size="xs"
          variant="ghost"
          aria-pressed={panel.isOpen}
          onClick={() => useRightPanelStore.getState().toggleVisibility(target)}
        >
          Panel
        </Button>
        {panel.isOpen ? (
          <Button size="xs" variant="ghost" onClick={() => setMaximized((value) => !value)}>
            {maximized ? "Restore chat" : "Maximize panel"}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="px-4 py-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div
          className={
            maximized && panel.isOpen && !sheet
              ? "hidden"
              : "relative flex min-h-0 min-w-0 flex-1 flex-col"
          }
          {...dropHandlers}
          data-workspace-file-drag-active={dragActive || undefined}
        >
          {children}
          {miniPlayer ? (
            <ThreadPreviewMiniPlayer
              threadRef={target}
              miniPlayer={miniPlayer}
              composerOverlayElement={composerOverlayElement}
            />
          ) : null}
          {cwd ? (
            <NativeSessionTerminal
              target={target}
              cwd={cwd}
              keybindings={keybindings}
              visible={terminalUi.terminalOpen}
              onAddTerminalContext={onAddTerminalContext}
              controllerRef={drawerRef}
            />
          ) : null}
        </div>
        {sheet ? (
          <RightPanelSheet
            animationDurationMs={0}
            open={panel.isOpen}
            browserSurface={activeSurface?.kind === "preview"}
            onClose={() => useRightPanelStore.getState().close(target)}
          >
            {tabs}
          </RightPanelSheet>
        ) : (
          tabs
        )}
      </div>
    </div>
  );
}
