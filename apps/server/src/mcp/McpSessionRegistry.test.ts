import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { nativeWorkspaceResourceId } from "@t3tools/shared/neopiWorkspace";
import * as Effect from "effect/Effect";
import { HttpServer } from "effect/unstable/http";
import * as NetAddress from "effect/unstable/net/NetAddress";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as McpSessionRegistry from "./McpSessionRegistry.ts";
import * as McpProviderSession from "./McpProviderSession.ts";

const environmentId = EnvironmentId.make("environment-1");
const makeFakeHttpServer = (hostname: string, port = 43123) =>
  HttpServer.HttpServer.of({
    address: NetAddress.inetAddressFromIpStringUnsafe(hostname, port),
    serve: (() => Effect.void) as HttpServer.HttpServer["Service"]["serve"],
  });
const fakeHttpServer = makeFakeHttpServer("127.0.0.1");
const fakeEnvironment = ServerEnvironment.ServerEnvironment.of({
  getEnvironmentId: Effect.succeed(environmentId),
  getDescriptor: Effect.die("unused"),
});

const makeRegistry = (now: () => number, httpServer = fakeHttpServer) =>
  McpSessionRegistry.__testing
    .make({
      now,
      livenessWindowMs: 100,
    })
    .pipe(
      Effect.provideService(HttpServer.HttpServer, httpServer),
      Effect.provideService(ServerEnvironment.ServerEnvironment, fakeEnvironment),
      Effect.provide(NodeServices.layer),
    );

it.effect("stores only a token hash, resolves the bearer token, and revokes by thread", () =>
  Effect.gen(function* () {
    let timestamp = 1_000;
    const registry = yield* makeRegistry(() => timestamp);
    const threadId = ThreadId.make("thread-1");
    const issued = yield* registry.issue({
      threadId,
      providerInstanceId: ProviderInstanceId.make("codex"),
      capabilities: new Set(["preview"]),
    });
    expect(issued.config.endpoint).toBe("http://127.0.0.1:43123/mcp");
    const token = issued.config.authorizationHeader.replace(/^Bearer\s+/, "");
    expect(token.length).toBeGreaterThan(20);

    const resolved = yield* registry.resolve(token);
    expect(resolved?.threadId).toBe(threadId);

    yield* registry.revokeThread(threadId);
    expect(yield* registry.resolve(token)).toBeUndefined();

    timestamp += 2_000;
  }),
);

it.effect("always grants pull-requests and gates browser and device access independently", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry(() => 1_000);
    const withPreview = yield* registry.issue({
      threadId: ThreadId.make("thread-preview"),
      providerInstanceId: ProviderInstanceId.make("codex"),
      capabilities: new Set(["preview"]),
    });
    const withoutPreview = yield* registry.issue({
      threadId: ThreadId.make("thread-no-preview"),
      providerInstanceId: ProviderInstanceId.make("codex"),
      capabilities: new Set(),
    });
    const withDevice = yield* registry.issue({
      threadId: ThreadId.make("thread-device"),
      providerInstanceId: ProviderInstanceId.make("codex"),
      capabilities: new Set(["device"]),
    });
    const capabilitiesOf = (issued: typeof withPreview) =>
      registry
        .resolve(issued.config.authorizationHeader.replace(/^Bearer\s+/, ""))
        .pipe(Effect.map((scope) => [...(scope?.capabilities ?? [])].sort()));

    expect(yield* capabilitiesOf(withPreview)).toEqual(["preview", "pull-requests"]);
    expect(yield* capabilitiesOf(withoutPreview)).toEqual(["pull-requests"]);
    expect(yield* capabilitiesOf(withDevice)).toEqual(["device", "pull-requests"]);
  }),
);

it.effect("builds MCP endpoints from the bound server host", () =>
  Effect.gen(function* () {
    const cases = [
      ["100.64.0.40", "http://100.64.0.40:43123/mcp"],
      ["0.0.0.0", "http://127.0.0.1:43123/mcp"],
      ["::", "http://127.0.0.1:43123/mcp"],
      ["::1", "http://[::1]:43123/mcp"],
      ["127.0.0.1", "http://127.0.0.1:43123/mcp"],
    ] as const;

    for (const [hostname, expectedEndpoint] of cases) {
      const registry = yield* makeRegistry(() => 1_000, makeFakeHttpServer(hostname));
      const issued = yield* registry.issue({
        threadId: ThreadId.make(`thread-${hostname}`),
        providerInstanceId: ProviderInstanceId.make("codex"),
        capabilities: new Set(["preview"]),
      });
      expect(issued.config.endpoint).toBe(expectedEndpoint);
    }
  }),
);

it.effect("expires credentials once their session stops showing signs of life", () =>
  Effect.gen(function* () {
    let timestamp = 1_000;
    const registry = yield* makeRegistry(() => timestamp);
    const issued = yield* registry.issue({
      threadId: ThreadId.make("thread-2"),
      providerInstanceId: ProviderInstanceId.make("claude"),
      capabilities: new Set(["preview"]),
    });
    const token = issued.config.authorizationHeader.replace(/^Bearer\s+/, "");
    timestamp += 101;
    expect(yield* registry.resolve(token)).toBeUndefined();
  }),
);

