import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  EventId,
  NeoPiSettings,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationProjectShell,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import { makeTestProviderAdapterHarness } from "../../../integration/TestProviderAdapter.integration.ts";
import { buildInitialNeoPiProviderSnapshot } from "../Layers/NeoPiProvider.ts";
import { layerTest as configLayer } from "../../config.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { layerTest as settingsLayer } from "../../serverSettings.ts";
import type { ProviderInstance } from "../ProviderDriver.ts";
import { ProviderInstanceRegistry } from "../Services/ProviderInstanceRegistry.ts";
import {
  ProviderSessionDirectory,
  type ProviderRuntimeBindingWithMetadata,
} from "../Services/ProviderSessionDirectory.ts";
import { makeNeoPiSessionCatalog, type NeoPiSessionCommandInput } from "./NeoPiSessionCatalog.ts";
import { registerNeoPiSessionCatalogSource } from "./NeoPiSessionCatalogSource.ts";

const projectId = ProjectId.make("project");
const instanceId = ProviderInstanceId.make("neopi-personal");
const cwd = "/tmp/neocode-session-catalog-workspace";
const now = "2026-10-18T12:00:00.000Z";
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeNeoPiSettings = Schema.decodeEffect(NeoPiSettings);
const project: OrchestrationProjectShell = {
  id: projectId,
  title: "Project",
  workspaceRoot: cwd,
  defaultModelSelection: null,
  scripts: [],
  createdAt: now,
  updatedAt: now,
};
const session = (id: string, extra: object = {}) => ({
  path: `/tmp/neocode-catalog-sessions/${id}.jsonl`,
  id,
  cwd,
  title: "Imported NeoPi session",
  created: now,
  modified: now,
  messageCount: 2,
  firstMessage: "Fix this",
  inUse: null,
  control: null,
  ...extra,
});
const bound = (
  id: string,
  status: "running" | "stopped" = "stopped",
): ProviderRuntimeBindingWithMetadata => ({
  threadId: ThreadId.make(`bound-${id}`),
  provider: ProviderDriverKind.make("neopi"),
  providerInstanceId: instanceId,
  status,
  lastSeenAt: now,
  resumeCursor: { sessionFile: session(id).path, sessionId: id },
});
const projectedThread = (
  id: ThreadId,
  overrides: Partial<OrchestrationThread> = {},
): OrchestrationThread => ({
  id,
  projectId,
  title: "Imported NeoPi session",
  modelSelection: { instanceId, model: "default-model" },
  runtimeMode: "full-access",
  interactionMode: "default",
  pullRequests: [],
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
  ...overrides,
});

