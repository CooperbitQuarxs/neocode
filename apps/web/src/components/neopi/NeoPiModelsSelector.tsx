import type {
  EnvironmentId,
  NeoPiModelsConfiguration,
  NeoPiModelsTarget,
  ServerProvider,
} from "@t3tools/contracts";
import { useMemo } from "react";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { SETTINGS_PICKER_TRIGGER_CLASSNAME } from "../settings/settingsLayout";
import { modelDisplayName } from "./modelsPresentation";

/** A Models assignment uses the stock native selector, scoped to the exact NeoPi connection. */
export function NeoPiModelsSelector({
  configuration,
  environmentId,
  target,
  provider,
  scope,
  label,
  value,
  onChange,
  disabled = false,
  open,
  onOpenChange,
  exactOnly = false,
  selectionLabel,
}: {
  configuration: NeoPiModelsConfiguration;
  environmentId: EnvironmentId;
  target: NeoPiModelsTarget;
  provider: ServerProvider;
  scope: "global" | "project";
  label: string;
  value: string;
  onChange: (selector: string) => void;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  exactOnly?: boolean;
  selectionLabel?: string;
}) {
  const entries = useMemo(() => deriveProviderInstanceEntries([provider]), [provider]);
  const options = useMemo(
    () =>
      new Map([
        [
          provider.instanceId,
          configuration.models.map((model) => ({
            slug: `${model.provider}/${model.id}`,
            name: modelDisplayName(model),
            provider: "neopi" as const,
            subProvider: model.provider,
            isUnavailable: !model.available,
          })),
        ],
      ]),
    [configuration.models, provider.instanceId],
  );
  const selected = configuration.models.find((model) => `${model.provider}/${model.id}` === value);
  const role = configuration.roles.find((role) => role.alias === value);
  const resolution = role?.scopedResolutions[scope];
  const resolved =
    resolution &&
    configuration.models.find(
      (model) => model.provider === resolution.provider && model.id === resolution.modelId,
    );
  const triggerLabel = !value
    ? "Automatic"
    : selected?.available
      ? modelDisplayName(selected)
      : resolved
        ? modelDisplayName(resolved)
        : "Not available";
  return (
    <ProviderModelPicker
      activeInstanceId={provider.instanceId}
      selectorContext={{
        environmentId,
        ...(target.projectId ? { projectId: target.projectId } : {}),
        ...(target.sessionFile
          ? {
              connectedSession: {
                providerInstanceId: target.providerInstanceId,
                sessionFile: target.sessionFile,
              },
            }
          : {}),
      }}
      model={value}
      instanceEntries={entries}
      modelOptionsByInstance={options}
      lockedProvider={provider.driver}
      size="sm"
      disabled={disabled}
      triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
      triggerLabel={selectionLabel ?? triggerLabel}
      triggerAriaLabel={label}
      {...(exactOnly
        ? {
            getModelDisabledReason: (_: unknown, selector: string) =>
              configuration.models.some((model) => `${model.provider}/${model.id}` === selector)
                ? null
                : "Choose an exact model.",
          }
        : {})}
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange ? { onOpenChange } : {})}
      onInstanceModelChange={(_, selector) => onChange(selector)}
    />
  );
}
