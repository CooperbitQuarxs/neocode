import type { ProviderInstanceId, ServerSettings, ServerSettingsPatch } from "@t3tools/contracts";

/** Called inside the settings write lock after probing; a user edit always wins. */
export function neoPiBinarySelectionPatch(
  before: ServerSettings,
  current: ServerSettings,
  instanceId: ProviderInstanceId,
  binary: string,
  bundled = false,
): ServerSettingsPatch | null {
  const expected = before.providerInstances[instanceId];
  const instance = current.providerInstances[instanceId];
  if (JSON.stringify(expected) !== JSON.stringify(instance)) return null;
  if (instance) {
    if (instance.driver !== "neopi") return null;
    const config = instance.config;
    if (
      config !== undefined &&
      (config === null || typeof config !== "object" || Array.isArray(config))
    )
      return null;
    const fields = (config ?? {}) as Record<string, unknown>;
    if (bundled && fields.autoSelectedBinaryPath === binary) return null;
    if (fields.binaryPath && fields.binaryPath !== "npi") return null;
    return {
      providerInstances: {
        ...current.providerInstances,
        [instanceId]: {
          ...instance,
          config: {
            ...fields,
            // AppImage resource paths are mount-specific; keep automatic resolution on restart.
            ...(!bundled ? { binaryPath: binary } : {}),
            autoSelectedBinaryPath: binary,
          },
        },
      },
    };
  }
  if (instanceId !== "neopi") return null;
  if (JSON.stringify(before.providers.neopi) !== JSON.stringify(current.providers.neopi))
    return null;
  const configured = current.providers.neopi.binaryPath;
  if (configured && configured !== "npi") return null;
  if (bundled && current.providers.neopi.autoSelectedBinaryPath === binary) return null;
  return {
    providers: {
      neopi: { ...(!bundled ? { binaryPath: binary } : {}), autoSelectedBinaryPath: binary },
    },
  };
}
