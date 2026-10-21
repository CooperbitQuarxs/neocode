// @effect-diagnostics nodeBuiltinImport:off -- NeoPi CLI identities are absolute filesystem paths.
import * as NodePath from "node:path";
import {
  CommandId,
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  defaultInstanceIdForDriver,
  IsoDateTime,
  MessageId,
  NeoPiSessionError,
  NonNegativeInt,
  ThreadId,
  type NeoPiSessionListInput,
  type NeoPiSessionListResult,
  type NeoPiSessionDiagnostic,
  type NeoPiSessionSummary,
  type NeoPiSessionResumeInput,
  type NeoPiSessionResumeResult,
  type NeoPiSessionHandoffInput,
  type NeoPiSessionHandoffResult,
  type NeoPiSessionConfigurationInput,
  type NeoPiSessionConfigurationResult,
} from "@t3tools/contracts";
import { normalizeProjectPathForComparison } from "@t3tools/shared/path";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { ServerConfig } from "../../config.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { collectUint8StreamText } from "../../stream/collectUint8StreamText.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderInstanceRegistry } from "../Services/ProviderInstanceRegistry.ts";
import {
  ProviderSessionDirectory,
  type ProviderRuntimeBinding,
} from "../Services/ProviderSessionDirectory.ts";
import type { ProviderInstance } from "../ProviderDriver.ts";
import type { NeoPiConfigurationIdentity } from "./NeoPiSessionConfiguration.ts";
import { NEOPI_CAPABILITIES } from "./NeoPiCompatibility.ts";
import { resolveNeoPiSessionRoots } from "./NeoPiPaths.ts";
import {
  neoPiSessionCatalogSource,
  type NeoPiSessionCatalogSource,
} from "./NeoPiSessionCatalogSource.ts";

const Session = Schema.Struct({
  path: Schema.String,
  id: Schema.String,
  cwd: Schema.String,
  title: Schema.NullOr(Schema.String),
  created: IsoDateTime,
  modified: IsoDateTime,
  messageCount: NonNegativeInt,
  firstMessage: Schema.String,
  inUse: Schema.NullOr(Schema.Struct({ pid: NonNegativeInt })),
  control: Schema.NullOr(Schema.Struct({ instanceId: Schema.String })),
});
const ListOutput = Schema.Struct({ version: Schema.Literal(1), sessions: Schema.Array(Session) });
const NativeMessage = Schema.Struct({
  entryId: Schema.String,
  role: Schema.Literals(["user", "assistant"]),
  text: Schema.String,
  timestamp: IsoDateTime,
});
const ReadOutput = Schema.Struct({
  version: Schema.Literal(1),
  session: Schema.Struct({
    path: Schema.String,
    id: Schema.String,
    cwd: Schema.String,
    title: Schema.NullOr(Schema.String),
  }),
  messages: Schema.Array(NativeMessage),
  branchMessages: Schema.Array(NativeMessage),
  branchMessagesTruncated: Schema.Boolean,
  truncated: Schema.Boolean,
  branchEntryIds: Schema.Array(Schema.String),
  leafId: Schema.NullOr(Schema.String),
  userEntryIds: Schema.optional(Schema.Array(Schema.String)),
  sessionExitEntryIds: Schema.optional(Schema.Array(Schema.String)),
  sessionExits: Schema.optional(
    Schema.Array(
      Schema.Struct({
        entryId: Schema.String,
        kind: Schema.String,
        reason: Schema.String,
        pendingToolCallCount: NonNegativeInt,
        lastAssistantStopReason: Schema.NullOr(Schema.String),
      }),
    ),
  ),
});
const Cursor = Schema.Struct({
  sessionFile: Schema.String,
  sessionId: Schema.String,
  historyLeafId: Schema.optional(Schema.NullOr(Schema.String)),
  turnBoundaries: Schema.optional(
    Schema.Array(
      Schema.Struct({
        turnId: Schema.String,
        userEntryId: Schema.optional(Schema.String),
      }),
    ),
  ),
});
const decodeCursor = Schema.decodeUnknownOption(Cursor);
const decodeListOutput = Schema.decodeEffect(Schema.fromJsonString(ListOutput));
const decodeReadOutput = Schema.decodeEffect(Schema.fromJsonString(ReadOutput));
const isNeoPiSessionError = Schema.is(NeoPiSessionError);
const capabilityUnavailable = (
  source: NeoPiSessionCatalogSource | undefined,
  capability: string,
): string => {
  if (!source) return "NeoPi session discovery is not registered for this provider.";
  const evidence = `NeoPi binary '${source.binary}' (version ${source.probe.version ?? "unknown"})`;
  if (source.probe.status === "unprobed")
    return `${evidence} has not completed a compatible RPC handshake; ${capability} support is not yet known.${source.probe.failure ? ` Last probe failed: ${source.probe.failure}` : " Retry after the provider check completes."}`;
  if (source.probe.status === "unsupported")
    return `${evidence} returned an unsupported RPC handshake. Update NeoPi at this configured executable before using ${capability}.${source.probe.failure ? ` Last refresh failed: ${source.probe.failure}` : ""}`;
  return `${evidence} did not advertise ${capability} in its last compatible handshake. Update NeoPi at this configured executable.${source.probe.failure ? ` Last refresh failed: ${source.probe.failure}` : ""}`;
};
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const sameCwd = (left: string, right: string) =>
  left !== "" &&
  normalizeProjectPathForComparison(left) === normalizeProjectPathForComparison(right);
