import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

export const neopiSessionList = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:neopi-sessions:list",
  tag: WS_METHODS.neopiSessionsList,
  staleTimeMs: 5_000,
  idleTtlMs: 60_000,
});

export const neopiSessionResume = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:neopi-sessions:resume",
  tag: WS_METHODS.neopiSessionsResume,
});

export const neopiSessionHandoff = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:neopi-sessions:handoff",
  tag: WS_METHODS.neopiSessionsHandoff,
});

export const neopiSessionConfiguration = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:neopi-sessions:configuration",
  tag: WS_METHODS.neopiSessionsConfiguration,
});
