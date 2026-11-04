import { ProviderInstanceId, type NeoPiNativeSessionSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  nativeSessionProjectLabel,
  partitionNativeSessions,
  resolveNativeSessionStatus,
  type NativeSessionVisitState,
} from "./neopiNativeSessionAttention.ts";

const session = (
  file: string,
  modifiedAt: string,
  extra: Partial<Pick<NeoPiNativeSessionSummary, "live" | "settledAt">> = {},
) => ({
  ref: { providerInstanceId: ProviderInstanceId.make("native"), sessionFile: file },
  modifiedAt,
  ...extra,
});
const live = (state: "busy" | "waiting" | "idle") => ({
  state,
  isStreaming: state === "busy",
  pendingDialogs: state === "waiting" ? 1 : 0,
  branch: null,
});
const visits: NativeSessionVisitState = {
  baseline: "2026-11-01T00:00:00.000Z",
  visited: { "/seen.jsonl": "2026-11-03T00:00:00.000Z" },
};

describe("resolveNativeSessionStatus", () => {
  it("ranks a blocked owner above a working one regardless of visits", () => {
    expect(
      resolveNativeSessionStatus(
        session("/a", "2026-10-01T00:00:00Z", { live: live("waiting") }),
        visits,
        false,
      ),
    ).toBe("waiting");
    expect(
      resolveNativeSessionStatus(
        session("/a", "2026-10-01T00:00:00Z", { live: live("busy") }),
        visits,
        true,
      ),
    ).toBe("working");
  });

  it("calls activity after the last visit done, judged against the baseline when never visited", () => {
    expect(
      resolveNativeSessionStatus(session("/new.jsonl", "2026-11-02T00:00:00Z"), visits, false),
    ).toBe("done");
    expect(
      resolveNativeSessionStatus(session("/old.jsonl", "2026-10-30T00:00:00Z"), visits, false),
    ).toBe("idle");
    expect(
      resolveNativeSessionStatus(session("/seen.jsonl", "2026-11-02T00:00:00Z"), visits, false),
    ).toBe("idle");
    expect(
      resolveNativeSessionStatus(session("/seen.jsonl", "2026-11-04T00:00:00Z"), visits, false),
    ).toBe("done");
  });

  it("never calls the open session done", () => {
    expect(
      resolveNativeSessionStatus(session("/new.jsonl", "2026-11-02T00:00:00Z"), visits, true),
    ).toBe("idle");
  });

  it("treats an unparseable activity time as seen", () => {
    expect(resolveNativeSessionStatus(session("/bad", "not a date"), visits, false)).toBe("idle");
  });
});

describe("partitionNativeSessions", () => {
  const sections = partitionNativeSessions(
    [
      session("/done-newer.jsonl", "2026-11-04T10:00:00Z"),
      session("/waiting-older.jsonl", "2026-11-04T08:00:00Z", { live: live("waiting") }),
      session("/working.jsonl", "2026-11-04T09:00:00Z", { live: live("busy") }),
      session("/recent-a.jsonl", "2026-10-31T00:00:00Z"),
      session("/recent-b.jsonl", "2026-10-31T12:00:00Z"),
      session("/settled-early.jsonl", "2026-10-01T00:00:00Z", {
        settledAt: "2026-10-05T00:00:00Z",
      }),
      session("/settled-late.jsonl", "2026-10-02T00:00:00Z", { settledAt: "2026-10-09T00:00:00Z" }),
      session("/open.jsonl", "2026-11-04T11:00:00Z"),
    ],
    visits,
    "/open.jsonl",
  );
  const files = (entries: typeof sections.attention) =>
    entries.map((entry) => entry.session.ref.sessionFile);

  it("puts blocked sessions before finished-unseen ones in the attention section", () => {
    expect(files(sections.attention)).toEqual(["/waiting-older.jsonl", "/done-newer.jsonl"]);
  });

  it("keeps working, recent and settled sections newest first, settled by settle time", () => {
    expect(files(sections.working)).toEqual(["/working.jsonl"]);
    expect(files(sections.recent)).toEqual(["/open.jsonl", "/recent-b.jsonl", "/recent-a.jsonl"]);
    expect(files(sections.settled)).toEqual(["/settled-late.jsonl", "/settled-early.jsonl"]);
  });
});

describe("nativeSessionProjectLabel", () => {
  it("uses the folder name, tolerating trailing separators and empty paths", () => {
    expect(nativeSessionProjectLabel("/home/me/source/neocode")).toBe("neocode");
    expect(nativeSessionProjectLabel("/home/me/source/neocode/")).toBe("neocode");
    expect(nativeSessionProjectLabel("C:\\work\\repo")).toBe("repo");
    expect(nativeSessionProjectLabel("")).toBe("No project");
    expect(nativeSessionProjectLabel("/")).toBe("No project");
  });
});
