import type { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";

import { ProviderSettingsPanel } from "../settings/ProviderSettingsPanel";

/** Edits the selected environment's existing NeoPi launch configuration. */
export function NeoCoreSettingsPanel({
  environmentId,
  instanceId,
}: {
  readonly environmentId: EnvironmentId;
  readonly instanceId?: ProviderInstanceId;
}) {
  return (
    <>
      <div className="px-6 pt-6 text-sm text-muted-foreground">
        NeoCode starts NeoPi on the selected environment when a session needs it. These settings
        configure that launch, not a separate daemon. Opening this page or selecting a runtime
        profile does not start or restart a session. Model catalogs are managed separately.
      </div>
      <ProviderSettingsPanel
        environmentId={environmentId}
        {...(instanceId ? { instanceId } : {})}
        scoped
        neoCore
      />
    </>
  );
}
