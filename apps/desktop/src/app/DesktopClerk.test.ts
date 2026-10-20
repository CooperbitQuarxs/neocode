import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { beforeEach, vi } from "vite-plus/test";
import { EventEmitter } from "node:events";

const { createClerkBridgeMock, storageAdapter, storageMock } = vi.hoisted(() => ({
  createClerkBridgeMock: vi.fn(),
  storageAdapter: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
  storageMock: vi.fn(),
}));

vi.mock("@clerk/electron", () => ({
  createClerkBridge: createClerkBridgeMock,
}));

vi.mock("@clerk/electron/storage", () => ({
  storage: storageMock,
}));

import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import * as DesktopState from "./DesktopState.ts";
import * as DesktopClerk from "./DesktopClerk.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

const makeDesktopClerkLayer = (
  isDevelopment = true,
  events: string[] = [],
  appEvents = new EventEmitter(),
  quit = vi.fn(),
) => {
  const environment = DesktopEnvironment.DesktopEnvironment.of({
    stateDir: "/tmp/t3-state",
    isDevelopment,
    appDataDirectory: "/tmp/app-data",
    userDataDirName: isDevelopment ? "t3code-dev" : "t3code",
    legacyUserDataDirName: isDevelopment ? "T3 Code (Dev)" : "T3 Code (Alpha)",
    path: { join: (...parts: ReadonlyArray<string>) => parts.join("/") },
  } as unknown as DesktopEnvironment.DesktopEnvironment["Service"]);

  const electronApp = {
    setPath: (name: string, value: string) =>
      Effect.sync(() => {
        events.push(`setPath:${name}:${value}`);
      }),
    quit: Effect.sync(quit),
    on: (eventName: string, listener: (...args: unknown[]) => void) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          appEvents.on(eventName, listener);
        }),
        () =>
          Effect.sync(() => {
            appEvents.removeListener(eventName, listener);
          }),
      ).pipe(Effect.asVoid),
  } as unknown as ElectronApp.ElectronApp["Service"];

  return DesktopClerk.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(DesktopEnvironment.DesktopEnvironment, environment),
        Layer.succeed(ElectronApp.ElectronApp, electronApp),
        FileSystem.layerNoop({ exists: () => Effect.succeed(false) }),
      ),
    ),
  );
};

