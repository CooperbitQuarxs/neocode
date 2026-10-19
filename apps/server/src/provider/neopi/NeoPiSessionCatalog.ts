// @effect-diagnostics nodeBuiltinImport:off -- NeoPi CLI identities are absolute filesystem paths.
import * as NodePath from "node:path";
import {
  CommandId,
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  IsoDateTime,
  MessageId,
  NeoPiSessionError,
  NonNegativeInt,
  ThreadId,
  type NeoPiSessionListInput,
  type NeoPiSessionListResult,
  type NeoPiSessionSummary,
  type NeoPiSessionResumeInput,
  type NeoPiSessionResumeResult,
  type NeoPiSessionHandoffInput,
  type NeoPiSessionHandoffResult,
} from "@t3tools/contracts";
import { normalizeProjectPathForComparison } from "@t3tools/shared/path";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { ServerConfig } from "../../config.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { collectUint8StreamText } from "../../stream/collectUint8StreamText.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderInstanceRegistry } from "../Services/ProviderInstanceRegistry.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
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
const ReadOutput = Schema.Struct({
  version: Schema.Literal(1),
  session: Schema.Struct({
    path: Schema.String,
    id: Schema.String,
    cwd: Schema.String,
    title: Schema.NullOr(Schema.String),
  }),
  messages: Schema.Array(
    Schema.Struct({
      role: Schema.Literals(["user", "assistant"]),
      text: Schema.String,
      timestamp: IsoDateTime,
    }),
  ),
  truncated: Schema.Boolean,
});
const Cursor = Schema.Struct({ sessionFile: Schema.String, sessionId: Schema.String });
const decodeCursor = Schema.decodeUnknownOption(Cursor);
const decodeListOutput = Schema.decodeEffect(Schema.fromJsonString(ListOutput));
const decodeReadOutput = Schema.decodeEffect(Schema.fromJsonString(ReadOutput));
const isNeoPiSessionError = Schema.is(NeoPiSessionError);
const missingCapability =
  "Update NeoPi: this npi does not support session discovery (needs session_catalog).";
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

  const resolveProvider = Effect.fn("NeoPiSessionCatalog.resolveProvider")(function* () {
    const enabled = (yield* instances.listInstances).filter(
      (instance) => instance.enabled && instance.driverKind === "neopi",
    );
    const defaults = (yield* settings.getSettings).defaultModelSelection;
    // Use the configured default when it is NeoPi, otherwise stable settings order.
    const instance =
      enabled.find((entry) => entry.instanceId === defaults?.instanceId) ?? enabled[0];
    if (!instance) return null;
    const source = neoPiSessionCatalogSource(instance);
    if (!source || !source.capabilities.has(NEOPI_CAPABILITIES.sessionCatalog)) return null;
    return { instance, source };
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
    const rows = Array.from(unique.values())
      .filter((row) => input.scope === "all" || sameCwd(row.cwd, project.workspaceRoot))
      .sort((left, right) => right.modified.localeCompare(left.modified));
    return { project, shell, bindings, rows };
  });

  const list = Effect.fn("NeoPiSessionCatalog.list")(
    function* (input: NeoPiSessionListInput): Effect.fn.Return<NeoPiSessionListResult, unknown> {
      const provider = yield* resolveProvider();
      if (!provider) {
        const hasInstance = (yield* instances.listInstances).some(
          (instance) => instance.enabled && instance.driverKind === "neopi",
        );
        return {
          status: "unavailable",
          reason: hasInstance
            ? missingCapability
            : "Enable a NeoPi provider in Settings to discover sessions.",
        };
      }
      const { shell, bindings, rows } = yield* catalog(input, provider.source);
      const sessions: NeoPiSessionSummary[] = rows.map((row) => {
        const binding = bindings.find((entry) => {
          if (entry.provider !== "neopi") return false;
          const cursor = decodeCursor(entry.resumeCursor);
          return (
            Option.isSome(cursor) &&
            NodePath.resolve(cursor.value.sessionFile) === NodePath.resolve(row.path)
          );
        });
        return {
          sessionId: row.id,
          sessionFile: row.path,
          cwd: row.cwd,
          title: row.title,
          firstMessage: row.firstMessage,
          createdAt: row.created,
          modifiedAt: row.modified,
          messageCount: row.messageCount,
          threadId: binding?.threadId ?? null,
          projectId:
            shell.projects.find((entry) => sameCwd(entry.workspaceRoot, row.cwd))?.id ?? null,
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
        };
      });
      return { status: "available", sessions };
    },
    Effect.mapError(operationError("list")),
  );

  const resume = Effect.fn("NeoPiSessionCatalog.resume")(
    function* (
      input: NeoPiSessionResumeInput,
    ): Effect.fn.Return<NeoPiSessionResumeResult, unknown> {
      const provider = yield* resolveProvider();
      if (!provider)
        return yield* new NeoPiSessionError({ operation: "resume", message: missingCapability });
      const project = yield* readProject(input.projectId);
      const bindings = yield* directory.listBindings();
      const sessionFile = NodePath.resolve(input.sessionFile);
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
      if (!sameCwd(row.cwd, project.workspaceRoot))
        return yield* new NeoPiSessionError({
          operation: "resume",
          message: `This session belongs to '${row.cwd || "an unknown workspace"}', not '${project.workspaceRoot}'.`,
        });
      const existing = bindings.find((entry) => {
        const cursor =
          entry.provider === "neopi" ? decodeCursor(entry.resumeCursor) : Option.none();
        return Option.isSome(cursor) && NodePath.resolve(cursor.value.sessionFile) === sessionFile;
      });
      const threadId =
        existing?.threadId ?? ThreadId.make(`import:${provider.instance.instanceId}:${row.id}`);
      const thread = yield* snapshots.getThreadDetailById(threadId);
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
        return { threadId, created: false };
      }
      const text = yield* run({
        source: provider.source,
        cwd: project.workspaceRoot,
        args: ["sessions", "read", "--json", sessionFile, "--max-messages", "200"],
      });
      const transcript = yield* decodeReadOutput(text);
      if (
        transcript.session.id !== row.id ||
        NodePath.resolve(transcript.session.path) !== sessionFile ||
        !sameCwd(transcript.session.cwd, project.workspaceRoot)
      ) {
        return yield* new NeoPiSessionError({
          operation: "resume",
          message: "The session identity changed while importing. Refresh session discovery.",
        });
      }
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
          messages: transcript.messages.map((message, index) => ({
            messageId: MessageId.make(`${threadId}:${String(index).padStart(6, "0")}`),
            role: message.role,
            text: message.text,
            createdAt: message.timestamp,
          })),
        });
      return { threadId, created: true };
    },
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
      const profile = source.env.OMP_PROFILE;
      const command = `cd ${shellQuote(cwd)} && ${profile ? `OMP_PROFILE=${shellQuote(profile)} ` : ""}${shellQuote(source.binary)} --session ${shellQuote(sessionFile)}`;
      return { sessionFile, sessionId, cwd, command };
    },
    Effect.mapError(operationError("handoff")),
  );

  return { list, resume, handoff };
});
