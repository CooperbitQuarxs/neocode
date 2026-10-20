import { DEFAULT_SERVER_SETTINGS, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { neoPiBinarySelectionPatch } from "./NeoPiBinarySelection.ts";

const instanceId = ProviderInstanceId.make("neopi_work");
const before = {
  ...DEFAULT_SERVER_SETTINGS,
  providerInstances: {
    [instanceId]: {
      driver: ProviderDriverKind.make("neopi"),
      enabled: true,
      config: { binaryPath: "npi", profile: "work" },
    },
  },
};

describe("NeoPi executable selection persistence", () => {
  it("records bundled selection without pinning an AppImage mount or writing on every refresh", () => {
    const binary = "/mount/current/resources/bin/npi";
    const patch = neoPiBinarySelectionPatch(before, before, instanceId, binary, true);
    expect(patch).toEqual({
      providerInstances: {
        [instanceId]: {
          ...before.providerInstances[instanceId],
          config: { binaryPath: "npi", profile: "work", autoSelectedBinaryPath: binary },
        },
      },
    });
    const selected = {
      ...before,
      providerInstances: {
        [instanceId]: {
          ...before.providerInstances[instanceId],
          config: { binaryPath: "npi", profile: "work", autoSelectedBinaryPath: binary },
        },
      },
    };
    expect(neoPiBinarySelectionPatch(selected, selected, instanceId, binary, true)).toBeNull();
    const nextMount = "/mount/next/resources/bin/npi";
    expect(neoPiBinarySelectionPatch(selected, selected, instanceId, nextMount, true)).not.toBeNull();
  });

  it("preserves current sibling instances while saving the selected executable", () => {
    const siblingId = ProviderInstanceId.make("other");
    const sibling = { driver: ProviderDriverKind.make("codex"), config: {} };
    const current = {
      ...before,
      providerInstances: { ...before.providerInstances, [siblingId]: sibling },
    };
    expect(neoPiBinarySelectionPatch(before, current, instanceId, "/bin/npi-nightly")).toEqual({
      providerInstances: {
        [instanceId]: {
          ...before.providerInstances[instanceId],
          config: {
            binaryPath: "/bin/npi-nightly", profile: "work",
            autoSelectedBinaryPath: "/bin/npi-nightly",
          },
        },
        [siblingId]: sibling,
      },
    });
  });

  it("does not restore an instance removed while probing", () => {
    expect(neoPiBinarySelectionPatch(before, { ...before, providerInstances: {} }, instanceId, "/bin/npi-nightly")).toBeNull();
  });

  it("does not replace explicit settings or a changed provider environment", () => {
    const explicit = {
      ...before,
      providerInstances: {
        [instanceId]: {
          ...before.providerInstances[instanceId],
          config: { binaryPath: "/custom/omp" },
        },
      },
    };
    expect(neoPiBinarySelectionPatch(explicit, explicit, instanceId, "/bin/npi-nightly")).toBeNull();
    expect(neoPiBinarySelectionPatch(before, explicit, instanceId, "/bin/npi-nightly")).toBeNull();
    const changed = {
      ...before,
      providerInstances: {
        [instanceId]: {
          ...before.providerInstances[instanceId],
          environment: [{ name: "PATH", value: "/other/bin", sensitive: false }],
        },
      },
    };
    expect(neoPiBinarySelectionPatch(before, changed, instanceId, "/bin/npi-nightly")).toBeNull();
  });
});
