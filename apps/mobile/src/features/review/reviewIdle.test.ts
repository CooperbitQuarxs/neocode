import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { cancelIdle, scheduleIdle } from "./reviewIdle";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("review idle scheduling", () => {
  it("preserves the idle deadline and 2,000 ms scheduling timeout", () => {
    const request = vi.fn(() => 7);
    const cancel = vi.fn();
    vi.stubGlobal("requestIdleCallback", request);
    vi.stubGlobal("cancelIdleCallback", cancel);
    const callback = vi.fn();
    expect(scheduleIdle(callback)).toBe(7);
    expect(request).toHaveBeenCalledWith(callback, { timeout: 2_000 });
    cancelIdle(7);
    expect(cancel).toHaveBeenCalledWith(7);
  });

  it("uses the existing 100 ms timer fallback without waiting on real time", () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    vi.stubGlobal("cancelIdleCallback", undefined);
    let scheduled: (() => void) | undefined;
    const timer = vi.spyOn(globalThis, "setTimeout").mockImplementation((callback) => {
      if (typeof callback === "function") scheduled = () => callback();
      return 9 as unknown as ReturnType<typeof setTimeout>;
    });
    const cancel = vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => {});
    const callback = vi.fn();
    expect(scheduleIdle(callback)).toBe(9);
    expect(timer).toHaveBeenCalledWith(expect.any(Function), 100);
    expect(callback).not.toHaveBeenCalled();
    scheduled!();
    const deadline = callback.mock.calls[0]![0] as Parameters<Parameters<typeof scheduleIdle>[0]>[0];
    expect(deadline.didTimeout).toBe(true);
    expect(deadline.timeRemaining()).toBe(0);
    cancelIdle(9);
    expect(cancel).toHaveBeenCalledWith(9);
  });
});
