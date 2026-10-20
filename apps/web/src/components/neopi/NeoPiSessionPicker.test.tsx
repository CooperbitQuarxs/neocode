import {
  EMPTY_ENVIRONMENT_THREAD_STATE,
  type EnvironmentThreadState,
} from "@t3tools/client-runtime/state/threads";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type NeoPiSessionResumeResult,
  type NeoPiSessionDiagnostic,
  type NeoPiSessionSummary,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  act,
  StrictMode,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => ({
  sessions: [] as NeoPiSessionSummary[],
  diagnostics: [] as NeoPiSessionDiagnostic[],
  threads: new Map<string, EnvironmentThreadState>(),
  empty: null as EnvironmentThreadState | null,
  listeners: new Set<() => void>(),
  resume: vi.fn(),
  refresh: vi.fn(),
  navigate: vi.fn(),
  onClose: vi.fn(),
}));

vi.mock("../../state/neopiSessions", () => ({
  neopiSessionList: () => null,
  neopiSessionResume: Symbol("resume"),
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({
    data: { status: "available", sessions: fixture.sessions, diagnostics: fixture.diagnostics },
    error: null,
    isPending: false,
    refresh: fixture.refresh,
  }),
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => fixture.resume,
}));
vi.mock("../../state/threads", () => {
  const subscribe = (listener: () => void) => {
    fixture.listeners.add(listener);
    return () => fixture.listeners.delete(listener);
  };
  return {
    useEnvironmentThread: (environmentId: EnvironmentId | null, threadId: ThreadId | null) => {
      const read = () => {
        if (fixture.empty === null) throw new Error("Thread fixture is not initialized");
        return fixture.threads.get(`${environmentId}:${threadId}`) ?? fixture.empty;
      };
      return useSyncExternalStore(subscribe, read, read);
    },
  };
});
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => fixture.navigate }));
vi.mock("../ui/badge", () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../ui/button", () => ({
  Button: ({ children, onClick, disabled }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("../ui/command", () => {
  const Container = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Command: Container,
    CommandDialogPopup: Container,
    CommandList: Container,
    CommandInput: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
    CommandItem: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
    CommandDialog: ({
      children,
      onOpenChange,
    }: {
      children: ReactNode;
      onOpenChange: (open: boolean) => void;
    }) => (
      <div>
        <button aria-label="Close picker" onClick={() => onOpenChange(false)} />
        {children}
      </div>
    ),
  };
});

import { NeoPiSessionPicker } from "./NeoPiSessionPicker";

type ResumeResult = AtomCommandResult<NeoPiSessionResumeResult, unknown>;
const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("project");
const restoredId = ThreadId.make("restored-thread");
let completeResume!: (result: ResumeResult) => void;
let renderer: ReactTestRenderer | null = null;

function session(overrides: Partial<NeoPiSessionSummary> = {}): NeoPiSessionSummary {
  return {
    providerInstanceId: ProviderInstanceId.make("neopi-personal"),
    sessionId: "native-session",
    sessionFile: "/sessions/native-session.jsonl",
    cwd: "/workspace/project",
    title: "Native session",
    firstMessage: "Original terminal turn",
    createdAt: "2026-10-18T10:00:00.000Z",
    modifiedAt: "2026-10-18T11:00:00.000Z",
    messageCount: 2,
    owner: { kind: "none" },
    threadId: null,
    projectId,
    ...overrides,
  };
}

function detail(threadId: ThreadId, ownProjectId = projectId): EnvironmentThreadState {
  const thread: OrchestrationThread = {
    id: threadId,
    projectId: ownProjectId,
    title: "Restored native session",
    modelSelection: { instanceId: ProviderInstanceId.make("neopi-personal"), model: "saved-model" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-10-18T10:00:00.000Z",
    updatedAt: "2026-10-18T11:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    pullRequests: [],
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
  };
  return { ...EMPTY_ENVIRONMENT_THREAD_STATE, data: Option.some(thread), status: "live" };
}

function publish(threadId: ThreadId, state: EnvironmentThreadState) {
  fixture.threads.set(`${environmentId}:${threadId}`, state);
  for (const listener of fixture.listeners) listener();
}

async function mount(row = session()) {
  fixture.sessions = [row];
  await act(async () => {
    renderer = create(
      <StrictMode>
        <NeoPiSessionPicker target={{ environmentId, projectId }} onClose={fixture.onClose} />
      </StrictMode>,
    );
  });
}

async function select() {
  await act(async () => {
    renderer!.root
      .findAllByType("button")
      .find((row) => row.props.value === fixture.sessions[0]!.sessionFile)!
      .props.onClick();
  });
}

async function finishResume(threadId = restoredId, created = true) {
  await act(async () => {
    completeResume(AsyncResult.success({ threadId, created }));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  renderer = null;
  fixture.sessions = [];
  fixture.diagnostics = [];
  fixture.threads.clear();
  fixture.listeners.clear();
  fixture.empty = EMPTY_ENVIRONMENT_THREAD_STATE;
  fixture.resume.mockReset().mockReturnValue(
    new Promise<ResumeResult>((resolve) => {
      completeResume = resolve;
    }),
  );
  fixture.refresh.mockReset();
  fixture.navigate.mockReset().mockResolvedValue(undefined);
  fixture.onClose.mockReset();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});

describe("NeoPi picker restoration", () => {
  it("reports the failed instance while keeping healthy sessions selectable", async () => {
    const failedId = ProviderInstanceId.make("neopi-broken");
    fixture.diagnostics = [{ providerInstanceId: failedId, message: "Command timed out." }];
    await mount();
    const alert = renderer!.root.findByProps({ role: "alert" });
    expect(alert.children.join("")).toContain(failedId);
    expect(alert.children.join("")).toContain(fixture.diagnostics[0]!.message);
    await select();
    expect(fixture.resume).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: {
        projectId,
        sessionFile: fixture.sessions[0]!.sessionFile,
        providerInstanceId: fixture.sessions[0]!.providerInstanceId,
      },
    });
    await finishResume();
    await act(async () => publish(restoredId, detail(restoredId)));
    expect(fixture.navigate).toHaveBeenCalledTimes(1);
    expect(fixture.onClose).toHaveBeenCalledTimes(1);
  });

  it("waits for the returned thread in the shared detail store before navigating", async () => {
    await mount();
    await select();
    expect(fixture.navigate).not.toHaveBeenCalled();
    await finishResume();
    expect(fixture.navigate).not.toHaveBeenCalled();
    expect(renderer!.root.findByProps({ role: "status" }).children).toEqual([
      "Loading restored NeoCode thread…",
    ]);

    await act(async () => {
      const unrelatedId = ThreadId.make("unrelated-thread");
      publish(unrelatedId, detail(unrelatedId));
    });
    expect(fixture.navigate).not.toHaveBeenCalled();
    await act(async () => publish(restoredId, detail(restoredId)));
    expect(fixture.navigate).toHaveBeenCalledExactlyOnceWith({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId: restoredId },
    });
    expect(fixture.onClose).toHaveBeenCalledTimes(1);
  });

  it("refreshes an already bound row and honors the backend's returned identity", async () => {
    const boundId = ThreadId.make("listed-thread");
    publish(boundId, detail(boundId));
    await mount(session({ threadId: boundId, owner: { kind: "neocode", threadId: boundId } }));
    await select();
    expect(fixture.resume).toHaveBeenCalledTimes(1);
    expect(fixture.navigate).not.toHaveBeenCalled();
    await finishResume(restoredId, false);
    expect(fixture.navigate).not.toHaveBeenCalled();
    await act(async () => publish(restoredId, detail(restoredId)));
    expect(fixture.navigate).toHaveBeenCalledExactlyOnceWith({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId: restoredId },
    });
  });

  it("opens an existing GUI-owned thread after refresh without waiting for a new detail object", async () => {
    publish(restoredId, detail(restoredId));
    await mount(
      session({ threadId: restoredId, owner: { kind: "neocode", threadId: restoredId } }),
    );
    await select();
    expect(fixture.navigate).not.toHaveBeenCalled();
    await finishResume(restoredId, false);
    expect(fixture.resume).toHaveBeenCalledTimes(1);
    expect(fixture.navigate).toHaveBeenCalledTimes(1);
    expect(fixture.onClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["deleted", { status: "deleted" as const }, "The bound NeoCode thread was deleted."],
    ["failed", { error: Option.some("Thread stream disconnected") }, "Thread stream disconnected"],
  ] as const)(
    "surfaces a %s thread detail without redirecting",
    async (_label, failure, message) => {
      await mount();
      await select();
      await finishResume();
      await act(async () => publish(restoredId, { ...EMPTY_ENVIRONMENT_THREAD_STATE, ...failure }));
      expect(renderer!.root.findByProps({ role: "alert" }).children).toEqual([message]);
      expect(fixture.navigate).not.toHaveBeenCalled();
      expect(fixture.onClose).not.toHaveBeenCalled();
      await act(async () => publish(restoredId, detail(restoredId)));
      expect(fixture.navigate).not.toHaveBeenCalled();
    },
  );

  it("cancels an in-flight restoration when the dialog closes", async () => {
    await mount();
    await select();
    await act(async () => {
      renderer!.root.findByProps({ "aria-label": "Close picker" }).props.onClick();
    });
    await finishResume();
    await act(async () => publish(restoredId, detail(restoredId)));
    expect(fixture.navigate).not.toHaveBeenCalled();
    expect(fixture.onClose).toHaveBeenCalledTimes(1);
  });

  it("does not navigate after unmount while waiting for client hydration", async () => {
    await mount();
    await select();
    await finishResume();
    await act(async () => renderer!.unmount());
    renderer = null;
    await act(async () => publish(restoredId, detail(restoredId)));
    expect(fixture.navigate).not.toHaveBeenCalled();
    expect(fixture.onClose).not.toHaveBeenCalled();
  });

  it("ignores duplicate selections before React has flushed pending state", async () => {
    await mount();
    const row = renderer!.root
      .findAllByType("button")
      .find((button) => button.props.value === fixture.sessions[0]!.sessionFile)!;
    await act(async () => {
      row.props.onClick();
      row.props.onClick();
    });
    expect(fixture.resume).toHaveBeenCalledTimes(1);
    await finishResume();
    await act(async () => publish(restoredId, detail(restoredId)));
    expect(fixture.navigate).toHaveBeenCalledTimes(1);
  });

  it("uses the bound thread's own project when discovery has no project metadata", async () => {
    const ownProjectId = ProjectId.make("different-project");
    await mount(session({ projectId: null, threadId: restoredId }));
    await select();
    expect(fixture.resume).not.toHaveBeenCalled();
    await act(async () => publish(restoredId, detail(restoredId, ownProjectId)));
    expect(fixture.resume).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: {
        projectId: ownProjectId,
        sessionFile: fixture.sessions[0]!.sessionFile,
        providerInstanceId: fixture.sessions[0]!.providerInstanceId,
      },
    });
    expect(fixture.navigate).not.toHaveBeenCalled();
    await finishResume(restoredId, false);
    expect(fixture.navigate).toHaveBeenCalledTimes(1);
  });

  it("shows resume failures without navigating to an existing bound thread", async () => {
    fixture.resume.mockRejectedValue(new Error("Native branch diverged"));
    publish(restoredId, detail(restoredId));
    await mount(session({ threadId: restoredId }));
    await select();
    expect(renderer!.root.findByProps({ role: "alert" }).children).toEqual([
      "Native branch diverged",
    ]);
    expect(fixture.navigate).not.toHaveBeenCalled();
    expect(fixture.onClose).not.toHaveBeenCalled();
  });
});
