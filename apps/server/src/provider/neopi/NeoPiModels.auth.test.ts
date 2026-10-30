import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import { NeoPiRpcError } from "effect-neopi-rpc/errors";
import type { UiRequestFrame } from "effect-neopi-rpc/client";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { makeNativeModelsAuth } from "./NeoPiModels.ts";
import type { NeoPiModelsConnection } from "./NeoPiModelsConnection.ts";

const target = { providerInstanceId: ProviderInstanceId.make("native-auth") };
const cancelled = () => new NeoPiRpcError({ code: "login_cancelled", message: "Login cancelled" });
const fixture = Effect.fnUntraced(function* (
  cancelReply?: Effect.Effect<unknown, NeoPiRpcError>,
  uiReply: Effect.Effect<void, NeoPiRpcError> = Effect.void,
  initialPrompt?: { readonly id: string; readonly title: string },
) {
  const result = yield* Deferred.make<unknown, NeoPiRpcError>();
  const loginId = yield* Deferred.make<string>();
  const requestEnded = yield* Deferred.make<void>();
  const cancelStarted = yield* Deferred.make<void>();
  const respondStarted = yield* Deferred.make<void>();
  const cancelCalls = yield* Ref.make(0);
  const releases = yield* Ref.make(0);
  const ui = yield* Effect.acquireRelease(PubSub.unbounded<UiRequestFrame>(), PubSub.shutdown);
  const native: NeoPiModelsConnection = {
    capabilities: new Set(["cancellable_login"]),
    validate: Effect.void,
    changes: Stream.empty,
    ui: Stream.fromPubSub(ui),
    respondUi: () => Deferred.succeed(respondStarted, undefined).pipe(Effect.andThen(uiReply)),
    request: (command) =>
      Effect.gen(function* () {
        if (command.type === "login" && "id" in command && typeof command.id === "string") {
          yield* Deferred.succeed(loginId, command.id);
          if (initialPrompt)
            yield* PubSub.publish(ui, {
              type: "extension_ui_request",
              ...initialPrompt,
              method: "input",
              loginId: command.id,
            });
          return yield* Deferred.await(result).pipe(
            Effect.ensuring(Deferred.succeed(requestEnded, undefined)),
          );
        }
        if (command.type === "cancel_login" && "loginId" in command) {
          if (command.loginId !== (yield* Deferred.await(loginId)))
            return yield* new NeoPiRpcError({
              message: "This connection has no such active login",
            });
          yield* Ref.update(cancelCalls, (count) => count + 1);
          yield* Deferred.succeed(cancelStarted, undefined);
          return yield* cancelReply ?? Deferred.fail(result, cancelled());
        }
        return yield* new NeoPiRpcError({ message: "Unexpected auth command" });
      }),
  };
  const auth = yield* makeNativeModelsAuth(() =>
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Ref.update(releases, (count) => count + 1));
      return native;
    }),
  );
  const flow = yield* auth.startAuth({ target, providerId: "fixture-provider" });
  return {
    auth,
    flow,
    result,
    loginId,
    requestEnded,
    cancelStarted,
    respondStarted,
    cancelCalls,
    releases,
    ui,
  };
});

