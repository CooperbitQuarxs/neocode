import defaultThemeVariables from "../../generated-uniwind-default-theme-variables.json";
import {
  DEFAULT_MOBILE_THEME_ID,
  flattenThemeColor,
  getMobileThemeVariables,
  themeColorWithAlpha,
  type MobileThemeAppearance,
  type MobileThemeId,
  type MobileThemeVariables,
} from "./mobileTheme";

const defaults = defaultThemeVariables as Readonly<
  Record<MobileThemeAppearance, MobileThemeVariables>
>;

/**
 * Complete palette for native and third-party APIs that cannot consume a
 * Uniwind className. Every palette shares the source that generates its
 * registered CSS theme.
 */
export function getMobileThemeRuntimeVariables(
  themeId: MobileThemeId,
  appearance: MobileThemeAppearance,
  platform: string,
): MobileThemeVariables {
  const usesDefaultPalette = themeId === DEFAULT_MOBILE_THEME_ID || themeId === "material-you";
  const variables = usesDefaultPalette
    ? defaults[appearance]
    : getMobileThemeVariables(themeId, appearance);
  // Light iPad sidebars reuse Android's tonal frame. Their row states must
  // be composited over that frame rather than over the original page canvas.
  // Named palettes and dark sidebars retain their shared semantic roles.
  const frame = themeColorWithAlpha(
    variables[usesDefaultPalette ? "--color-row-hover" : "--color-drawer"],
    1,
  );
  if (platform === "ios" && usesDefaultPalette && appearance === "light") {
    const drawer = flattenThemeColor(frame, variables["--color-screen"]);
    const rowInk = variables["--color-drawer-foreground"];
    return {
      ...variables,
      "--color-header": frame,
      "--color-header-foreground": variables["--color-drawer-foreground"],
      "--color-drawer": frame,
      "--color-drawer-foreground-muted": variables["--color-foreground-muted"],
      "--color-thread-hover": flattenThemeColor(themeColorWithAlpha(rowInk, 0.03), drawer),
      "--color-thread-selected": flattenThemeColor(themeColorWithAlpha(rowInk, 0.06), drawer),
    };
  }
  if (platform !== "android") return variables;

  return {
    ...variables,
    "--color-header": frame,
    "--color-header-foreground": variables["--color-drawer-foreground"],
  };
}
