import * as Schema from "effect/Schema";
import { IsoDateTime, NonNegativeInt, ProjectId, ThreadId } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const NeoPiSessionScope = Schema.Literals(["project", "all"]);
export type NeoPiSessionScope = typeof NeoPiSessionScope.Type;
export const NeoPiSessionListInput = Schema.Struct({
  projectId: ProjectId,
  scope: NeoPiSessionScope,
});
export type NeoPiSessionListInput = typeof NeoPiSessionListInput.Type;
export const NeoPiSessionOwner = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({ kind: Schema.Literal("neocode"), threadId: ThreadId }),
  Schema.Struct({
    kind: Schema.Literal("process"),
    pid: NonNegativeInt,
    attachable: Schema.Boolean,
  }),
]);
export type NeoPiSessionOwner = typeof NeoPiSessionOwner.Type;
export const NeoPiSessionSummary = Schema.Struct({
  providerInstanceId: ProviderInstanceId,
  sessionId: Schema.String,
  sessionFile: Schema.String,
  cwd: Schema.String,
  title: Schema.NullOr(Schema.String),
  firstMessage: Schema.String,
  createdAt: IsoDateTime,
  modifiedAt: IsoDateTime,
  messageCount: NonNegativeInt,
  owner: NeoPiSessionOwner,
  threadId: Schema.NullOr(ThreadId),
  projectId: Schema.NullOr(ProjectId),
});
export type NeoPiSessionSummary = typeof NeoPiSessionSummary.Type;
export const NeoPiSessionListResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    sessions: Schema.Array(NeoPiSessionSummary),
  }),
  Schema.Struct({ status: Schema.Literal("unavailable"), reason: Schema.String }),
]);
export type NeoPiSessionListResult = typeof NeoPiSessionListResult.Type;
export const NeoPiSessionResumeInput = Schema.Struct({
  providerInstanceId: ProviderInstanceId,
  sessionFile: Schema.String,
  projectId: ProjectId,
});
export type NeoPiSessionResumeInput = typeof NeoPiSessionResumeInput.Type;
export const NeoPiSessionResumeResult = Schema.Struct({
  threadId: ThreadId,
  created: Schema.Boolean,
});
export type NeoPiSessionResumeResult = typeof NeoPiSessionResumeResult.Type;
export const NeoPiSessionHandoffInput = Schema.Struct({ threadId: ThreadId });
export type NeoPiSessionHandoffInput = typeof NeoPiSessionHandoffInput.Type;
export const NeoPiSessionHandoffResult = Schema.Struct({
  sessionFile: Schema.String,
  sessionId: Schema.String,
  cwd: Schema.String,
  command: Schema.String,
});
export type NeoPiSessionHandoffResult = typeof NeoPiSessionHandoffResult.Type;
export class NeoPiSessionError extends Schema.TaggedError<NeoPiSessionError>()(
  "NeoPiSessionError",
  {
    operation: Schema.Literals(["list", "resume", "handoff"]),
    message: Schema.String,
  },
) {}