it.effect("keeps a credential alive across turns that never touch an MCP tool", () =>
  Effect.gen(function* () {
    let timestamp = 1_000;
    const registry = yield* makeRegistry(() => timestamp);
    const threadId = ThreadId.make("thread-3");
    const issued = yield* registry.issue({
      threadId,
      providerInstanceId: ProviderInstanceId.make("claude"),
      capabilities: new Set(["preview"]),
    });
    const token = issued.config.authorizationHeader.replace(/^Bearer\s+/, "");

    // Well past the liveness window in total, but each turn reports in before
    // it lapses — this is the long-session case that used to lose the toolkit.
    for (let turn = 0; turn < 10; turn += 1) {
      timestamp += 99;
      yield* registry.touch(threadId);
    }

    expect((yield* registry.resolve(token))?.threadId).toBe(threadId);
  }),
);

it.effect("does not keep credentials of other threads alive", () =>
  Effect.gen(function* () {
    let timestamp = 1_000;
    const registry = yield* makeRegistry(() => timestamp);
    const issued = yield* registry.issue({
      threadId: ThreadId.make("thread-4"),
      providerInstanceId: ProviderInstanceId.make("codex"),
      capabilities: new Set(["preview"]),
    });
    const token = issued.config.authorizationHeader.replace(/^Bearer\s+/, "");

    timestamp += 99;
    yield* registry.touch(ThreadId.make("thread-unrelated"));
    timestamp += 2;

    expect(yield* registry.resolve(token)).toBeUndefined();
  }),
);

it.effect("revoking an active thread removes its credential and provider configuration", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const registry = yield* McpSessionRegistry.McpSessionRegistry;
      const threadId = ThreadId.make("thread-revoked");
      const issued = yield* McpSessionRegistry.issueActiveMcpCredential({
        threadId,
        providerInstanceId: ProviderInstanceId.make("codex"),
        capabilities: new Set(["preview"]),
      });
      expect(issued).toBeDefined();
      McpProviderSession.setMcpProviderSession(issued!.config);
      expect(
        yield* McpSessionRegistry.resolveActiveMcpCredential(issued!.config.authorizationHeader),
      ).toBeDefined();
      yield* McpSessionRegistry.revokeActiveMcpThread(threadId);
      expect(
        yield* registry.resolve(issued!.config.authorizationHeader.slice("Bearer ".length)),
      ).toBeUndefined();
      expect(McpProviderSession.readMcpProviderSession(threadId)).toBeUndefined();
    }).pipe(
      Effect.provide(McpSessionRegistry.layer),
      Effect.provideService(HttpServer.HttpServer, fakeHttpServer),
      Effect.provideService(ServerEnvironment.ServerEnvironment, fakeEnvironment),
      Effect.provide(NodeServices.layer),
    ),
  ),
);

it.effect(
  "isolates native grants and revocation from legacy threads and other native profiles/files",
  () =>
    Effect.gen(function* () {
      let timestamp = 1_000;
      const registry = yield* makeRegistry(() => timestamp);
      const ref = {
        providerInstanceId: ProviderInstanceId.make("native"),
        sessionFile: "/native/session.jsonl",
      };
      const native = yield* registry.issueNative({
        sessionRef: ref,
        capabilities: new Set(["preview"]),
      });
      const otherFile = yield* registry.issueNative({
        sessionRef: { ...ref, sessionFile: "/native/other.jsonl" },
        capabilities: new Set(["device"]),
      });
      const otherProfile = yield* registry.issueNative({
        sessionRef: { ...ref, providerInstanceId: ProviderInstanceId.make("other-native") },
        capabilities: new Set(),
      });
      const legacyThread = ThreadId.make("legacy-thread");
      const legacy = yield* registry.issue({
        threadId: legacyThread,
        providerInstanceId: ref.providerInstanceId,
        capabilities: new Set(["preview"]),
      });
      const resolve = (header: string) => registry.resolve(header.slice("Bearer ".length));
      expect(native.scope).toMatchObject({
        kind: "native",
        sessionRef: ref,
        threadId: nativeWorkspaceResourceId(ref),
        environmentId,
      });
      expect([...native.scope.capabilities]).toEqual(["preview"]);
      expect(
        new Set([native.scope.threadId, otherFile.scope.threadId, otherProfile.scope.threadId])
          .size,
      ).toBe(3);
      yield* registry.revokeThread(legacyThread);
      expect(yield* resolve(legacy.config.authorizationHeader)).toBeUndefined();
      expect(yield* resolve(native.authorizationHeader)).toBeDefined();
      timestamp += 101;
      // Native liveness belongs to the owning connection, not unrelated SQL turn traffic.
      expect(yield* resolve(native.authorizationHeader)).toBeDefined();
      yield* registry.revokeProviderSession(native.scope.providerSessionId);
      expect(native.scope.revoked?.aborted).toBe(true);
      expect(yield* resolve(native.authorizationHeader)).toBeUndefined();
      expect(yield* resolve(otherFile.authorizationHeader)).toMatchObject({
        sessionRef: { sessionFile: "/native/other.jsonl" },
      });
      expect(yield* resolve(otherProfile.authorizationHeader)).toMatchObject({
        providerInstanceId: "other-native",
      });
      yield* registry.revokeAll;
      expect(otherFile.scope.revoked?.aborted).toBe(true);
      expect(otherProfile.scope.revoked?.aborted).toBe(true);
      expect(yield* resolve(otherFile.authorizationHeader)).toBeUndefined();
      expect(yield* resolve(otherProfile.authorizationHeader)).toBeUndefined();
    }),
);
