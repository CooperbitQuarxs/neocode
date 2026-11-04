import { assert, describe, it } from "@effect/vitest";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";

import {
  makeNeoPiNativeSettledStore,
  resolveNativeSettlement,
  type NeoPiNativeSettledRecord,
} from "./NeoPiNativeSettlement.ts";

const DAY = 24 * 60 * 60 * 1_000;
const modifiedAt = "2026-10-01T00:00:00.000Z";
const now = Date.parse(modifiedAt) + 10 * DAY;
const settled: NeoPiNativeSettledRecord = {
  state: "settled",
  settledAt: "2026-10-02T00:00:00.000Z",
  modifiedAt,
};
const resolve = (overrides: Partial<Parameters<typeof resolveNativeSettlement>[0]> = {}) =>
  resolveNativeSettlement({
    record: undefined,
    modifiedAt,
    live: undefined,
    autoSettleAfterDays: null,
    now,
    ...overrides,
  });

describe("resolveNativeSettlement", () => {
  it("keeps a manual settle while the file is unchanged and the owner is idle", () => {
    assert.deepEqual(resolve({ record: settled, live: { state: "idle" } }), {
      settledAt: settled.settledAt,
      retain: true,
    });
  });

  it("wakes a settled session on newer activity or a busy or blocked owner", () => {
    const woken = { settledAt: null, retain: false };
    assert.deepEqual(resolve({ record: settled, modifiedAt: "2026-10-02T00:00:00.000Z" }), woken);
    assert.deepEqual(resolve({ record: settled, live: { state: "busy" } }), woken);
    assert.deepEqual(resolve({ record: settled, live: { state: "waiting" } }), woken);
  });

  it("auto-settles once idle past the window, dated from when the window elapsed", () => {
    assert.deepEqual(resolve({ autoSettleAfterDays: 3 }), {
      settledAt: "2026-10-04T00:00:00.000Z",
      retain: false,
    });
    assert.equal(resolve({ autoSettleAfterDays: 14 }).settledAt, null);
    assert.equal(resolve({ autoSettleAfterDays: null }).settledAt, null);
  });

  it("never auto-settles a session whose owner is working or blocked", () => {
    assert.equal(resolve({ autoSettleAfterDays: 3, live: { state: "busy" } }).settledAt, null);
    assert.equal(resolve({ autoSettleAfterDays: 3, live: { state: "waiting" } }).settledAt, null);
    assert.equal(
      resolve({ autoSettleAfterDays: 3, live: { state: "idle" } }).settledAt !== null,
      true,
    );
  });

  it("lets an explicit un-settle hold off auto-settling until new activity", () => {
    const unsettled: NeoPiNativeSettledRecord = { ...settled, state: "unsettled" };
    assert.deepEqual(resolve({ record: unsettled, autoSettleAfterDays: 3 }), {
      settledAt: null,
      retain: true,
    });
    assert.equal(
      resolve({
        record: unsettled,
        autoSettleAfterDays: 3,
        modifiedAt: "2026-10-05T00:00:00.000Z",
      }).settledAt,
      "2026-10-08T00:00:00.000Z",
    );
  });
});

describe("makeNeoPiNativeSettledStore", () => {
  it.effect("persists decisions across restarts and survives an unreadable file", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const filePath = `${dir}/settled.json`;
      const first = yield* makeNeoPiNativeSettledStore(filePath);
      yield* first.update([
        ["/a.jsonl", settled],
        ["/b.jsonl", { ...settled, state: "unsettled" }],
      ]);
      yield* first.update([["/b.jsonl", null]]);
      const second = yield* makeNeoPiNativeSettledStore(filePath);
      assert.deepEqual(Array.from(yield* second.read), [["/a.jsonl", settled]]);

      yield* fs.writeFileString(filePath, "{not json");
      assert.equal((yield* (yield* makeNeoPiNativeSettledStore(filePath)).read).size, 0);
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
  );
});
