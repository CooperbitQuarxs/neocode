import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import type { NativeSessionTarget } from "@t3tools/client-runtime/neopi-native-sessions";
import { describe, expect, it } from "vite-plus/test";

import {
  closeNativeSessionTab,
  cycleNativeSessionTab,
  openNativeSessionTab,
  replaceNativeSessionTab,
} from "./nativeSessionTabs";

const session = (sessionFile: string): NativeSessionTarget => ({
  environmentId: EnvironmentId.make("env"),
  ref: { providerInstanceId: ProviderInstanceId.make("neopi"), sessionFile },
});
const [a, b, c] = [session("a"), session("b"), session("c")] as const;
const files = (tabs: readonly NativeSessionTarget[]) => tabs.map((tab) => tab.ref.sessionFile);

describe("native session tabs", () => {
  it("opens a session once and keeps an existing tab in place", () => {
    expect(files(openNativeSessionTab([a, b], c))).toEqual(["a", "b", "c"]);
    expect(files(openNativeSessionTab([a, b], session("a")))).toEqual(["a", "b"]);
  });

  it("treats the same file in another environment as another session", () => {
    const remote = { ...a, environmentId: EnvironmentId.make("remote") };
    expect(openNativeSessionTab([a], remote)).toHaveLength(2);
  });

  it("closes the active tab onto its right neighbour, else its left", () => {
    expect(closeNativeSessionTab([a, b, c], b, b)).toEqual({ tabs: [a, c], active: c });
    expect(closeNativeSessionTab([a, b, c], c, c)).toEqual({ tabs: [a, b], active: b });
    expect(closeNativeSessionTab([a], a, a)).toEqual({ tabs: [], active: null });
  });

  it("keeps the active tab when another one closes", () => {
    expect(closeNativeSessionTab([a, b, c], c, a)).toEqual({ tabs: [b, c], active: c });
    expect(closeNativeSessionTab([a, b], a, c)).toEqual({ tabs: [a, b], active: a });
  });

  it("cycles both ways and wraps around", () => {
    expect(cycleNativeSessionTab([a, b, c], a, "next")).toBe(b);
    expect(cycleNativeSessionTab([a, b, c], c, "next")).toBe(a);
    expect(cycleNativeSessionTab([a, b, c], a, "previous")).toBe(c);
    expect(cycleNativeSessionTab([a, b, c], b, "previous")).toBe(a);
  });

  it("starts from the ends when nothing is active", () => {
    expect(cycleNativeSessionTab([a, b, c], null, "next")).toBe(a);
    expect(cycleNativeSessionTab([a, b, c], null, "previous")).toBe(c);
    expect(cycleNativeSessionTab([], null, "next")).toBeNull();
  });

  it("moves a tab to NeoPi's new session file in place, without duplicating", () => {
    expect(files(replaceNativeSessionTab([a, b, c], b, session("b2")))).toEqual(["a", "b2", "c"]);
    expect(files(replaceNativeSessionTab([a, b, c], b, c))).toEqual(["a", "c"]);
    expect(files(replaceNativeSessionTab([a], b, c))).toEqual(["a", "c"]);
  });
});
