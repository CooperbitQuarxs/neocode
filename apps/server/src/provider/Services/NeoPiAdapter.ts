import type { NeoPiSessionConfigurationResult, ThreadId } from "@t3tools/contracts";
import type { NeoPiConfigurationIdentity } from "../neopi/NeoPiSessionConfiguration.ts";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";
import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

/** Per-instance NeoPi/OMP JSONL RPC adapter contract. */
export interface NeoPiAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly observeConfiguration: (
    threadId: ThreadId,
    expected: NeoPiConfigurationIdentity,
  ) => Effect.Effect<
    {
      readonly read: Effect.Effect<NeoPiSessionConfigurationResult, ProviderAdapterError>;
      readonly changes: Stream.Stream<void>;
    },
    never,
    Scope.Scope
  >;
  readonly getConfiguration: (
    threadId: ThreadId,
    expected: NeoPiConfigurationIdentity,
  ) => Effect.Effect<NeoPiSessionConfigurationResult, ProviderAdapterError>;
  readonly getLiveUsage: (
    activeProvider: string,
  ) => Effect.Effect<unknown | undefined, ProviderAdapterError>;
}
