import { describe, expect, it } from "@effect/vitest";
import {
  ProviderInstanceId,
  type NeoPiJournalEntry,
  type NeoPiJournalPage,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  emptyNativeSessionFeed,
  reduceNativeSessionFeed,
  type NativeSession,
  type NativeSessionFeed,
  type NativeSessionUpdate,
} from "../neopiNativeSessions.ts";
import { reconcileNativeSessionFeed } from "./neopiNativeSessions.ts";

class StateReadError extends Schema.TaggedError<StateReadError>()("StateReadError", {
  message: Schema.String,
}) {}

const ref = {
  providerInstanceId: ProviderInstanceId.make("neopi"),
  sessionFile: "/sessions/feed.jsonl",
};
const session: NativeSession = {
  ref,
  sessionId: "session",
  cwd: "/workspace",
  attachment: "terminal",
  capabilities: [],
  state: {},
};
const user: NeoPiJournalEntry = {
  id: "user",
  parentId: null,
  timestamp: "2026-10-28T00:00:00Z",
  type: "message",
  message: { role: "user", content: "Question" },
};
const identity = (leafId: string | null) => ({
  sessionId: session.sessionId,
  sessionFile: ref.sessionFile,
  leafId,
});
const page = (entries: readonly NeoPiJournalEntry[]): NeoPiJournalPage => ({
  ...identity(entries.at(-1)?.id ?? null),
  entries,
  totalEntries: entries.length,
});
const initial = (busy = false, entries: readonly NeoPiJournalEntry[] = [user]) =>
  reduceNativeSessionFeed(emptyNativeSessionFeed(), {
    type: "snapshot",
    session: { ...session, state: { isStreaming: busy } },
    journal: page(entries),
  });
const event = (frame: Record<string, unknown> & { type: string }): NativeSessionUpdate => ({
  type: "event",
  frame,
});
const nextFeed = (
  feeds: Queue.Queue<NativeSessionFeed>,
  predicate: (feed: NativeSessionFeed) => boolean,
) =>
  Stream.fromQueue(feeds).pipe(
    Stream.filter(predicate),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );
const harness = <E, R>(
  read: (command: Record<string, unknown> & { type: string }) => Effect.Effect<unknown, E, R>,
  seed = initial(),
) =>
  Effect.gen(function* () {
    const events = yield* Queue.unbounded<NativeSessionUpdate>();
    const feeds = yield* Queue.unbounded<NativeSessionFeed>();
    yield* reconcileNativeSessionFeed(
      Stream.fromQueue(events).pipe(Stream.takeUntil((update) => update.type === "closed")),
      read,
      seed,
      () => {},
    ).pipe(
      Stream.runForEach((feed) => Queue.offer(feeds, feed)),
      Effect.forkScoped,
    );
    return { events, feeds };
  });

