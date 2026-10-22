import { describe, expect, it } from "vite-plus/test";
import {
  BUILT_IN_THEMES,
  T3_CODE_DARK_THEME_COLORS,
  T3_CODE_LIGHT_THEME_COLORS,
  getThemeColorsForAppearance,
} from "@t3tools/shared/themePalettes";

import { themeColorToNativeColor } from "../../lib/mobileTheme";

import { buildGhosttyThemeConfig, getMobileTerminalTheme } from "./terminalTheme";

describe("getMobileTerminalTheme", () => {
  it.each(["light", "dark"] as const)("uses the shared default %s terminal roles", (appearance) => {
    const colors =
      appearance === "dark" ? T3_CODE_DARK_THEME_COLORS : T3_CODE_LIGHT_THEME_COLORS;
    expect(getMobileTerminalTheme("t3-code", appearance)).toMatchObject({
      background: themeColorToNativeColor(colors.terminalBackground),
      foreground: themeColorToNativeColor(colors.terminalForeground),
      cursorForeground: themeColorToNativeColor(colors.terminalCursor),
      cursorBackground: themeColorToNativeColor(colors.terminalBackground),
    });
  });
  it("applies the selected palette without replacing ANSI status colors", () => {
    const standard = getMobileTerminalTheme("t3-code", "dark");
    const ocean = getMobileTerminalTheme("ocean", "dark");

    expect(ocean.background).not.toBe(standard.background);
    expect(ocean.cursorForeground).not.toBe(standard.cursorForeground);
    expect(ocean.palette).toEqual(standard.palette);
  });

  it("uses the canonical desktop terminal roles for built-in themes", () => {
    const theme = BUILT_IN_THEMES.find((candidate) => candidate.id === "ocean")!;
    const colors = getThemeColorsForAppearance(theme, "dark")!;
    const terminal = getMobileTerminalTheme("ocean", "dark");

    expect(terminal.background).toBe(themeColorToNativeColor(colors.terminalBackground));
    expect(terminal.foreground).toBe(themeColorToNativeColor(colors.terminalForeground));
    expect(terminal.cursorForeground).toBe(themeColorToNativeColor(colors.terminalCursor));
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