describe("native Models login lifecycle", () => {
  it.effect("preserves the public device verification code from the native challenge", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { auth, flow, loginId, ui } = yield* fixture();
        const observed = yield* Deferred.make<void>();
        const watch = yield* auth.watchAuth(flow).pipe(
          Stream.filter((state) => state.userCode !== null),
          Stream.take(1),
          Stream.tap((state) => {
            expect(state.userCode).toBe("ABCD-EFGH");
            expect(state.url).toBe("https://example.com/device");
            return Deferred.succeed(observed, undefined);
          }),
          Stream.runDrain,
          Effect.forkScoped,
        );
        yield* PubSub.publish(ui, {
          type: "extension_ui_request",
          id: "device-challenge",
          method: "open_url",
          loginId: yield* Deferred.await(loginId),
          url: "https://example.com/device",
          userCode: "ABCD-EFGH",
        });
        yield* Deferred.await(observed);
        yield* Fiber.join(watch);
      }),
    ),
  );
  it.effect("reports native cancellation as cancelled rather than failed", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { auth, flow, requestEnded } = yield* fixture();
        const watch = yield* auth.watchAuth(flow).pipe(Stream.runCollect, Effect.forkScoped);
        yield* auth.cancelAuth(flow);
        const states = yield* Fiber.join(watch);
        expect(states.at(-1)).toMatchObject({
          status: "cancelled",
          message: "Login cancelled",
          prompt: null,
        });
        yield* Deferred.await(requestEnded);
      }),
    ),
  );

  it.effect("keeps native success when saving an account wins against cancellation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { auth, flow, result } = yield* fixture(Effect.void);
        const watch = yield* auth.watchAuth(flow).pipe(Stream.runCollect, Effect.forkScoped);
        yield* auth.cancelAuth(flow);
        yield* Deferred.succeed(result, { providerId: "fixture-provider" });
        const states = yield* Fiber.join(watch);
        expect(states.at(-1)?.status).toBe("complete");
        expect(states.some((state) => state.status === "cancelled")).toBe(false);
      }),
    ),
  );

  it.effect("delivers the full native failure even when the watch starts after login fails", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { auth, flow, result, requestEnded } = yield* fixture();
        const message = "Provider login failed: callback rejected; native detail: invalid verifier";
        yield* Deferred.fail(result, new NeoPiRpcError({ message }));
        yield* Deferred.await(requestEnded);
        const states = yield* auth.watchAuth(flow).pipe(Stream.runCollect);
        expect(states.at(-1)).toMatchObject({ status: "failed", message, prompt: null });
      }),
    ),
  );

  it.effect(
    "settles the watch with the cancellation error instead of leaving a waiting login",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const message = "This connection has no such active login";
          const { auth, flow, requestEnded } = yield* fixture(
            Effect.fail(new NeoPiRpcError({ message })),
          );
          const watch = yield* auth.watchAuth(flow).pipe(Stream.runCollect, Effect.forkScoped);
          const cancel = yield* auth.cancelAuth(flow).pipe(Effect.result);
          expect(cancel._tag).toBe("Failure");
          if (cancel._tag === "Failure") expect(cancel.failure.message).toBe(message);
          const states = yield* Fiber.join(watch);
          expect(states.at(-1)).toMatchObject({ status: "failed", message, prompt: null });
          yield* Deferred.await(requestEnded);
        }),
      ),
  );

  it.effect("does not replace native completion with a late cancellation error", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const reply = yield* Deferred.make<unknown, NeoPiRpcError>();
        const { auth, flow, result, cancelStarted } = yield* fixture(Deferred.await(reply));
        const watch = yield* auth.watchAuth(flow).pipe(Stream.runCollect, Effect.forkScoped);
        const cancel = yield* auth.cancelAuth(flow).pipe(Effect.forkScoped);
        yield* Deferred.await(cancelStarted);
        yield* Deferred.succeed(result, {});
        const states = yield* Fiber.join(watch);
        expect(states.at(-1)?.status).toBe("complete");
        yield* Deferred.fail(
          reply,
          new NeoPiRpcError({ message: "This connection has no such active login" }),
        );
        yield* Fiber.join(cancel);
      }),
    ),
  );

  it.effect("shares one native cancellation between concurrent requests", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const reply = yield* Deferred.make<unknown, NeoPiRpcError>();
        const { auth, flow, result, cancelStarted, cancelCalls } = yield* fixture(
          Deferred.await(reply),
        );
        const watch = yield* auth.watchAuth(flow).pipe(Stream.runCollect, Effect.forkScoped);
        const first = yield* auth.cancelAuth(flow).pipe(Effect.forkScoped);
        const second = yield* auth.cancelAuth(flow).pipe(Effect.forkScoped);
        yield* Deferred.await(cancelStarted);
        yield* Deferred.fail(result, cancelled());
        yield* Deferred.succeed(reply, undefined);
        yield* Fiber.join(first);
        yield* Fiber.join(second);
        const states = yield* Fiber.join(watch);
        expect(states.at(-1)?.status).toBe("cancelled");
        expect(yield* Ref.get(cancelCalls)).toBe(1);
      }),
    ),
  );

  it.effect(
    "interrupts the pending request and releases the borrowed connection on watch teardown",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { auth, flow, requestEnded, releases, cancelCalls } = yield* fixture(Effect.void);
          const ready = yield* Deferred.make<void>();
          const watch = yield* auth.watchAuth(flow).pipe(
            Stream.tap(() => Deferred.succeed(ready, undefined)),
            Stream.runDrain,
            Effect.forkScoped,
          );
          yield* Deferred.await(ready);
          yield* Fiber.interrupt(watch);
          yield* Deferred.await(requestEnded);
          expect(yield* Ref.get(releases)).toBe(1);
          expect(yield* Ref.get(cancelCalls)).toBe(1);
        }),
      ),
  );

  it.effect("keeps login alive until the last observer leaves", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { auth, flow, result, releases, cancelCalls } = yield* fixture(Effect.void);
        const firstReady = yield* Deferred.make<void>();
        const secondReady = yield* Deferred.make<void>();
        const first = yield* auth.watchAuth(flow).pipe(
          Stream.tap(() => Deferred.succeed(firstReady, undefined)),
          Stream.runDrain,
          Effect.forkScoped,
        );
        const second = yield* auth.watchAuth(flow).pipe(
          Stream.tap(() => Deferred.succeed(secondReady, undefined)),
          Stream.runCollect,
          Effect.forkScoped,
        );
        yield* Deferred.await(firstReady);
        yield* Deferred.await(secondReady);
        yield* Fiber.interrupt(first);
        expect(yield* Ref.get(cancelCalls)).toBe(0);
        expect(yield* Ref.get(releases)).toBe(0);
        yield* Deferred.succeed(result, {});
        const states = yield* Fiber.join(second);
        expect(states.at(-1)?.status).toBe("complete");
      }),
    ),
  );
  it.effect("does not clear a newer prompt when an older answer finishes sending", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const reply = yield* Deferred.make<void>();
        const { auth, flow, result, ui, respondStarted } = yield* fixture(
          Effect.void,
          Deferred.await(reply),
          { id: "first", title: "First answer" },
        );
        const firstPrompt = yield* Deferred.make<void>();
        const secondPrompt = yield* Deferred.make<void>();
        const watch = yield* auth.watchAuth(flow).pipe(
          Stream.tap((state) =>
            state.prompt?.id === "first"
              ? Deferred.succeed(firstPrompt, undefined)
              : state.prompt?.id === "second"
                ? Deferred.succeed(secondPrompt, undefined)
                : Effect.void,
          ),
          Stream.runCollect,
          Effect.forkScoped,
        );
        yield* Deferred.await(firstPrompt);
        const response = yield* auth
          .respondAuth({
            flowId: flow.flowId,
            requestId: "first",
            value: "fixture answer",
          })
          .pipe(Effect.forkScoped);
        yield* Deferred.await(respondStarted);
        yield* PubSub.publish(ui, {
          type: "extension_ui_request",
          id: "second",
          method: "input",
          title: "Second answer",
          loginId: flow.flowId,
        });
        yield* Deferred.await(secondPrompt);
        yield* Deferred.succeed(reply, undefined);
        yield* Fiber.join(response);
        const current = yield* auth.watchAuth(flow).pipe(Stream.take(1), Stream.runCollect);
        expect(current.at(0)?.prompt).toMatchObject({ id: "second", title: "Second answer" });
        yield* Deferred.succeed(result, {});
        yield* Fiber.join(watch);
      }),
    ),
  );
});
