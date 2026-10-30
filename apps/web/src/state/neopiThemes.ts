import { createNeoPiThemesState } from "@t3tools/client-runtime/state/neopiThemes";
import { connectionAtomRuntime } from "../connection/runtime";

const state = createNeoPiThemesState(connectionAtomRuntime);
export const neopiThemesRead = state.read;
export const neopiThemesPalette = state.palette;
