import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { isMonospaceFamily } from "./appearanceFonts";

vi.mock("./appearanceFonts", () => ({ isMonospaceFamily: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.mocked(isMonospaceFamily).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("installed monospace font discovery", () => {
  it("lets other UI work run between font measurements and preserves family order", async () => {
    const { filterInstalledMonospaceFonts } = await import("./installedMonospaceFonts");
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.mocked(isMonospaceFamily).mockImplementation((family) => {
      now += 10;
      return family !== "Proportional";
    });
    const result = filterInstalledMonospaceFonts(
      ["First Mono", "Proportional", "Last Mono"],
      new AbortController().signal,
    );
    expect(isMonospaceFamily).not.toHaveBeenCalled();

    let measuredBeforeInput = 0;
    setTimeout(() => {
      measuredBeforeInput = vi.mocked(isMonospaceFamily).mock.calls.length;
    }, 0);
    await vi.runAllTimersAsync();

    expect(measuredBeforeInput).toBe(1);
    expect(await result).toEqual(["First Mono", "Last Mono"]);
  });

  it("stops probing when a picker closes and reuses completed measurements on reopen", async () => {
    const { filterInstalledMonospaceFonts } = await import("./installedMonospaceFonts");
    const controller = new AbortController();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.mocked(isMonospaceFamily).mockImplementation(() => {
      now += 10;
      return true;
    });
    const families = ["First Mono", "Second Mono", "Third Mono"];
    const cancelled = filterInstalledMonospaceFonts(families, controller.signal);
    setTimeout(() => controller.abort(), 0);
    await vi.runAllTimersAsync();
    await cancelled;
    expect(isMonospaceFamily).toHaveBeenCalledTimes(1);

    const reopened = filterInstalledMonospaceFonts(families, new AbortController().signal);
    await vi.runAllTimersAsync();
    expect(await reopened).toEqual(families);
    expect(isMonospaceFamily).toHaveBeenCalledTimes(3);

    const remounted = filterInstalledMonospaceFonts(families, new AbortController().signal);
    await vi.runAllTimersAsync();
    expect(await remounted).toEqual(families);
    expect(isMonospaceFamily).toHaveBeenCalledTimes(3);
  });

  it("does not measure anything after unmounting before the first scan", async () => {
    const { filterInstalledMonospaceFonts } = await import("./installedMonospaceFonts");
    const controller = new AbortController();
    const result = filterInstalledMonospaceFonts(["Unvisited Font"], controller.signal);
    controller.abort();
    await vi.runAllTimersAsync();
    expect(await result).toEqual([]);
    expect(isMonospaceFamily).not.toHaveBeenCalled();
  });
});
