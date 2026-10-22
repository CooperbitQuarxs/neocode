import { describe, expect, it } from "vite-plus/test";

import { resolveInitialThreadSidebarWidth } from "./threadSidebarWidth";

describe("resolveInitialThreadSidebarWidth", () => {
  it("keeps a saved width instead of replacing it with the default", () => {
    expect(resolveInitialThreadSidebarWidth(320, 1440)).toBe(320);
    expect(resolveInitialThreadSidebarWidth(210, 1440)).toBe(210);
  });

  it("keeps narrow or oversized saved widths inside the existing limits", () => {
    expect(resolveInitialThreadSidebarWidth(100, 1440)).toBe(208);
    expect(resolveInitialThreadSidebarWidth(600, 1000)).toBe(360);
    expect(resolveInitialThreadSidebarWidth(null, 800)).toBe(208);
  });
});