const operationError = (operation: NeoPiSessionError["operation"]) => (cause: unknown) =>
  isNeoPiSessionError(cause) && cause.operation === operation
    ? cause
    : new NeoPiSessionError({
        operation,
        message: cause instanceof Error ? cause.message : String(cause),
      });

export interface NeoPiSessionCommandInput {
  readonly source: NeoPiSessionCatalogSource;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
}
export type NeoPiSessionCommandRunner = (
  input: NeoPiSessionCommandInput,
) => Effect.Effect<string, NeoPiSessionError>;

/** The runner is injectable so tests never launch a real NeoPi process. */
export const makeNeoPiSessionCatalog = Effect.fn("makeNeoPiSessionCatalog")(function* (
  runCommand?: NeoPiSessionCommandRunner,
) {
  const instances = yield* ProviderInstanceRegistry;
  const settings = yield* ServerSettingsService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const directory = yield* ProviderSessionDirectory;
  const engine = yield* OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;
  const fs = yield* FileSystem.FileSystem;
  const config = yield* ServerConfig;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const historyMutation = yield* Semaphore.make(1);
  const run: NeoPiSessionCommandRunner =
    runCommand ??
    ((input) =>
      Effect.gen(function* () {
        const child = yield* spawner.spawn(
          ChildProcess.make(input.source.binary, input.args, {
            cwd: input.cwd,
            env: input.source.env,
            stdin: "ignore",
          }),
        );
        const [stdout, stderr, code] = yield* Effect.all(
          [
            collectUint8StreamText({ stream: child.stdout, maxBytes: 16 * 1024 * 1024 }),
            collectUint8StreamText({ stream: child.stderr, maxBytes: 64 * 1024 }),
            child.exitCode,
          ],
          { concurrency: "unbounded" },
        );
        if (stdout.truncated || stderr.truncated)
          return yield* new NeoPiSessionError({
            operation: "list",
            message: "NeoPi session output exceeded the safety limit.",
          });
        if (Number(code) !== 0)
          return yield* new NeoPiSessionError({
            operation: "list",
            message: stderr.text || `NeoPi exited ${code}.`,
          });
        return stdout.text;
      }).pipe(
        Effect.timeout("30 seconds"),
        Effect.scoped,
        Effect.mapError(operationError("list")),
      ));

  const resolveProviders = Effect.fn("NeoPiSessionCatalog.resolveProviders")(function* () {
    const enabled = (yield* instances.listInstances).filter(
      (instance) => instance.enabled && instance.driverKind === "neopi",
    );
    const defaults = (yield* settings.getSettings).defaultModelSelection;
    // Default first, then stable settings order: shared paths keep this origin.
    const preferred = enabled.findIndex((entry) => entry.instanceId === defaults?.instanceId);
    if (preferred > 0) enabled.unshift(...enabled.splice(preferred, 1));
    return enabled.flatMap((instance) => {
      const source = neoPiSessionCatalogSource(instance);
      return source?.probe.status !== "unsupported" &&
        source?.capabilities.has(NEOPI_CAPABILITIES.sessionCatalog)
        ? [{ instance, source }]
        : [];
    });
  });

  const readProject = Effect.fn("NeoPiSessionCatalog.readProject")(function* (
    projectId: NeoPiSessionListInput["projectId"],
  ) {
    const project = yield* snapshots.getProjectShellById(projectId);
    if (Option.isNone(project))
      return yield* new NeoPiSessionError({
        operation: "list",
        message: `Project '${projectId}' does not exist.`,
      });
    return project.value;
  });

  const catalog = Effect.fn("NeoPiSessionCatalog.catalog")(function* (
    input: NeoPiSessionListInput,
    source: NeoPiSessionCatalogSource,
  ) {
    const project = yield* readProject(input.projectId);
    const shell = yield* snapshots.getShellSnapshot();
    const bindings = yield* directory.listBindings();
    const dirs = new Set<string>();
    // The historical projectId path component is actually a thread id. Enumerate
    // both two-level roots instead of deriving a nonexistent project directory.
    for (const root of Object.values(resolveNeoPiSessionRoots(config))) {
      const profiles = yield* fs
        .readDirectory(root)
        .pipe(Effect.catchTag("PlatformError", () => Effect.succeed([])));
      for (const profile of profiles) {
        const parent = NodePath.join(root, profile);
        const children = yield* fs
          .readDirectory(parent)
          .pipe(Effect.catchTag("PlatformError", () => Effect.succeed([])));
        for (const child of children) dirs.add(NodePath.join(parent, child));
      }
    }
    for (const binding of bindings) {
      if (binding.provider !== "neopi") continue;
      const cursor = decodeCursor(binding.resumeCursor);
      if (Option.isSome(cursor))
        dirs.add(NodePath.dirname(NodePath.resolve(cursor.value.sessionFile)));
    }
    const args = [
      "sessions",
      "list",
      "--json",
      ...(input.scope === "all" ? ["--all"] : ["--cwd", project.workspaceRoot]),
    ];
    const outputs = [yield* run({ source, args, cwd: project.workspaceRoot })];
    if (dirs.size > 0) {
      outputs.push(
        yield* run({
          source,
          cwd: project.workspaceRoot,
          args: [
            "sessions",
            "list",
            "--json",
            ...Array.from(dirs).flatMap((dir) => ["--session-dir", dir]),
          ],
        }),
      );
    }
    const unique = new Map<string, typeof Session.Type>();
    for (const output of outputs) {
      const decoded = yield* decodeListOutput(output);
      for (const row of decoded.sessions) unique.set(NodePath.resolve(row.path), row);
    }
    const rows = Array.from(unique.values()).sort((left, right) =>
      right.modified.localeCompare(left.modified),
    );
    return { project, shell, bindings, rows };
  });

  const list = Effect.fn("NeoPiSessionCatalog.list")(
    function* (input: NeoPiSessionListInput): Effect.fn.Return<NeoPiSessionListResult, unknown> {
      const providers = yield* resolveProviders();
      if (providers.length === 0) {
        const enabled = (yield* instances.listInstances).filter(
          (instance) => instance.enabled && instance.driverKind === "neopi",
        );
        return {
          status: "unavailable",
          reason:
            enabled.length > 0
              ? enabled
                  .map((instance) =>
                    capabilityUnavailable(
                      neoPiSessionCatalogSource(instance),
                      NEOPI_CAPABILITIES.sessionCatalog,
                    ),
                  )
                  .join("\n")
              : "Enable a NeoPi provider in Settings to discover sessions.",
          diagnostics: enabled.map((instance) => ({
            providerInstanceId: instance.instanceId,
            message: capabilityUnavailable(
              neoPiSessionCatalogSource(instance),
              NEOPI_CAPABILITIES.sessionCatalog,
            ),
          })),
        };
      }
      const unique = new Map<string, NeoPiSessionSummary>();
      const diagnostics: NeoPiSessionDiagnostic[] = [];
      let available = false;
      for (const provider of providers) {
        const result = yield* catalog(input, provider.source).pipe(
          Effect.mapError(operationError("list")),
          Effect.result,
        );
        if (result._tag === "Failure") {
          diagnostics.push({
            providerInstanceId: provider.instance.instanceId,
            message: result.failure.message,
          });
          continue;
        }
        available = true;
        const { shell, bindings, rows } = result.success;
        for (const row of rows) {
          const path = NodePath.resolve(row.path);
          if (unique.has(path)) continue;
          const binding = bindings.find((entry) => {
            if (entry.provider !== "neopi") return false;
            const cursor = decodeCursor(entry.resumeCursor);
            return (
              Option.isSome(cursor) &&
              NodePath.resolve(cursor.value.sessionFile) === NodePath.resolve(row.path)
            );
          });
          const boundThread = binding
            ? shell.threads.find((entry) => entry.id === binding.threadId)
            : undefined;
          const projectId =
            boundThread?.projectId ??
            shell.projects.find((entry) => sameCwd(entry.workspaceRoot, row.cwd))?.id ??
            null;
          if (input.scope !== "all" && projectId !== input.projectId) continue;
          unique.set(path, {
            providerInstanceId: provider.instance.instanceId,
            sessionId: row.id,
            sessionFile: row.path,
            cwd: row.cwd,
            title: boundThread?.title ?? row.title,
            firstMessage: row.firstMessage,
            createdAt: row.created,
            modifiedAt: row.modified,
            messageCount: row.messageCount,
            threadId: binding?.threadId ?? null,
            projectId,
            owner: row.inUse
              ? binding && binding.status !== "stopped"
                ? { kind: "neocode", threadId: binding.threadId }
                : {
                    kind: "process",
                    pid: row.inUse.pid,
                    attachable:
                      row.control !== null &&
                      provider.source.capabilities.has(NEOPI_CAPABILITIES.controlPipe),
                  }
              : { kind: "none" },
          });
        }
      }
      if (!available)
        return {
          status: "unavailable",
          reason: "Could not load sessions from any NeoPi provider. Try Refresh.",
          diagnostics,
        };
      return {
        status: "available",
        diagnostics,
        sessions: Array.from(unique.values()).sort((left, right) =>
          right.modifiedAt.localeCompare(left.modifiedAt),
        ),
      };
    },
    Effect.mapError(operationError("list")),
  );

  const readTranscript = Effect.fn("NeoPiSessionCatalog.readTranscript")(function* (
    source: NeoPiSessionCatalogSource,
    cwd: string,
    sessionFile: string,
    sessionId: string,
    maxMessages?: number,
  ) {
    const transcript = yield* decodeReadOutput(
      yield* run({
        source,
        cwd,
        args: [
          "sessions",
          "read",
          "--json",
          sessionFile,
          ...(maxMessages === undefined ? [] : ["--max-messages", String(maxMessages)]),
        ],
      }),
    ).pipe(
      Effect.mapError(
        () =>
          new NeoPiSessionError({
            operation: "resume",
            message:
              "NeoPi did not return stable native history identities. Update NeoPi for session_history_identity; for a legacy journal, open and continue the session in NeoPi, then retry restoration. No history was imported.",
          }),
      ),
    );
    if (
      transcript.session.id !== sessionId ||
      NodePath.resolve(transcript.session.path) !== NodePath.resolve(sessionFile) ||
      !sameCwd(transcript.session.cwd, cwd) ||
      transcript.leafId !== (transcript.branchEntryIds.at(-1) ?? null) ||
      new Set(transcript.branchEntryIds).size !== transcript.branchEntryIds.length
    )
      return yield* new NeoPiSessionError({
        operation: "resume",
        message:
          "The session identity or selected branch changed while restoring. Refresh session discovery.",
      });
    if (maxMessages === undefined && (transcript.truncated || transcript.branchMessagesTruncated))
      return yield* new NeoPiSessionError({
        operation: "resume",
        message:
          "NeoPi truncated an uncapped native history read. No history was restored; update NeoPi and retry.",
      });
    const ancestry = new Set(transcript.branchEntryIds);
    for (const messages of [transcript.messages, transcript.branchMessages]) {
      const messageIds = new Set<string>();
      for (const message of messages) {
        if (!ancestry.has(message.entryId) || messageIds.has(message.entryId))
          return yield* new NeoPiSessionError({
            operation: "resume",
            message: "NeoPi returned invalid native message identities for the selected branch.",
          });
        messageIds.add(message.entryId);
      }
    }
    return transcript;
  });

  const resume = Effect.fn("NeoPiSessionCatalog.resume")(
    function* (
      input: NeoPiSessionResumeInput,
    ): Effect.fn.Return<NeoPiSessionResumeResult, unknown> {
      const project = yield* readProject(input.projectId);
      const bindings = yield* directory.listBindings();
      const sessionFile = NodePath.resolve(input.sessionFile);
      const existing = bindings.find((entry) => {
        const cursor =
          entry.provider === "neopi" ? decodeCursor(entry.resumeCursor) : Option.none();
        return Option.isSome(cursor) && NodePath.resolve(cursor.value.sessionFile) === sessionFile;
      });
      const providerInstanceId = existing
        ? (existing.providerInstanceId ?? defaultInstanceIdForDriver(existing.provider))
        : input.providerInstanceId;
      const provider = (yield* resolveProviders()).find(
        (entry) => entry.instance.instanceId === providerInstanceId,
      );
      if (!provider) {
        const instance = yield* instances.getInstance(providerInstanceId);
        return yield* new NeoPiSessionError({
          operation: "resume",
          message: instance?.enabled
            ? capabilityUnavailable(
                neoPiSessionCatalogSource(instance),
                NEOPI_CAPABILITIES.sessionCatalog,
              )
            : `NeoPi provider '${providerInstanceId}' is missing or disabled. Enable it in Settings.`,
        });
      }
      // Validate against NeoPi's own listing of that one directory: cheaper than
      // re-listing every project, and still refuses files NeoPi does not recognize.
      const listed = yield* decodeListOutput(
        yield* run({
          source: provider.source,
          cwd: project.workspaceRoot,
          args: ["sessions", "list", "--json", "--session-dir", NodePath.dirname(sessionFile)],
        }),
      );
      const row = listed.sessions.find((entry) => NodePath.resolve(entry.path) === sessionFile);
      if (!row)
        return yield* new NeoPiSessionError({
          operation: "resume",
          message: "This file is not a listed NeoPi session. Refresh session discovery.",
        });
      const threadId =
        existing?.threadId ?? ThreadId.make(`import:${provider.instance.instanceId}:${row.id}`);
      const thread = yield* snapshots.getThreadDetailById(threadId);
      const sessionCwd = Option.isSome(thread)
        ? (thread.value.worktreePath ?? project.workspaceRoot)
        : project.workspaceRoot;
      if (!sameCwd(row.cwd, sessionCwd))
        return yield* new NeoPiSessionError({
          operation: "resume",
          message: `This session belongs to '${row.cwd || "an unknown workspace"}', not '${sessionCwd}'.`,
        });
      if (Option.isSome(thread)) {
        if (thread.value.projectId !== input.projectId)
          return yield* new NeoPiSessionError({
            operation: "resume",
            message: `Thread '${threadId}' belongs to another project.`,
          });
        if (thread.value.deletedAt !== null)
          return yield* new NeoPiSessionError({
            operation: "resume",
            message: "The bound NeoCode thread was deleted.",
          });
        // Selecting a live writer is navigation, not a history replacement.
        if (
          existing?.status !== "stopped" ||
          (thread.value.session !== null && thread.value.session.status !== "stopped") ||
          thread.value.latestTurn?.state === "running"
        )
          return { threadId, created: false };
        if (!provider.source.capabilities.has(NEOPI_CAPABILITIES.sessionHistoryIdentity))
          return yield* new NeoPiSessionError({
            operation: "resume",
            message: capabilityUnavailable(
              provider.source,
              NEOPI_CAPABILITIES.sessionHistoryIdentity,
            ),
          });
        const saved = decodeCursor(existing.resumeCursor);
        if (Option.isNone(saved) || saved.value.sessionId !== row.id)
          return yield* new NeoPiSessionError({
            operation: "resume",
            message:
              "The bound native session identity changed. Refusing to append unrelated history.",
          });
        const transcript = yield* readTranscript(provider.source, sessionCwd, sessionFile, row.id);
        let watermark = saved.value.historyLeafId;
        if (watermark === undefined) {
          // Older GUI cursors know the native user-entry identity, but not the
          // assistant leaf. A clean shutdown BEFORE the next native user is an
          // exact lifetime boundary; unlike text/count matching it cannot eat
          // an identical terminal turn. Never skip the first shutdown marker.
          const boundary = saved.value.turnBoundaries?.at(-1);
          const anchor = boundary?.userEntryId;
          const anchorIndex = anchor === undefined ? -1 : transcript.branchEntryIds.indexOf(anchor);
          const users = new Set(transcript.userEntryIds);
          const exits = new Set(transcript.sessionExitEntryIds);
          const nextUser = transcript.branchEntryIds.findIndex(
            (id, index) => index > anchorIndex && users.has(id),
          );
          const between = transcript.branchEntryIds.slice(
            anchorIndex + 1,
            nextUser < 0 ? undefined : nextUser,
          );
          const exitId = between.find((id) => exits.has(id));
          const exit = transcript.sessionExits?.find((entry) => entry.entryId === exitId);
          if (
            anchorIndex < 0 ||
            !users.has(anchor!) ||
            thread.value.latestTurn?.state !== "completed" ||
            boundary?.turnId !== thread.value.latestTurn.turnId ||
            thread.value.messages.some((message) => message.streaming) ||
            exit === undefined ||
            exit.kind !== "normal" ||
            exit.pendingToolCallCount !== 0 ||
            (exit.lastAssistantStopReason !== "stop" && exit.lastAssistantStopReason !== "length")
          )
            return yield* new NeoPiSessionError({
              operation: "resume",
              message: `This older NeoCode cursor has no native history watermark, and no clean native shutdown can prove the end of its last completed GUI turn before the next native user. No history was changed. Continue safely in NeoPi with --session ${shellQuote(sessionFile)}.`,
            });
          watermark = exit.entryId;
        }
        const position = watermark === null ? -1 : transcript.branchEntryIds.indexOf(watermark);
        if (watermark !== null && position < 0)
          return yield* new NeoPiSessionError({
            operation: "resume",
            message:
              "The native session branch diverged from NeoCode's saved history watermark. Refusing to merge unrelated branches.",
          });
        const deltaIds = new Set(transcript.branchEntryIds.slice(position + 1));
        const delta = transcript.branchMessages.filter((message) => deltaIds.has(message.entryId));
        for (let offset = 0; offset < delta.length; offset += 200) {
          const batch = delta.slice(offset, offset + 200);
          yield* engine.dispatch({
            type: "thread.history.append",
            commandId: CommandId.make(
              `neopi-restore:${threadId}:${transcript.leafId}:${batch[0]!.entryId}`,
            ),
            threadId,
            messages: batch.map((message) => ({
              messageId: MessageId.make(`${threadId}:native:${message.entryId}`),
              role: message.role,
              text: message.text,
              createdAt: message.timestamp,
            })),
          });
        }
        yield* directory.upsert(
          {
            ...existing,
            resumeCursor: {
              ...(typeof existing.resumeCursor === "object" && existing.resumeCursor !== null
                ? existing.resumeCursor
                : {}),
              historyLeafId: transcript.leafId,
            },
          },
          { onlyUpdateStoppedCursor: true },
        );
        return { threadId, created: false };
      }
      if (!provider.source.capabilities.has(NEOPI_CAPABILITIES.sessionHistoryIdentity))
        return yield* new NeoPiSessionError({
          operation: "resume",
          message: capabilityUnavailable(
            provider.source,
            NEOPI_CAPABILITIES.sessionHistoryIdentity,
          ),
        });
      const transcript = yield* readTranscript(
        provider.source,
        project.workspaceRoot,
        sessionFile,
        row.id,
        200,
      );
      yield* directory.upsert(
        {
          threadId,
          provider: provider.instance.driverKind,
          providerInstanceId: provider.instance.instanceId,
          status: "stopped",
          runtimeMode: DEFAULT_RUNTIME_MODE,
          resumeCursor: {
            v: 1,
            sessionFile,
            sessionId: row.id,
            sessionDir: NodePath.dirname(sessionFile),
            sharedSession: true,
            turnBoundaries: [],
          },
          runtimePayload: { cwd: project.workspaceRoot },
        },
        { onConflict: "ignore" },
      );
      const snapshot = yield* provider.instance.snapshot.getSnapshot;
      const model =
        snapshot.models.find((entry) => entry.isDefault)?.slug ??
        DEFAULT_MODEL_BY_PROVIDER[provider.instance.driverKind] ??
        DEFAULT_MODEL;
      yield* engine.dispatch({
        type: "thread.create",
        commandId: CommandId.make(`neopi-import:${threadId}:create`),
        threadId,
        projectId: input.projectId,
        title: row.title?.trim() || row.firstMessage.slice(0, 120) || "NeoPi session",
        modelSelection: { instanceId: provider.instance.instanceId, model },
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        createdAt: row.created,
        historyImport: true,
      });
      if (transcript.messages.length > 0)
        yield* engine.dispatch({
          type: "thread.history.import",
          commandId: CommandId.make(`neopi-import:${threadId}:history`),
          threadId,
          messages: transcript.messages.map((message) => ({
            messageId: MessageId.make(`${threadId}:native:${message.entryId}`),
            role: message.role,
            text: message.text,
            createdAt: message.timestamp,
          })),
        });
      const importedBinding = yield* directory.getBinding(threadId);
      if (Option.isSome(importedBinding))
        yield* directory.upsert(
          {
            ...importedBinding.value,
            resumeCursor: {
              ...(typeof importedBinding.value.resumeCursor === "object" &&
              importedBinding.value.resumeCursor !== null
                ? importedBinding.value.resumeCursor
                : {}),
              historyLeafId: transcript.leafId,
            },
          },
          { onlyUpdateStoppedCursor: true },
        );
      return { threadId, created: true };
    },
    historyMutation.withPermits(1),
    Effect.mapError(operationError("resume")),
  );

  const handoff = Effect.fn("NeoPiSessionCatalog.handoff")(
    function* (
      input: NeoPiSessionHandoffInput,
    ): Effect.fn.Return<NeoPiSessionHandoffResult, unknown> {
      const binding = yield* directory.getBinding(input.threadId);
      const thread = yield* snapshots.getThreadDetailById(input.threadId);
      if (Option.isNone(binding) || binding.value.provider !== "neopi" || Option.isNone(thread))
        return yield* new NeoPiSessionError({
          operation: "handoff",
          message: "This thread has no resumable NeoPi session.",
        });
      const cursor = decodeCursor(binding.value.resumeCursor);
      if (Option.isNone(cursor))
        return yield* new NeoPiSessionError({
          operation: "handoff",
          message: "This NeoPi thread has no saved session cursor yet.",
        });
      const instance = binding.value.providerInstanceId
        ? yield* instances.getInstance(binding.value.providerInstanceId)
        : undefined;
      const source = instance ? neoPiSessionCatalogSource(instance) : undefined;
      if (!source)
        return yield* new NeoPiSessionError({
          operation: "handoff",
          message: "The NeoPi provider instance for this thread is unavailable.",
        });
      for (const capability of [
        NEOPI_CAPABILITIES.sessionCatalog,
        NEOPI_CAPABILITIES.sessionHistoryIdentity,
      ]) {
        if (source.probe.status === "unsupported" || !source.capabilities.has(capability))
          return yield* new NeoPiSessionError({
            operation: "handoff",
            message: capabilityUnavailable(source, capability),
          });
      }
      const project = yield* readProject(thread.value.projectId);
      const cwd = thread.value.worktreePath ?? project.workspaceRoot;
      // Subscribe before dispatch: dispatch persists intent, not process shutdown.
      yield* Effect.gen(function* () {
        const events = yield* engine.subscribeDomainEvents;
        yield* engine.dispatch({
          type: "thread.session.stop",
          commandId: CommandId.make(yield* crypto.randomUUIDv4),
          threadId: input.threadId,
          createdAt: DateTime.formatIso(yield* DateTime.now),
        });
        if (thread.value.session && thread.value.session.status !== "stopped") {
          const stopped = yield* events.pipe(
            Stream.filter(
              (event) =>
                event.type === "thread.session-set" &&
                event.payload.threadId === input.threadId &&
                event.payload.session.status === "stopped",
            ),
            Stream.runHead,
            Effect.timeout("30 seconds"),
          );
          if (Option.isNone(stopped))
            return yield* new NeoPiSessionError({
              operation: "handoff",
              message: "NeoPi session stop was not acknowledged. Try handing off again.",
            });
        }
      }).pipe(Effect.scoped);
      const { sessionFile, sessionId } = cursor.value;
      // A stopped control connection only detached: its terminal owner still
      // holds the native lease. Never offer a command that cannot acquire it.
      const listed = yield* decodeListOutput(
        yield* run({
          source,
          cwd,
          args: [
            "sessions",
            "list",
            "--json",
            "--session-dir",
            NodePath.dirname(NodePath.resolve(sessionFile)),
          ],
        }),
      );
      const owner = listed.sessions.find(
        (row) => NodePath.resolve(row.path) === NodePath.resolve(sessionFile),
      )?.inUse;
      if (owner)
        return yield* new NeoPiSessionError({
          operation: "handoff",
          message: `This session is still open in the terminal process (PID ${owner.pid}). NeoCode merely detached; close the session in that terminal before resuming it elsewhere.`,
        });
      const transcript = yield* readTranscript(source, cwd, sessionFile, sessionId, 0);
      const current = yield* directory.getBinding(input.threadId);
      if (Option.isNone(current) || current.value.status !== "stopped")
        return yield* new NeoPiSessionError({
          operation: "handoff",
          message: "The NeoPi writer restarted during handoff. Stop it before handing off again.",
        });
      const saved = decodeCursor(current.value.resumeCursor);
      if (
        Option.isNone(saved) ||
        saved.value.sessionId !== sessionId ||
        NodePath.resolve(saved.value.sessionFile) !== NodePath.resolve(sessionFile)
      )
        return yield* new NeoPiSessionError({
          operation: "handoff",
          message:
            "The native session changed during handoff. Refresh the thread before continuing.",
        });
      const wasRunning =
        binding.value.status !== "stopped" ||
        (thread.value.session !== null && thread.value.session.status !== "stopped");
      if (!wasRunning && saved.value.historyLeafId !== transcript.leafId)
        return yield* new NeoPiSessionError({
          operation: "handoff",
          message:
            "This stopped thread has unverified native history. Restore it in NeoCode before handing it off; older cursors without a native watermark require NeoPi.",
        });
      yield* directory.upsert(
        {
          ...current.value,
          resumeCursor: {
            ...(typeof current.value.resumeCursor === "object" &&
            current.value.resumeCursor !== null
              ? current.value.resumeCursor
              : {}),
            historyLeafId: transcript.leafId,
          },
        },
        { onlyUpdateStoppedCursor: true },
      );
      const profile = source.env.OMP_PROFILE;
      const command = `cd ${shellQuote(cwd)} && ${profile ? `OMP_PROFILE=${shellQuote(profile)} ` : ""}${shellQuote(source.binary)} --session ${shellQuote(sessionFile)}`;
      return { sessionFile, sessionId, cwd, command };
    },
    historyMutation.withPermits(1),
    Effect.mapError(operationError("handoff")),
  );

  const configurationBindingChange = Effect.fnUntraced(function* (
    binding: ProviderRuntimeBinding,
    expected: NeoPiConfigurationIdentity,
    instance: ProviderInstance,
  ) {
    const current = yield* directory.getBinding(binding.threadId);
    if (
      Option.isNone(current) ||
      current.value.provider !== "neopi" ||
      current.value.status !== "running" ||
      current.value.providerInstanceId !== instance.instanceId ||
      current.value.adapterKey !== binding.adapterKey ||
      (yield* instances.getInstance(instance.instanceId)) !== instance
    )
      return "The bound NeoPi connection changed during the snapshot.";
    const cursor = decodeCursor(current.value.resumeCursor);
    if (
      Option.isNone(cursor) ||
      cursor.value.sessionId !== expected.sessionId ||
      NodePath.resolve(cursor.value.sessionFile) !== NodePath.resolve(expected.sessionFile)
    )
      return "The bound native NeoPi session changed during the snapshot.";
  });

  const configuration = Effect.fn("NeoPiSessionCatalog.configuration")(
    function* (
      input: NeoPiSessionConfigurationInput,
    ): Effect.fn.Return<NeoPiSessionConfigurationResult, unknown> {
      const unavailable = (reason: string) => ({ status: "unavailable" as const, reason });
      const binding = yield* directory.getBinding(input.threadId);
      if (Option.isNone(binding) || binding.value.provider !== "neopi")
        return unavailable("This thread has no bound NeoPi session.");
      if (binding.value.status !== "running")
        return unavailable("This thread's NeoPi session is not connected.");
      const cursor = decodeCursor(binding.value.resumeCursor);
      if (Option.isNone(cursor) || !cursor.value.sessionId || !cursor.value.sessionFile)
        return unavailable("This thread has no saved native NeoPi session identity.");
      const instance = binding.value.providerInstanceId
        ? yield* instances.getInstance(binding.value.providerInstanceId)
        : undefined;
      if (!instance || instance.driverKind !== "neopi")
        return unavailable("The bound NeoPi provider instance is unavailable.");
      const source = neoPiSessionCatalogSource(instance);
      if (!source?.configuration)
        return unavailable("The bound NeoPi provider has no connected configuration reader.");
      const result = yield* source.configuration(input.threadId, cursor.value);
      if (
        result.status === "available" &&
        (result.providerInstanceId !== instance.instanceId ||
          result.sessionId !== cursor.value.sessionId)
      )
        return unavailable("The NeoPi reader returned a different bound session.");
      const changed = yield* configurationBindingChange(binding.value, cursor.value, instance);
      if (changed) return unavailable(changed);
      return result;
    },
    Effect.mapError(operationError("configuration")),
  );

  const watchConfiguration = (input: NeoPiSessionConfigurationInput) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const unavailable = (reason: string) => ({ status: "unavailable" as const, reason });
        // Acquire every notification source before reading the binding or native
        // snapshot. A notification during a read leaves one pending refresh.
        const registryChanges = yield* instances.subscribeChanges;
        const domainEvents = yield* engine.subscribeDomainEvents;
        const pending = yield* Queue.sliding<void>(1);
        let refresh = true;
        const invalidate = (read: boolean) =>
          Effect.suspend(() => {
            refresh ||= read;
            return Queue.offer(pending, undefined);
          });
        yield* Effect.forever(
          PubSub.take(registryChanges).pipe(Effect.andThen(invalidate(false))),
        ).pipe(Effect.forkScoped);
        yield* domainEvents.pipe(
          Stream.filter(
            (event) =>
              event.aggregateId === input.threadId &&
              (event.type === "thread.session-set" || event.type === "thread.reverted"),
          ),
          Stream.runForEach(() => invalidate(false)),
          Effect.forkScoped,
        );
        const binding = yield* directory.getBinding(input.threadId);
        if (Option.isNone(binding) || binding.value.provider !== "neopi")
          return Stream.succeed(unavailable("This thread has no bound NeoPi session."));
        if (binding.value.status !== "running")
          return Stream.succeed(unavailable("This thread's NeoPi session is not connected."));
        const cursor = decodeCursor(binding.value.resumeCursor);
        if (Option.isNone(cursor) || !cursor.value.sessionId || !cursor.value.sessionFile)
          return Stream.succeed(
            unavailable("This thread has no saved native NeoPi session identity."),
          );
        const instance = binding.value.providerInstanceId
          ? yield* instances.getInstance(binding.value.providerInstanceId)
          : undefined;
        const source = instance && neoPiSessionCatalogSource(instance);
        if (!instance || instance.driverKind !== "neopi" || !source?.observeConfiguration)
          return Stream.succeed(
            unavailable("The bound NeoPi configuration observer is unavailable."),
          );
        const observation = yield* source.observeConfiguration(input.threadId, cursor.value);
        const changed = configurationBindingChange(binding.value, cursor.value, instance);
        yield* observation.changes.pipe(
          Stream.runForEach(() => invalidate(true)),
          Effect.forkScoped,
        );
        yield* Queue.offer(pending, undefined);
        return Stream.fromQueue(pending).pipe(
          Stream.mapEffect(() =>
            Effect.gen(function* () {
              const read = refresh;
              refresh = false;
              if (yield* changed)
                return Option.some(
                  unavailable("The observed NeoPi binding changed. Start following again."),
                );
              if (!read) return Option.none();
              const result = yield* observation.read;
              if (yield* changed)
                return Option.some(
                  unavailable("The observed NeoPi binding changed during the snapshot."),
                );
              if (
                result.status === "available" &&
                (result.providerInstanceId !== instance.instanceId ||
                  result.sessionId !== cursor.value.sessionId)
              )
                return Option.some(
                  unavailable("The NeoPi reader returned a different bound session."),
                );
              return Option.some(result);
            }),
          ),
          Stream.filter(Option.isSome),
          Stream.map((result) => result.value),
          Stream.takeUntil((result) => result.status === "unavailable"),
        );
      }),
    ).pipe(Stream.mapError(operationError("configuration")));

  return { list, resume, handoff, configuration, watchConfiguration };
});