describe("DesktopClerk", () => {
  beforeEach(() => {
    createClerkBridgeMock.mockReset();
    storageMock.mockReset();
  });

  it.effect("acquires and releases the SDK bridge with the layer", () => {
    const cleanup = vi.fn();
    const events: string[] = [];
    storageMock.mockReturnValue(storageAdapter);
    createClerkBridgeMock.mockImplementation(() => {
      events.push("createClerkBridge");
      return { cleanup, isPrimaryInstance: true };
    });

    return Effect.gen(function* () {
      yield* Effect.scoped(Layer.build(makeDesktopClerkLayer(true, events)));

      assert.deepEqual(createClerkBridgeMock.mock.calls, [
        [
          {
            storage: storageAdapter,
            passkeys: true,
            renderer: { scheme: "t3code-dev", host: "app" },
          },
        ],
      ]);
      assert.equal(cleanup.mock.calls.length, 1);
      // The bridge acquires Electron's single-instance lock at creation, and
      // the lock both lives in and creates the userData directory — so the
      // real path must be set before the bridge exists.
      assert.deepEqual(events, ["setPath:userData:/tmp/app-data/t3code-dev", "createClerkBridge"]);
      storageMock.mockClear();
      createClerkBridgeMock.mockClear();
    });
  });

  it.effect("preserves bridge initialization failures", () => {
    const cause = new Error("bridge initialization failed");
    storageMock.mockReturnValue(storageAdapter);
    createClerkBridgeMock.mockImplementationOnce(() => {
      throw cause;
    });

    return Effect.gen(function* () {
      const error = yield* Effect.scoped(Layer.build(makeDesktopClerkLayer())).pipe(Effect.flip);

      assert.instanceOf(error, DesktopClerk.DesktopClerkBridgeInitializationError);
      assert.equal(error.stateDir, "/tmp/t3-state");
      assert.equal(error.isDevelopment, true);
      assert.strictEqual(error.cause, cause);
      assert.equal(
        error.message,
        'Failed to initialize the desktop Clerk bridge for state directory "/tmp/t3-state" (development: true).',
      );
    });
  });

  it.effect("preserves bridge cleanup failures", () => {
    const cause = new Error("bridge cleanup failed");
    storageMock.mockReturnValue(storageAdapter);
    createClerkBridgeMock.mockReturnValue({
      cleanup: () => {
        throw cause;
      },
    });

    return Effect.gen(function* () {
      const exit = yield* Effect.exit(Effect.scoped(Layer.build(makeDesktopClerkLayer(false))));

      assert.equal(exit._tag, "Failure");
      if (exit._tag === "Failure") {
        const error = Cause.squash(exit.cause);
        assert.instanceOf(error, DesktopClerk.DesktopClerkBridgeCleanupError);
        assert.equal(error.stateDir, "/tmp/t3-state");
        assert.equal(error.isDevelopment, false);
        assert.strictEqual(error.cause, cause);
        assert.equal(
          error.message,
          'Failed to clean up the desktop Clerk bridge for state directory "/tmp/t3-state" (development: false).',
        );
      }
    });
  });

  for (const { boundary, argv } of ["bridge lock", "before configure", "after configure"].flatMap(
    (boundary) => [
      { boundary, argv: ["electron"] },
      { boundary, argv: ["electron", "t3code://clerk/callback?code=private"] },
    ],
  )) {
    it.effect(
      `retains ${argv.length === 1 ? "ordinary" : "OAuth"} activation at ${boundary}`,
      () => {
        const appEvents = new EventEmitter();
        const cleanup = vi.fn();
        const quit = vi.fn();
        const oauthUrls: string[] = [];
        const callback = (_event: unknown, args: string[]) => {
          oauthUrls.push(...args.filter((arg) => arg.startsWith("t3code://")));
        };
        storageMock.mockReturnValue(storageAdapter);
        createClerkBridgeMock.mockImplementation(() => {
          appEvents.on("second-instance", callback);
          if (boundary === "bridge lock") appEvents.emit("second-instance", {}, argv);
          return {
            isPrimaryInstance: true,
            cleanup: () => {
              appEvents.removeListener("second-instance", callback);
              cleanup();
            },
          };
        });
        const activated = Promise.withResolvers<void>();
        let activations = 0;

        return Effect.gen(function* () {
          const quitting = yield* Ref.make(false);
          yield* Effect.scoped(
            Effect.gen(function* () {
              const clerk = yield* DesktopClerk.DesktopClerk;
              if (boundary === "before configure") appEvents.emit("second-instance", {}, argv);
              assert.equal(activations, 0);
              yield* clerk.configure;
              if (boundary === "after configure") appEvents.emit("second-instance", {}, argv);
              yield* Effect.promise(() => activated.promise);
              assert.equal(activations, 1);
              assert.deepEqual(oauthUrls, argv.slice(1));
              assert.equal(quit.mock.calls.length, 0);
            }).pipe(
              Effect.provide(makeDesktopClerkLayer(true, [], appEvents, quit)),
              Effect.provideService(
                DesktopWindow.DesktopWindow,
                DesktopWindow.DesktopWindow.of({
                  activate: Effect.sync(() => {
                    activations++;
                    activated.resolve();
                  }),
                } as unknown as DesktopWindow.DesktopWindow["Service"]),
              ),
              Effect.provideService(DesktopState.DesktopState, {
                quitting,
              } as DesktopState.DesktopState["Service"]),
            ),
          );
          appEvents.emit("second-instance", {}, argv);
          assert.equal(activations, 1);
          assert.deepEqual(oauthUrls, argv.slice(1));
          assert.equal(appEvents.listenerCount("second-instance"), 0);
          assert.equal(cleanup.mock.calls.length, 1);
        });
      },
    );
  }

  it.effect("quits and interrupts startup in a secondary instance without activation", () => {
    storageMock.mockReturnValue(storageAdapter);
    createClerkBridgeMock.mockReturnValue({ cleanup: vi.fn(), isPrimaryInstance: false });
    const quit = vi.fn();

    return Effect.gen(function* () {
      const quitting = yield* Ref.make(false);
      const clerk = yield* DesktopClerk.DesktopClerk;
      const exit = yield* Effect.exit(
        Effect.scoped(clerk.configure).pipe(
          Effect.provideService(DesktopWindow.DesktopWindow, {
            activate: Effect.die("secondary instance must not activate or bootstrap"),
          } as unknown as DesktopWindow.DesktopWindow["Service"]),
          Effect.provideService(DesktopState.DesktopState, {
            quitting,
          } as DesktopState.DesktopState["Service"]),
        ),
      );
      assert.isTrue(Exit.hasInterrupts(exit));
      assert.equal(quit.mock.calls.length, 1);
    }).pipe(Effect.provide(makeDesktopClerkLayer(true, [], new EventEmitter(), quit)));
  });
});
