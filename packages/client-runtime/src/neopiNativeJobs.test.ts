import { describe, expect, it } from "vite-plus/test";
import {
  EMPTY_NATIVE_JOBS,
  applyNativeJobOutput,
  emptyNativeJobOutput,
  nativeJobElapsedMs,
  orderNativeJobs,
  parseNativeJob,
  reduceNativeJobs,
  snapshotNativeJobs,
} from "./neopiNativeJobs.ts";

const job = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "bash",
  label: `run ${id}`,
  command: `sleep ${id}`,
  status: "running",
  startedAt: 1_000,
  outputBytes: 0,
  ...extra,
});
const frame = (event: string, value: unknown, runningCount?: number) => ({
  type: "job_lifecycle",
  event,
  job: value,
  ...(runningCount === undefined ? {} : { runningCount }),
});

describe("native job lifecycle", () => {
  it("registers, progresses and settles a job, tracking NeoPi's running count", () => {
    let jobs = reduceNativeJobs(EMPTY_NATIVE_JOBS, frame("registered", job("bg_1"), 1));
    jobs = reduceNativeJobs(jobs, frame("progress", job("bg_1", { outputBytes: 40 }), 1));
    expect(jobs.entries).toHaveLength(1);
    expect(jobs.entries[0]?.outputBytes).toBe(40);
    jobs = reduceNativeJobs(
      jobs,
      frame("completed", job("bg_1", { status: "completed", finishedAt: 5_000, exitCode: 0 }), 0),
    );
    expect(jobs.entries[0]).toMatchObject({ status: "completed", finishedAt: 5_000, exitCode: 0 });
    expect(jobs.runningCount).toBe(0);
  });

  it("does not let a late progress frame reopen a settled job", () => {
    let jobs = reduceNativeJobs(EMPTY_NATIVE_JOBS, frame("registered", job("bg_1")));
    jobs = reduceNativeJobs(jobs, frame("failed", job("bg_1", { status: "failed" })));
    const late = reduceNativeJobs(jobs, frame("progress", job("bg_1")));
    expect(late).toBe(jobs);
    expect(reduceNativeJobs(jobs, frame("registered", job("bg_1"))).entries[0]?.status).toBe(
      "running",
    );
  });

  it("ignores other frames and malformed jobs", () => {
    expect(reduceNativeJobs(EMPTY_NATIVE_JOBS, { type: "agent_end" })).toBe(EMPTY_NATIVE_JOBS);
    expect(reduceNativeJobs(EMPTY_NATIVE_JOBS, frame("registered", { id: "x" }))).toBe(
      EMPTY_NATIVE_JOBS,
    );
    expect(parseNativeJob(job("bg_1", { status: "paused" }))).toBeNull();
  });
});

describe("native job inventory", () => {
  it("replaces the list and takes NeoPi's running count", () => {
    const jobs = snapshotNativeJobs(
      EMPTY_NATIVE_JOBS,
      {
        running: [job("bg_2")],
        recent: [job("bg_1", { status: "completed", finishedAt: 2_000 })],
        runningCount: 1,
      },
      0,
    );
    expect(jobs.entries.map((entry) => entry.id)).toEqual(["bg_2", "bg_1"]);
    expect(jobs.runningCount).toBe(1);
  });

  it("keeps a frame that landed while the read was in flight", () => {
    const before = reduceNativeJobs(EMPTY_NATIVE_JOBS, frame("registered", job("bg_1"), 1));
    const readRevision = before.revision;
    const during = reduceNativeJobs(
      before,
      frame("completed", job("bg_1", { status: "completed", finishedAt: 3_000 }), 0),
    );
    const merged = snapshotNativeJobs(
      during,
      { running: [job("bg_1")], recent: [], runningCount: 1 },
      readRevision,
    );
    expect(merged.entries[0]?.status).toBe("completed");
    expect(merged.runningCount).toBe(0);
  });

  it("drops a running job the inventory no longer lists and ignores a malformed response", () => {
    const before = reduceNativeJobs(EMPTY_NATIVE_JOBS, frame("registered", job("bg_1"), 1));
    const merged = snapshotNativeJobs(
      before,
      { running: [], recent: [], runningCount: 0 },
      before.revision,
    );
    expect(merged.entries).toEqual([]);
    expect(snapshotNativeJobs(before, { error: "nope" }, before.revision)).toBe(before);
  });

  it("orders running jobs first, then the most recently finished", () => {
    const parsed = [
      job("old", { status: "completed", finishedAt: 2_000 }),
      job("new", { status: "failed", finishedAt: 9_000 }),
      job("live", { startedAt: 500 }),
    ].map((value) => parseNativeJob(value)!);
    expect(orderNativeJobs(parsed).map((entry) => entry.id)).toEqual(["live", "new", "old"]);
  });

  it("measures a running job to now and a settled job to its finish", () => {
    const running = parseNativeJob(job("bg_1"))!;
    const done = parseNativeJob(job("bg_2", { status: "completed", finishedAt: 4_000 }))!;
    expect(nativeJobElapsedMs(running, 6_000)).toBe(5_000);
    expect(nativeJobElapsedMs(done, 99_000)).toBe(3_000);
  });
});

describe("native job output", () => {
  const slice = (fromByte: number, nextByte: number, output: string, reset = false) => ({
    jobId: "bg_1",
    fromByte,
    nextByte,
    totalBytes: nextByte,
    reset,
    output,
  });

  it("appends each slice from the byte offset NeoPi returned", () => {
    let output = emptyNativeJobOutput("bg_1");
    output = applyNativeJobOutput(output, slice(0, 5, "hello"));
    output = applyNativeJobOutput(output, slice(5, 11, " world"));
    expect(output).toEqual({ jobId: "bg_1", text: "hello world", nextByte: 11 });
  });

  it("restarts when NeoPi resets, and drops stale or foreign slices", () => {
    let output = applyNativeJobOutput(emptyNativeJobOutput("bg_1"), slice(0, 5, "hello"));
    expect(applyNativeJobOutput(output, slice(0, 5, "hello"))).toBe(output);
    expect(applyNativeJobOutput(output, { ...slice(5, 9, "more"), jobId: "bg_2" })).toBe(output);
    output = applyNativeJobOutput(output, slice(99, 3, "new", true));
    expect(output).toEqual({ jobId: "bg_1", text: "new", nextByte: 3 });
  });

  it("returns the same value for an empty slice so nothing re-renders", () => {
    const output = applyNativeJobOutput(emptyNativeJobOutput("bg_1"), slice(0, 5, "hello"));
    expect(applyNativeJobOutput(output, slice(5, 5, ""))).toBe(output);
  });
});
