import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  EventId,
  ThreadId,
  type OrchestrationThreadActivity,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { act, useEffect, type MouseEvent } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useComposerDraftStore } from "../composerDraftStore";
import {
  useFailedSendDraftStore,
  type SubmittedComposerDraft,
} from "./chat/failedSendDraftRecovery";
import { FailedSendDraftRecovery } from "./FailedSendDraftRecovery";
import type { ToastManagerAddOptions } from "@base-ui/react/toast";
import type { ThreadToastData } from "./ui/toast";

type RecoveryToast = ToastManagerAddOptions<ThreadToastData>;

const io = vi.hoisted(() => ({
  activities: {} as Record<string, readonly OrchestrationThreadActivity[]>,
  statuses: {} as Record<string, string>,
  add: vi.fn<(options: RecoveryToast) => string>(),
  close: vi.fn(),
  update: vi.fn(),
  navigate: vi.fn(),
  mountedComposer: null as string | null,
}));
vi.mock("../state/entities", () => ({
  useThread: (target: ScopedThreadRef | null) =>
    target ? { activities: io.activities[scopedThreadKey(target)] ?? [] } : null,
  useThreadStatus: (target: ScopedThreadRef | null) =>
    target ? (io.statuses[scopedThreadKey(target)] ?? "live") : "empty",
}));
vi.mock("@tanstack/react-router", async (load) => ({
  ...(await load<typeof import("@tanstack/react-router")>()),
  useNavigate: () => io.navigate,
}));
vi.mock("./ui/toast", async () => ({
  ...(await import("./ui/toastHelpers")),
  toastManager: { add: io.add, close: io.close, update: io.update },
}));

const target = scopeThreadRef(EnvironmentId.make("local"), ThreadId.make("original"));
const destination = scopeThreadRef(EnvironmentId.make("remote"), target.threadId);
const key = scopedThreadKey(target);
const submitted: SubmittedComposerDraft = {
  prompt: "Original unsent prompt",
  images: [],
  files: [],
  terminalContexts: [],
  previewAnnotations: [],
  reviewComments: [],
};
const outcome = (kind = "provider.turn.start.failed"): OrchestrationThreadActivity => ({
  id: EventId.make(kind),
  kind,
  summary: kind,
  tone: "info",
  turnId: null,
  payload: { requestId: "send-a", timelineBypass: true },
  createdAt: "2026-10-30T10:00:00.000Z",
});

function ComposerRoute({ threadKey }: { threadKey: string }) {
  useEffect(() => {
    io.mountedComposer = threadKey;
    return () => {
      io.mountedComposer = null;
    };
  }, [threadKey]);
  return null;
}
function Shell({ route }: { route: string | null }) {
  return (
    <>
      <FailedSendDraftRecovery />
      {route ? <ComposerRoute threadKey={route} /> : null}
    </>
  );
}

let root: ReactTestRenderer | null = null;
const render = (route: string | null = null) =>
  act(() => {
    if (root) root.update(<Shell route={route} />);
    else root = create(<Shell route={route} />);
  });
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  io.activities = { [key]: [] };
  io.statuses = {};
  io.add.mockReset().mockReturnValue("recovery-toast");
  io.close.mockReset();
  io.update.mockReset();
  io.navigate.mockReset();
  useFailedSendDraftStore.setState({ submissionsByThreadKey: {} });
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
  });
});
afterEach(async () => {
  await act(() => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
});

describe("root-owned failed-send recovery", () => {
  it.each([null, scopedThreadKey(destination)])(
    "restores only the origin after its composer unmounts for route %s",
    async (route) => {
      useComposerDraftStore.getState().setPrompt(destination, "Destination work");
      useFailedSendDraftStore.getState().capture(target, "send-a", submitted);
      await render(key);
      expect(io.mountedComposer).toBe(key);
      await render(route);
      expect(io.mountedComposer).toBe(route);
      io.activities[key] = [outcome()];
      await render(route);
      expect(useComposerDraftStore.getState().getComposerDraft(target)?.prompt).toBe(
        submitted.prompt,
      );
      expect(useComposerDraftStore.getState().getComposerDraft(destination)?.prompt).toBe(
        "Destination work",
      );
      expect(useFailedSendDraftStore.getState().submissionsByThreadKey).toEqual({});
      expect(io.navigate).not.toHaveBeenCalled();
    },
  );

  it("retains a guarded Restore notice across navigation without overwriting whitespace", async () => {
    useComposerDraftStore.getState().setPrompt(target, " \n");
    useComposerDraftStore.getState().setPrompt(destination, "Destination work");
    useFailedSendDraftStore.getState().capture(target, "send-a", submitted);
    await render(key);
    io.activities[key] = [outcome()];
    await render(null);
    expect(io.add).toHaveBeenCalledTimes(1);
    const notice = io.add.mock.calls[0]![0];
    await act(() => notice.actionProps?.onClick?.({} as MouseEvent<HTMLButtonElement>));
    expect(useComposerDraftStore.getState().getComposerDraft(target)?.prompt).toBe(" \n");
    expect(io.navigate).not.toHaveBeenCalled();
    await render(scopedThreadKey(destination));
    await act(() => useComposerDraftStore.getState().clearComposerContent(target));
    await act(() => notice.actionProps?.onClick?.({} as MouseEvent<HTMLButtonElement>));
    expect(useComposerDraftStore.getState().getComposerDraft(target)?.prompt).toBe(
      submitted.prompt,
    );
    expect(useComposerDraftStore.getState().getComposerDraft(destination)?.prompt).toBe(
      "Destination work",
    );
    expect(useFailedSendDraftStore.getState().submissionsByThreadKey).toEqual({});
    expect(io.navigate).toHaveBeenCalledTimes(1);
  });

  it("releases a success while no composer is mounted and does not traverse history for streaming deltas", async () => {
    let traversals = 0;
    const activities = new Proxy([outcome("tool.completed")], {
      get: (array, property, receiver) => {
        if (property === Symbol.iterator) traversals++;
        return Reflect.get(array, property, receiver);
      },
    });
    io.activities[key] = activities;
    useFailedSendDraftStore.getState().capture(target, "send-a", submitted);
    await render(null);
    expect(traversals).toBeGreaterThan(0);
    traversals = 0;
    await render(null);
    await render(null);
    expect(traversals).toBe(0);
    io.activities[key] = [...activities, outcome("provider.turn.start.succeeded")];
    await render(null);
    expect(useFailedSendDraftStore.getState().submissionsByThreadKey).toEqual({});
    expect(useComposerDraftStore.getState().getComposerDraft(target)).toBeNull();
    expect(io.add).not.toHaveBeenCalled();
  });

  it.each(["dismiss", "delete"])(
    "disposes retained recovery on explicit %s without changing the newer draft",
    async (action) => {
      useComposerDraftStore.getState().setPrompt(target, "Newer draft");
      useFailedSendDraftStore.getState().capture(target, "send-a", submitted);
      io.activities[key] = [outcome()];
      await render(null);
      if (action === "dismiss") {
        await act(() => io.add.mock.calls[0]![0].onClose?.());
      } else {
        io.statuses[key] = "deleted";
        await render(null);
      }
      expect(useFailedSendDraftStore.getState().submissionsByThreadKey).toEqual({});
      expect(useComposerDraftStore.getState().getComposerDraft(target)?.prompt).toBe("Newer draft");
      expect(io.close).toHaveBeenCalled();
    },
  );
});
