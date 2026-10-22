import { describe, expect, it } from "vite-plus/test";

import { buildGhosttyThemeConfig, getMobileTerminalTheme } from "./terminalTheme";

describe("getMobileTerminalTheme", () => {
  it("applies the selected palette without replacing ANSI status colors", () => {
    const standard = getMobileTerminalTheme("t3-code", "dark");
    const ocean = getMobileTerminalTheme("ocean", "dark");

    expect(ocean.background).not.toBe(standard.background);
    expect(ocean.cursorForeground).not.toBe(standard.cursorForeground);
    expect(ocean.palette).toEqual(standard.palette);
  });
});

describe("buildGhosttyThemeConfig", () => {
  it("serializes theme colors into a ghostty config file", () => {
    const terminal = getMobileTerminalTheme("t3-code", "dark");
    const config = buildGhosttyThemeConfig(terminal);

    expect(config).toContain(`background = ${terminal.background}`);
    expect(config).toContain(`foreground = ${terminal.foreground}`);
    expect(config).toContain(`cursor-color = ${terminal.cursorForeground}`);
    expect(config).toContain(`palette = 0=${terminal.palette[0]}`);
    expect(config).toContain(`palette = 15=${terminal.palette[15]}`);
    expect(config.endsWith("\n")).toBe(true);
  });
});