const harness = (options?: {
  capabilities?: string[];
  rows?: object[];
  bindings?: ProviderRuntimeBindingWithMetadata[];
  threads?: OrchestrationThread[];
  defaultInstanceId?: ProviderInstanceId;
  extraInstances?: {
    instanceId: ProviderInstanceId;
    capabilities: string[];
    rows: object[];
    enabled?: boolean;
  }[];
}) =>
  Effect.gen(function* () {
    const calls: NeoPiSessionCommandInput[] = [];
    const commands: OrchestrationCommand[] = [];
    const bindings = [...(options?.bindings ?? [])];
    const threads = new Map((options?.threads ?? []).map((thread) => [thread.id, thread]));
    const order: string[] = [];
    const adapterHarness = yield* makeTestProviderAdapterHarness({
      provider: ProviderDriverKind.make("neopi"),
    });
    const providerSettings = yield* decodeNeoPiSettings({});
    const initial = yield* buildInitialNeoPiProviderSnapshot(providerSettings);
    const snapshot = {
      ...initial,
      instanceId,
      driver: ProviderDriverKind.make("neopi"),
      models: [
        {
          slug: "default-model",
          name: "Default",
          isDefault: true,
          isCustom: false,
          capabilities: null,
        },
      ],
    };
    const instance = registerNeoPiSessionCatalogSource(
      {
        instanceId,
        driverKind: ProviderDriverKind.make("neopi"),
        enabled: true,
        continuationIdentity: {
          driverKind: ProviderDriverKind.make("neopi"),
          continuationKey: instanceId,
        },
        displayName: undefined,
        adapter: adapterHarness.adapter,
        textGeneration: {
          generateBranchName: () => Effect.die("unused"),
          generateCommitMessage: () => Effect.die("unused"),
          generatePrContent: () => Effect.die("unused"),
          generateThreadTitle: () => Effect.die("unused"),
        },
        snapshot: {
          getSnapshot: Effect.succeed(snapshot),
          refresh: Effect.succeed(snapshot),
          resolveMaintenance: () => Effect.die("unused"),
          streamChanges: Stream.empty,
          applyUsageLimits: () => Effect.void,
        },
      } satisfies ProviderInstance,
      {
        binary: "/opt/npi",
        env: { OMP_PROFILE: "personal" },
        profile: "personal",
        capabilities: new Set(options?.capabilities ?? ["session_catalog", "control_pipe"]),
      },
    );
    const extraInstances = (options?.extraInstances ?? []).map((entry) =>
      registerNeoPiSessionCatalogSource(
        { ...instance, instanceId: entry.instanceId, enabled: entry.enabled ?? true },
        {
          binary: `/opt/${entry.instanceId}/npi`,
          env: { OMP_PROFILE: entry.instanceId },
          profile: entry.instanceId,
          capabilities: new Set(entry.capabilities),
        },
      ),
    );
    const allInstances = [instance, ...extraInstances];
    const catalog = yield* makeNeoPiSessionCatalog((input) =>
      Effect.sync(() => {
        calls.push(input);
        if (input.args[1] === "read")
          return encodeJson({
            version: 1,
            session: session("free"),
            truncated: false,
            messages: [
              { role: "user", text: "Fix this", timestamp: now },
              { role: "assistant", text: "Fixed it", timestamp: now },
            ],
          });
        const extra = options?.extraInstances?.find(
          (entry) => entry.instanceId === input.source.profile,
        );
        return encodeJson({
          version: 1,
          sessions: extra?.rows ?? options?.rows ?? [session("free")],
        });
      }),
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.mock(ProviderInstanceRegistry)({
            listInstances: Effect.succeed(allInstances),
            getInstance: (id) =>
              Effect.succeed(allInstances.find((entry) => entry.instanceId === id)),
          }),
          Layer.mock(ProjectionSnapshotQuery)({
            getProjectShellById: () => Effect.succeedSome(project),
            getShellSnapshot: () =>
              Effect.succeed({
                snapshotSequence: 0,
                projects: [project],
                threads: [],
                updatedAt: now,
              }),
            getThreadDetailById: (id) => Effect.sync(() => Option.fromUndefinedOr(threads.get(id))),
          }),
          Layer.mock(ProviderSessionDirectory)({
            listBindings: () => Effect.sync(() => bindings),
            getBinding: (id) =>
              Effect.sync(() =>
                Option.fromUndefinedOr(bindings.find((binding) => binding.threadId === id)),
              ),
            upsert: (binding, upsertOptions) =>
              Effect.sync(() => {
                expect(upsertOptions).toEqual({ onConflict: "ignore" });
                order.push("binding");
                if (!bindings.some((entry) => entry.threadId === binding.threadId))
                  bindings.push({ ...binding, lastSeenAt: now });
              }),
          }),
          Layer.mock(OrchestrationEngineService)({
            subscribeDomainEvents: Effect.succeed(
              Stream.suspend(() =>
                Stream.fromIterable(
                  commands
                    .filter((command) => command.type === "thread.session.stop")
                    .map((command): OrchestrationEvent => ({
                      type: "thread.session-set",
                      sequence: 1,
                      eventId: EventId.make("stop-receipt"),
                      aggregateKind: "thread",
                      aggregateId: command.threadId,
                      occurredAt: now,
                      commandId: command.commandId,
                      causationEventId: null,
                      correlationId: null,
                      metadata: {},
                      payload: {
                        threadId: command.threadId,
                        session: {
                          threadId: command.threadId,
                          status: "stopped",
                          providerName: "neopi",
                          runtimeMode: "full-access",
                          activeTurnId: null,
                          lastError: null,
                          updatedAt: now,
                        },
                      },
                    })),
                ),
              ),
            ),
            dispatch: (command) =>
              Effect.sync(() => {
                commands.push(command);
                order.push(command.type);
                if (command.type === "thread.create")
                  threads.set(command.threadId, projectedThread(command.threadId));
                return { sequence: commands.length };
              }),
          }),
          settingsLayer(
            options?.defaultInstanceId
              ? {
                  defaultModelSelection: {
                    instanceId: options.defaultInstanceId,
                    model: "default-model",
                  },
                }
              : {},
          ),
          configLayer(cwd, { prefix: "neocode-catalog-test-" }),
        ),
      ),
    );
    return { catalog, calls, commands, bindings, order };
  });

