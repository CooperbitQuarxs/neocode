import * as Schema from "effect/Schema";
import { NeoPiModelsTarget } from "./neopiModels.ts";

export const NeoPiThemeSelection = Schema.Struct({
  effective: Schema.String,
  global: Schema.NullOr(Schema.String),
  project: Schema.NullOr(Schema.String),
  colors: Schema.Record(Schema.String, Schema.String),
});
export const NeoPiThemesConfiguration = Schema.Struct({
  themes: Schema.Array(Schema.String),
  selection: Schema.Struct({ dark: NeoPiThemeSelection, light: NeoPiThemeSelection }),
});
export type NeoPiThemesConfiguration = typeof NeoPiThemesConfiguration.Type;
export const NeoPiThemesInput = Schema.Struct({ target: NeoPiModelsTarget });
export type NeoPiThemesInput = typeof NeoPiThemesInput.Type;
export const NeoPiThemePaletteInput = Schema.Struct({
  target: NeoPiModelsTarget,
  name: Schema.String,
});
export type NeoPiThemePaletteInput = typeof NeoPiThemePaletteInput.Type;
export const NeoPiThemePalette = Schema.Struct({
  name: Schema.String,
  colors: Schema.Record(Schema.String, Schema.String),
});
export type NeoPiThemePalette = typeof NeoPiThemePalette.Type;
export class NeoPiThemesError extends Schema.TaggedError<NeoPiThemesError>()("NeoPiThemesError", {
  message: Schema.String,
}) {}
