import type { NeoPiSessionConfigurationResult, ThreadId } from "@t3tools/contracts";
import type { NeoPiConfigurationIdentity } from "../neopi/NeoPiSessionConfiguration.ts";
import type * as Effect from "effect/Effect";
import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

/** Per-instance NeoPi/OMP JSONL RPC adapter contract. */
export interface NeoPiAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly getConfiguration: (
    threadId: ThreadId,
    expected: NeoPiConfigurationIdentity,
  ) => Effect.Effect<NeoPiSessionConfigurationResult, ProviderAdapterError>;
  readonly getLiveUsage: (
    activeProvider: string,
  ) => Effect.Effect<unknown | undefined, ProviderAdapterError>;
}
