import {
  NeoPiThemesConfiguration,
  NeoPiThemesError,
  NeoPiThemePalette,
  type NeoPiThemePaletteInput,
  type NeoPiModelsTarget,
  type NeoPiThemesInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import type { NeoPiModelsConnection } from "./NeoPiModelsConnection.ts";

const themeError = (cause: unknown) =>
  new NeoPiThemesError({
    message: cause instanceof Error ? cause.message : "Could not read the connected NeoPi themes.",
  });
export type NeoPiThemesConnection<E> = (
  target: NeoPiModelsTarget,
) => Effect.Effect<NeoPiModelsConnection, E, Scope.Scope>;

/** Shares the native configuration transport. No GUI inventory or settings files. */
export function makeNeoPiThemes<E>(connection: NeoPiThemesConnection<E>) {
  const requireSupported = Effect.fnUntraced(function* (
    native: NeoPiModelsConnection,
    capability: "themes_configuration" | "theme_palette",
  ) {
    yield* native.validate;
    if (!native.capabilities.has(capability)) {
      return yield* new NeoPiThemesError({
        message:
          "This NeoPi executable does not support reading these themes. Update NeoPi in NeoCore and reconnect.",
      });
    }
  });
  const readConnection = Effect.fnUntraced(function* (native: NeoPiModelsConnection) {
    yield* requireSupported(native, "themes_configuration");
    const result = yield* native.request({ type: "get_themes_configuration" });
    yield* native.validate;
    return yield* Schema.decodeUnknownEffect(NeoPiThemesConfiguration)(result);
  });
  const read = (input: NeoPiThemesInput) =>
    Effect.scoped(Effect.flatMap(connection(input.target), readConnection)).pipe(
      Effect.mapError(themeError),
    );
  const palette = (input: NeoPiThemePaletteInput) =>
    Effect.scoped(
      Effect.gen(function* () {
        const native = yield* connection(input.target);
        yield* requireSupported(native, "theme_palette");
        const result = yield* native.request({ type: "get_theme", name: input.name });
        yield* native.validate;
        return yield* Schema.decodeUnknownEffect(NeoPiThemePalette)(result);
      }),
    ).pipe(Effect.mapError(themeError));
  return { read, palette };
}