it.layer(NodeServices.layer)("NeoPiSessionCatalog", (it) => {
  describe("list", () => {
    it.effect("maps free, terminal-owned and NeoCode-owned sessions and workspace identities", () =>
      Effect.gen(function* () {
        const { catalog, calls } = yield* harness({
          rows: [
            session("free"),
            session("terminal", { inUse: { pid: 123 }, control: { instanceId: "terminal-owner" } }),
            session("live", { inUse: { pid: 456 } }),
            session("foreign", { cwd: "/elsewhere" }),
          ],
          bindings: [bound("free"), bound("live", "running")],
        });
        const result = yield* catalog.list({ projectId, scope: "all" });
        expect(result.status).toBe("available");
        if (result.status !== "available") return;
        expect(
          result.sessions.map((row) => [row.sessionId, row.owner, row.threadId, row.projectId]),
        ).toEqual([
          ["free", { kind: "none" }, ThreadId.make("bound-free"), projectId],
          ["terminal", { kind: "process", pid: 123, attachable: true }, null, projectId],
          [
            "live",
            { kind: "neocode", threadId: ThreadId.make("bound-live") },
            ThreadId.make("bound-live"),
            projectId,
          ],
          ["foreign", { kind: "none" }, null, null],
        ]);
        expect(calls[0]?.args).toEqual(["sessions", "list", "--json", "--all"]);
        expect(calls[0]?.cwd).toBe(cwd);
        expect(calls[0]?.source.env.OMP_PROFILE).toBe("personal");
      }),
    );
    it.effect("never invokes unsupported CLI commands", () =>
      Effect.gen(function* () {
        const { catalog, calls } = yield* harness({ capabilities: [] });
        expect(yield* catalog.list({ projectId, scope: "project" })).toEqual({
          status: "unavailable",
          reason:
            "Update NeoPi: this npi does not support session discovery (needs session_catalog).",
        });
        expect(calls).toHaveLength(0);
      }),
    );
    it.effect("filters the project scope and requires control_pipe for attachment", () =>
      Effect.gen(function* () {
        const { catalog, calls } = yield* harness({
          capabilities: ["session_catalog"],
          rows: [
            session("terminal", { inUse: { pid: 1 }, control: { instanceId: "owner" } }),
            session("foreign", { cwd: "/elsewhere" }),
          ],
        });
        const result = yield* catalog.list({ projectId, scope: "project" });
        expect(result.status === "available" && result.sessions.map((row) => row.owner)).toEqual([
          { kind: "process", pid: 1, attachable: false },
        ]);
        expect(calls[0]?.args).toEqual(["sessions", "list", "--json", "--cwd", cwd]);
      }),
    );
    it.effect("merges capable instances and keeps the default origin for duplicate paths", () =>
      Effect.gen(function* () {
        const otherId = ProviderInstanceId.make("neopi-work");
        const { catalog } = yield* harness({
          rows: [session("personal"), session("shared")],
          defaultInstanceId: otherId,
          extraInstances: [
            {
              instanceId: otherId,
              capabilities: ["session_catalog"],
              rows: [session("work"), session("shared")],
            },
          ],
        });
        const result = yield* catalog.list({ projectId, scope: "all" });
        expect(result.status).toBe("available");
        if (result.status !== "available") return;
        expect(result.sessions.map((row) => [row.sessionId, row.providerInstanceId])).toEqual([
          ["work", otherId],
          ["shared", otherId],
          ["personal", instanceId],
        ]);
      }),
    );
    it.effect("remains available when only a later enabled instance supports catalogs", () =>
      Effect.gen(function* () {
        const capableId = ProviderInstanceId.make("neopi-capable");
        const { catalog, calls } = yield* harness({
          capabilities: [],
          extraInstances: [
            {
              instanceId: capableId,
              capabilities: ["session_catalog"],
              rows: [session("capable")],
            },
            {
              instanceId: ProviderInstanceId.make("neopi-disabled"),
              capabilities: ["session_catalog"],
              rows: [session("disabled")],
              enabled: false,
            },
          ],
        });
        const result = yield* catalog.list({ projectId, scope: "all" });
        expect(
          result.status === "available" && result.sessions.map((row) => row.providerInstanceId),
        ).toEqual([capableId]);
        expect(calls.every((call) => call.source.profile === capableId)).toBe(true);
      }),
    );
  });
  it.effect(
    "installs the cursor before creating the thread, imports text, and resumes idempotently",
    () =>
      Effect.gen(function* () {
        const { catalog, calls, commands, bindings, order } = yield* harness();
        const first = yield* catalog.resume({
          projectId,
          providerInstanceId: instanceId,
          sessionFile: session("free").path,
        });
        expect(first).toEqual({ threadId: `import:${instanceId}:free`, created: true });
        expect(order).toEqual(["binding", "thread.create", "thread.history.import"]);
        expect(bindings[0]?.resumeCursor).toEqual({
          v: 1,
          sessionFile: session("free").path,
          sessionId: "free",
          sessionDir: "/tmp/neocode-catalog-sessions",
          sharedSession: true,
          turnBoundaries: [],
        });
        expect(commands[0]).toMatchObject({
          historyImport: true,
          modelSelection: { instanceId, model: "default-model" },
        });
        expect(commands[1]).toMatchObject({
          messages: [
            { messageId: `${first.threadId}:000000`, role: "user", text: "Fix this" },
            { messageId: `${first.threadId}:000001`, role: "assistant", text: "Fixed it" },
          ],
        });
        expect(calls.find((call) => call.args[1] === "read")?.args).toEqual([
          "sessions",
          "read",
          "--json",
          session("free").path,
          "--max-messages",
          "200",
        ]);
        expect(
          yield* catalog.resume({
            projectId,
            providerInstanceId: instanceId,
            sessionFile: session("free").path,
          }),
        ).toEqual({
          threadId: first.threadId,
          created: false,
        });
        expect(commands).toHaveLength(2);
      }),
  );
  it.effect("routes resume and terminal handoff through the row's originating instance", () =>
    Effect.gen(function* () {
      const otherId = ProviderInstanceId.make("neopi-work");
      const { catalog, calls, bindings, commands } = yield* harness({
        rows: [],
        extraInstances: [
          { instanceId: otherId, capabilities: ["session_catalog"], rows: [session("free")] },
        ],
      });
      const result = yield* catalog.resume({
        projectId,
        providerInstanceId: otherId,
        sessionFile: session("free").path,
      });
      expect(result.threadId).toBe(`import:${otherId}:free`);
      expect(bindings[0]?.providerInstanceId).toBe(otherId);
      expect(commands[0]).toMatchObject({ modelSelection: { instanceId: otherId } });
      const handoff = yield* catalog.handoff({ threadId: result.threadId });
      expect(handoff.command).toContain(`OMP_PROFILE='${otherId}' '/opt/${otherId}/npi'`);
      expect(calls.every((call) => call.source.profile === otherId)).toBe(true);
    }),
  );
  it.effect("rejects unlisted files and mismatched workspaces without creating threads", () =>
    Effect.gen(function* () {
      const { catalog, commands } = yield* harness({
        rows: [session("foreign", { cwd: "/elsewhere" })],
      });
      const unlisted = yield* catalog
        .resume({ projectId, providerInstanceId: instanceId, sessionFile: "/etc/passwd" })
        .pipe(Effect.result);
      const mismatch = yield* catalog
        .resume({ projectId, providerInstanceId: instanceId, sessionFile: session("foreign").path })
        .pipe(Effect.result);
      expect(unlisted._tag).toBe("Failure");
      expect(mismatch._tag).toBe("Failure");
      expect(commands).toEqual([]);
    }),
  );
  it.effect("hands a bound thread back through orchestration and quotes its terminal command", () =>
    Effect.gen(function* () {
      const binding = bound("free", "running");
      const { catalog, commands } = yield* harness({
        bindings: [binding],
        threads: [
          projectedThread(binding.threadId, {
            session: {
              threadId: binding.threadId,
              status: "running",
              providerName: "neopi",
              runtimeMode: "full-access",
              activeTurnId: null,
              lastError: null,
              updatedAt: now,
            },
          }),
        ],
      });
      const result = yield* catalog.handoff({ threadId: binding.threadId });
      expect(commands).toHaveLength(1);
      expect(commands[0]).toMatchObject({
        type: "thread.session.stop",
        threadId: binding.threadId,
      });
      expect(result).toEqual({
        sessionFile: session("free").path,
        sessionId: "free",
        cwd,
        command: `cd '${cwd}' && OMP_PROFILE='personal' '/opt/npi' --session '${session("free").path}'`,
      });
    }),
  );
  it.effect("refuses a terminal command when stopping only detached from the lease holder", () =>
    Effect.gen(function* () {
      const binding = bound("free", "running");
      const { catalog, commands, calls } = yield* harness({
        bindings: [binding],
        threads: [projectedThread(binding.threadId)],
        rows: [session("free", { inUse: { pid: 123 }, control: { instanceId: "owner" } })],
      });
      const error = yield* Effect.flip(catalog.handoff({ threadId: binding.threadId }));
      expect(error.operation).toBe("handoff");
      expect(error.message).toContain("still open in the terminal process (PID 123)");
      expect(error.message).toContain("NeoCode merely detached");
      expect(commands.map((command) => command.type)).toEqual(["thread.session.stop"]);
      expect(calls.at(-1)?.args).toEqual([
        "sessions",
        "list",
        "--json",
        "--session-dir",
        "/tmp/neocode-catalog-sessions",
      ]);
    }),
  );
});
