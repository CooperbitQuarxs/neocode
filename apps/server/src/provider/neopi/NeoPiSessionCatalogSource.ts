import type { ProviderInstance } from "../ProviderDriver.ts";

/** Last completed handshake, retained while refresh is in flight or fails. */
export interface NeoPiCapabilityProbe {
  status: "unprobed" | "compatible" | "unsupported";
  version: string | null;
  failure?: string;
}

export interface NeoPiSessionCatalogSource {
  readonly binary: string;
  readonly env: Record<string, string>;
  readonly profile: string;
  /** The same mutable capability set refreshed by the driver's RPC probe. */
  readonly capabilities: ReadonlySet<string>;
  readonly probe: NeoPiCapabilityProbe;
}

const sources = new WeakMap<ProviderInstance, NeoPiSessionCatalogSource>();

export function registerNeoPiSessionCatalogSource<T extends ProviderInstance>(
  instance: T,
  source: NeoPiSessionCatalogSource,
): T {
  sources.set(instance, source);
  return instance;
}

export const neoPiSessionCatalogSource = (instance: ProviderInstance) => sources.get(instance);

export const unregisterNeoPiSessionCatalogSource = (instance: ProviderInstance): void => {
  sources.delete(instance);
};