describe("native feed reconciliation lifetime", () => {
  it.effect(
    "delivers raw updates while get_state is blocked and coalesces subsequent state reads",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const release = yield* Deferred.make<void>();
          const calls = yield* Queue.unbounded<number>();
          let count = 0;
          const read = Effect.gen(function* () {
            const call = ++count;
            yield* Queue.offer(calls, call);
            yield* Deferred.await(release);
            return { model: { id: `model-${call}` } };
          });
          const { events, feeds } = yield* harness(() => read, initial(true));
          yield* Queue.offer(events, event({ type: "model_changed" }));
          expect(yield* Queue.take(calls)).toBe(1);
          yield* Queue.offerAll(events, [
            event({ type: "thinking_level_changed" }),
            event({ type: "mode_changed" }),
            event({ type: "models_configuration_changed" }),
            event({
              type: "message_update",
              messageId: "live",
              message: { role: "assistant", content: "Visible before state reply" },
            }),
          ]);
          const streaming = yield* nextFeed(
            feeds,
            (feed) =>
              feed.conversation.pending[0]?.message.content === "Visible before state reply",
          );
          expect(streaming.conversation.entries).toEqual([user]);
          expect(streaming.conversation.pending).toEqual([
            {
              messageId: "live",
              message: { role: "assistant", content: "Visible before state reply" },
            },
          ]);
          yield* Deferred.succeed(release, undefined);
          expect(yield* Queue.take(calls)).toBe(2);
          const refreshed = yield* nextFeed(
            feeds,
            (feed) => (feed.session?.state.model as { id?: string } | undefined)?.id === "model-2",
          );
          expect(refreshed.conversation.pending).toEqual(streaming.conversation.pending);
          expect(count).toBe(2);
        }),
      ),
  );

  it.effect(
    "keeps a failed state read nonfatal and clears its error on a successful reconciliation",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          let calls = 0;
          const { events, feeds } = yield* harness(() =>
            Effect.suspend(() =>
              ++calls === 1
                ? Effect.fail(new StateReadError({ message: "State temporarily unavailable" }))
                : Effect.succeed({ model: { id: "recovered" } }),
            ),
          );
          yield* Queue.offer(events, event({ type: "model_changed" }));
          const failed = yield* nextFeed(
            feeds,
            (feed) => feed.error === "State temporarily unavailable",
          );
          expect(failed.conversation.entries).toEqual([user]);
          yield* Queue.offer(
            events,
            event({
              type: "message_update",
              messageId: "live",
              message: { role: "assistant", content: "Continues after failure" },
            }),
          );
          const live = yield* nextFeed(
            feeds,
            (feed) => feed.conversation.pending[0]?.message.content === "Continues after failure",
          );
          expect(live.connected).toBe(true);
          expect(live.error).toBe("State temporarily unavailable");
          yield* Queue.offer(events, event({ type: "prompt_result", status: "success" }));
          const recovered = yield* nextFeed(
            feeds,
            (feed) =>
              feed.error === null &&
              (feed.session?.state.model as { id?: string } | undefined)?.id === "recovered",
          );
          expect(recovered.conversation.pending).toEqual(live.conversation.pending);
          expect(recovered.reconciliationError).toBeNull();
        }),
      ),
  );

  it.effect("does not resnapshot ordinary active appends or their settlement", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const reads: string[] = [];
        const { events, feeds } = yield* harness(
          (command) =>
            Effect.sync(() => {
              reads.push(command.type);
              return {};
            }),
          initial(true),
        );
        const reply = {
          ...user,
          id: "reply",
          parentId: user.id,
          message: { role: "assistant", content: "Durable reply" },
        };
        yield* Queue.offerAll(events, [
          event({ type: "journal_state", reason: "leaf", ...identity(reply.id) }),
          event({ type: "journal_entry", ...identity(reply.id), entry: reply }),
          event({ type: "agent_end" }),
        ]);
        const settled = yield* nextFeed(
          feeds,
          (feed) => !feed.busy && feed.conversation.entries.at(-1)?.id === reply.id,
        );
        expect(settled.conversation.entries).toEqual([user, reply]);
        expect(settled.conversation.needsSnapshot).toBe(false);
        expect(reads).toEqual([]);
      }),
    ),
  );

  it.effect("hydrates an unknown idle branch without blanking the cached transcript", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const old = {
          ...user,
          id: "old",
          parentId: user.id,
          message: { role: "assistant", content: "Old branch" },
        };
        const branch = {
          ...user,
          id: "branch",
          parentId: user.id,
          message: { role: "assistant", content: "Native branch" },
        };
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<NeoPiJournalPage>();
        const { events, feeds } = yield* harness(
          () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(started, undefined);
              return yield* Deferred.await(release);
            }),
          initial(false, [user, old]),
        );
        yield* Queue.offer(
          events,
          event({ type: "journal_state", reason: "leaf", ...identity(branch.id) }),
        );
        yield* Deferred.await(started);
        const hydrating = yield* nextFeed(feeds, (feed) => feed.conversation.needsSnapshot);
        expect(hydrating.conversation.entries).toEqual([user, old]);
        yield* Deferred.succeed(release, { ...page([user, branch]), nextCursor: "branch-cursor" });
        const hydrated = yield* nextFeed(feeds, (feed) => !feed.conversation.needsSnapshot);
        expect(hydrated.conversation.entries).toEqual([user, branch]);
        expect(hydrated.conversation.cursor).toBe("branch-cursor");
        expect(hydrated.conversation.cursorLeaf).toBe(branch.id);
      }),
    ),
  );

  it.effect("hydrates a known ancestor move even if the previous stream was busy", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const old = { ...user, id: "old", parentId: user.id };
        const { events, feeds } = yield* harness(
          () => Effect.succeed(page([user])),
          initial(true, [user, old]),
        );
        yield* Queue.offer(
          events,
          event({ type: "journal_state", reason: "leaf", ...identity(user.id) }),
        );
        const moved = yield* nextFeed(
          feeds,
          (feed) =>
            !feed.conversation.needsSnapshot && feed.conversation.entries.at(-1)?.id === user.id,
        );
        expect(moved.conversation.entries).toEqual([user]);
        expect(moved.conversation.identity?.leafId).toBe(user.id);
      }),
    ),
  );

  it.effect("does not roll newer durable appends back when an older branch read completes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const first = { ...user, id: "first", parentId: user.id };
        const latest = { ...user, id: "latest", parentId: first.id };
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<NeoPiJournalPage>();
        const { events, feeds } = yield* harness(() =>
          Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined);
            return yield* Deferred.await(release);
          }),
        );
        yield* Queue.offer(
          events,
          event({ type: "journal_state", reason: "leaf", ...identity(first.id) }),
        );
        yield* Deferred.await(started);
        yield* Queue.offerAll(events, [
          event({ type: "journal_entry", ...identity(first.id), entry: first }),
          event({ type: "journal_state", reason: "leaf", ...identity(latest.id) }),
          event({ type: "journal_entry", ...identity(latest.id), entry: latest }),
          event({ type: "agent_start" }),
        ]);
        const durable = yield* nextFeed(feeds, (feed) => feed.busy);
        expect(durable.conversation.entries).toEqual([user, first, latest]);
        yield* Deferred.succeed(release, { ...page([user, first]), nextCursor: "stale-cursor" });
        const afterReply = yield* Queue.take(feeds);
        expect(afterReply.conversation).toBe(durable.conversation);
        expect(afterReply.conversation.identity?.leafId).toBe(latest.id);
        expect(afterReply.conversation.cursor).not.toBe("stale-cursor");
      }),
    ),
  );

  it.effect(
    "hydrates divergent durable ancestry during a stream and retains messages received while reading",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const old = { ...user, id: "old", parentId: user.id };
          const branch = { ...user, id: "branch", parentId: user.id };
          const started = yield* Deferred.make<void>();
          const release = yield* Deferred.make<NeoPiJournalPage>();
          const { events, feeds } = yield* harness(
            () =>
              Effect.gen(function* () {
                yield* Deferred.succeed(started, undefined);
                return yield* Deferred.await(release);
              }),
            initial(true, [user, old]),
          );
          yield* Queue.offerAll(events, [
            event({ type: "journal_state", reason: "leaf", ...identity(branch.id) }),
            event({ type: "journal_entry", ...identity(branch.id), entry: branch }),
          ]);
          yield* Deferred.await(started);
          yield* Queue.offer(
            events,
            event({
              type: "message_update",
              messageId: "branch-live",
              message: { role: "assistant", content: "Branch stream" },
            }),
          );
          const streaming = yield* nextFeed(
            feeds,
            (feed) => feed.conversation.pending[0]?.message.content === "Branch stream",
          );
          expect(streaming.conversation.entries).toEqual([user, old]);
          yield* Deferred.succeed(release, page([user, branch]));
          const hydrated = yield* nextFeed(feeds, (feed) => !feed.conversation.needsSnapshot);
          expect(hydrated.conversation.entries).toEqual([user, branch]);
          expect(hydrated.conversation.pending).toEqual(streaming.conversation.pending);
          expect(hydrated.busy).toBe(true);
        }),
      ),
  );

  it.effect("interrupts blocked reconciliation when the canonical feed closes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const stopped = yield* Deferred.make<void>();
        const { events, feeds } = yield* harness(() =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(Deferred.succeed(stopped, undefined)),
          ),
        );
        yield* Queue.offer(events, event({ type: "model_changed" }));
        yield* Deferred.await(started);
        yield* Queue.offer(events, { type: "closed", reason: "Native owner closed" });
        const closed = yield* nextFeed(
          feeds,
          (feed) => !feed.connected && feed.error === "Native owner closed",
        );
        expect(closed.conversation.entries).toEqual([user]);
        yield* Deferred.await(stopped);
      }),
    ),
  );
});
