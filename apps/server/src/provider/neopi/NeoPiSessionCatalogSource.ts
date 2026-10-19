import type { ProviderInstance } from "../ProviderDriver.ts";

export interface NeoPiSessionCatalogSource {
  readonly binary: string;
  readonly env: Record<string, string>;
  readonly profile: string;
  /** The same mutable capability set refreshed by the driver's RPC probe. */
  readonly capabilities: ReadonlySet<string>;
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
