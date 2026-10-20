import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  applyProviderInstanceSettings,
  deriveProviderEntriesByEnvironment,
  deriveProviderInstanceEntries,
  getDefaultProviderInstanceModel,
  isProviderInstancePickerReady,
  isProviderInstancePickerVisible,
  resolveDefaultProviderModelSelection,
  resolveSelectableProviderInstance,
  sortProviderInstanceEntries,
} from "./providerInstances";
import { prioritizeNeoPiPickerEntries } from "./components/neopi/neopiPickerOrder";

function provider(input: {
  provider: ProviderDriverKind;
  instanceId: string;
  enabled?: boolean;
  availability?: ServerProvider["availability"];
  displayName?: string;
  accentColor?: string;
  status?: ServerProvider["status"];
  models?: ServerProvider["models"];
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: input.provider,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    enabled: input.enabled ?? true,
    installed: true,
    version: null,
    status: input.status ?? "ready",
    ...(input.availability ? { availability: input.availability } : {}),
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: input.models ?? [],
    slashCommands: [],
    skills: [],
  };
}

const model = (slug: string, isCustom = false, isDefault = false) => ({
  slug,
  name: slug,
  isCustom,
  ...(isDefault ? { isDefault: true } : {}),
  capabilities: {},
});

describe("NeoPi-first picker presentation", () => {
  it("moves NeoPi accounts first while preserving account and other-harness order", () => {
    const entries = deriveProviderInstanceEntries([
      provider({ provider: ProviderDriverKind.make("codex"), instanceId: "codex" }),
      provider({ provider: ProviderDriverKind.make("neopi"), instanceId: "neopi_work" }),
      provider({ provider: ProviderDriverKind.make("claudeAgent"), instanceId: "claudeAgent" }),
      provider({ provider: ProviderDriverKind.make("neopi"), instanceId: "neopi" }),
      provider({ provider: ProviderDriverKind.make("codex"), instanceId: "codex_personal" }),
    ]);
    const originalOrder = entries.map((entry) => entry.instanceId);

    expect(prioritizeNeoPiPickerEntries(entries).map((entry) => entry.instanceId)).toEqual([
      "neopi_work", "neopi", "codex", "claudeAgent", "codex_personal",
    ]);
    expect(entries.map((entry) => entry.instanceId)).toEqual(originalOrder);
  });

  it("keeps existing harness order when NeoPi is not configured", () => {
    const entries = deriveProviderInstanceEntries([
      provider({ provider: ProviderDriverKind.make("claudeAgent"), instanceId: "claudeAgent" }),
      provider({ provider: ProviderDriverKind.make("codex"), instanceId: "codex" }),
    ]);

    expect(prioritizeNeoPiPickerEntries(entries).map((entry) => entry.instanceId)).toEqual([
      "claudeAgent", "codex",
    ]);
  });
});

describe("isProviderInstancePickerReady", () => {
  it("rejects a disabled instance even while its last probe status is ready", () => {
    const [entry] = deriveProviderInstanceEntries([
      provider({
        provider: ProviderDriverKind.make("codex"),
        instanceId: "codex",
        enabled: false,
      }),
    ]);

    expect(entry?.status).toBe("ready");
    expect(entry && isProviderInstancePickerReady(entry)).toBe(false);
  });

  it("accepts an enabled, available, ready instance", () => {
    const [entry] = deriveProviderInstanceEntries([
      provider({ provider: ProviderDriverKind.make("codex"), instanceId: "codex" }),
    ]);

    expect(entry && isProviderInstancePickerReady(entry)).toBe(true);
  });
});

describe("isProviderInstancePickerVisible", () => {
  it("keeps enabled instances in the rail and removes disabled instances", () => {
    const [enabledEntry, disabledEntry] = deriveProviderInstanceEntries([
      provider({ provider: ProviderDriverKind.make("codex"), instanceId: "codex" }),
      provider({
        provider: ProviderDriverKind.make("claudeAgent"),
        instanceId: "claudeAgent",
        enabled: false,
      }),
    ]);

    expect(enabledEntry && isProviderInstancePickerVisible(enabledEntry)).toBe(true);
    expect(disabledEntry && isProviderInstancePickerVisible(disabledEntry)).toBe(false);
  });
});

describe("applyProviderInstanceSettings", () => {
  it("uses settings when a streamed snapshot still reports a disabled default as enabled", () => {
    const entries = deriveProviderInstanceEntries([
      provider({ provider: ProviderDriverKind.make("codex"), instanceId: "codex" }),
    ]);
    const [entry] = applyProviderInstanceSettings(entries, {
      providerInstances: {
        [ProviderInstanceId.make("codex")]: {
          driver: ProviderDriverKind.make("codex"),
          enabled: false,
        },
      },
      providers: {} as never,
    });

    expect(entry?.enabled).toBe(false);
  });

  it("treats a removed custom instance snapshot as disabled", () => {
    const entries = deriveProviderInstanceEntries([
      provider({
        provider: ProviderDriverKind.make("claudeAgent"),
        instanceId: "claude_work",
      }),
    ]);
    const [entry] = applyProviderInstanceSettings(entries, {
      providerInstances: {},
      providers: {} as never,
    });

    expect(entry?.enabled).toBe(false);
  });

  it.each(["constructor", "toString"])(
    "treats a removed custom instance named %s as disabled",
    (instanceId) => {
      const entries = deriveProviderInstanceEntries([
        provider({
          provider: ProviderDriverKind.make("claudeAgent"),
          instanceId,
        }),
      ]);
      const [entry] = applyProviderInstanceSettings(entries, {
        providerInstances: {},
        providers: {} as never,
      });

      expect(entry?.enabled).toBe(false);
    },
  );

  it("uses settings for a configured custom instance named constructor", () => {
    const instanceId = ProviderInstanceId.make("constructor");
    const entries = deriveProviderInstanceEntries([
      provider({
        provider: ProviderDriverKind.make("claudeAgent"),
        instanceId,
      }),
    ]);
    const [entry] = applyProviderInstanceSettings(entries, {
      providerInstances: {
        [instanceId]: {
          driver: ProviderDriverKind.make("claudeAgent"),
          enabled: false,
        },
      },
      providers: {} as never,
    });

    expect(entry?.enabled).toBe(false);
  });

  it("treats a removed default instance for a fork driver as disabled", () => {
    const driver = ProviderDriverKind.make("constructor");
    const entries = deriveProviderInstanceEntries([
      provider({
        provider: driver,
        instanceId: "constructor",
      }),
    ]);
    const [entry] = applyProviderInstanceSettings(entries, {
      providerInstances: {},
      providers: {} as never,
    });

    expect(entry?.isDefault).toBe(true);
    expect(entry?.enabled).toBe(false);
  });

  it("uses legacy settings for a built-in default instance", () => {
    const entries = deriveProviderInstanceEntries([
      provider({
        provider: ProviderDriverKind.make("codex"),
        instanceId: "codex",
      }),
    ]);
    const [entry] = applyProviderInstanceSettings(entries, {
      providerInstances: {},
      providers: { codex: { enabled: false } } as never,
    });

    expect(entry?.enabled).toBe(false);
  });
});

describe("deriveProviderInstanceEntries", () => {
  it("uses explicit instance id and driver kind from the snapshot", () => {
    const snapshot = provider({
      provider: ProviderDriverKind.make("codex"),
      instanceId: "codex_personal",
    });
    const [entry] = deriveProviderInstanceEntries([snapshot]);

    expect(entry?.instanceId).toBe("codex_personal");
    expect(entry?.driverKind).toBe("codex");
    expect(entry?.isDefault).toBe(false);
  });
});

describe("deriveProviderEntriesByEnvironment", () => {
  it("keeps same-id default instances distinct per environment", () => {
    const byEnvironment = deriveProviderEntriesByEnvironment([
      [
        "local",
        [
          provider({
            provider: ProviderDriverKind.make("claude"),
            instanceId: "claude",
            displayName: "Claude Local",
            accentColor: "#112233",
          }),
        ],
      ],
      [
        "remote",
        [
          provider({
            provider: ProviderDriverKind.make("claude"),
            instanceId: "claude",
            displayName: "Claude Remote",
            accentColor: "#445566",
          }),
        ],
      ],
    ]);

    expect(byEnvironment.get("local")?.get("claude")?.displayName).toBe("Claude Local");
    expect(byEnvironment.get("local")?.get("claude")?.accentColor).toBe("#112233");
    expect(byEnvironment.get("remote")?.get("claude")?.displayName).toBe("Claude Remote");
    expect(byEnvironment.get("remote")?.get("claude")?.accentColor).toBe("#445566");
  });

  it("never falls back to another environment's instances", () => {
    const byEnvironment = deriveProviderEntriesByEnvironment([
      ["local", [provider({ provider: ProviderDriverKind.make("codex"), instanceId: "codex" })]],
      ["empty", []],
    ]);

    expect(byEnvironment.get("empty")?.get("codex")).toBeUndefined();
    // Every environment gets its own bucket, so an absent lookup is a real
    // "this environment has no such instance", not a missing key.
    expect(byEnvironment.get("empty")?.size).toBe(0);
  });
});

describe("sortProviderInstanceEntries", () => {
  it("puts all NeoPi instances first, defaults before customs, and keeps other driver order", () => {
    const entries = deriveProviderInstanceEntries([
      provider({ provider: ProviderDriverKind.make("claudeAgent"), instanceId: "claude_work" }),
      provider({ provider: ProviderDriverKind.make("neopi"), instanceId: "neopi_work" }),
      provider({ provider: ProviderDriverKind.make("codex"), instanceId: "codex_work" }),
      provider({ provider: ProviderDriverKind.make("neopi"), instanceId: "neopi" }),
      provider({ provider: ProviderDriverKind.make("claudeAgent"), instanceId: "claudeAgent" }),
      provider({ provider: ProviderDriverKind.make("neopi"), instanceId: "neopi_personal" }),
      provider({ provider: ProviderDriverKind.make("codex"), instanceId: "codex" }),
    ]);
    const originalOrder = entries.map((entry) => entry.instanceId);

    expect(sortProviderInstanceEntries(entries).map((entry) => entry.instanceId)).toEqual([
      "neopi",
      "neopi_work",
      "neopi_personal",
      "claudeAgent",
      "claude_work",
      "codex",
      "codex_work",
    ]);
    expect(entries.map((entry) => entry.instanceId)).toEqual(originalOrder);
  });
});

describe("resolveSelectableProviderInstance", () => {
  it("returns the requested instance when it is enabled and available", () => {
    const requested = ProviderInstanceId.make("claude_work");
    const providers = [
      provider({ provider: ProviderDriverKind.make("codex"), instanceId: "codex" }),
      provider({ provider: ProviderDriverKind.make("claudeAgent"), instanceId: requested }),
    ];

    expect(resolveSelectableProviderInstance(providers, requested)).toBe(requested);
  });

  it("prefers the ready NeoPi default over wire-first providers and custom instances", () => {
    const providers = [
      provider({ provider: ProviderDriverKind.make("codex"), instanceId: "codex" }),
      provider({
        provider: ProviderDriverKind.make("neopi"),
        instanceId: "neopi_work",
        models: [model("native-work-model")],
      }),
      provider({
        provider: ProviderDriverKind.make("neopi"),
        instanceId: "neopi",
        models: [model("native-default")],
      }),
    ];

    expect(resolveSelectableProviderInstance(providers, undefined)).toBe("neopi");
    expect(
      resolveSelectableProviderInstance(providers, ProviderInstanceId.make("removed_instance")),
    ).toBe("neopi");
    expect(
      resolveSelectableProviderInstance(providers, ProviderInstanceId.make("neopi_work")),
    ).toBe("neopi_work");
    expect(resolveSelectableProviderInstance(providers, ProviderInstanceId.make("codex"))).toBe(
      "codex",
    );
  });

  it.each([
    { enabled: false },
    { availability: "unavailable" as const },
    { status: "error" as const },
    { status: "warning" as const },
  ])("keeps a healthy fallback when NeoPi is not ready: %j", (state) => {
    const providers = [
      provider({
        provider: ProviderDriverKind.make("neopi"),
        instanceId: "neopi",
        models: [model("native-default")],
        ...state,
      }),
      provider({ provider: ProviderDriverKind.make("codex"), instanceId: "codex" }),
    ];

    expect(resolveSelectableProviderInstance(providers, undefined)).toBe("codex");
  });

  it("can choose a ready custom NeoPi instance when the default cannot start", () => {
    const providers = [
      provider({ provider: ProviderDriverKind.make("codex"), instanceId: "codex" }),
      provider({
        provider: ProviderDriverKind.make("neopi"),
        instanceId: "neopi",
        status: "error",
      }),
      provider({
        provider: ProviderDriverKind.make("neopi"),
        instanceId: "neopi_work",
        models: [model("native-work-model")],
      }),
    ];

    expect(resolveSelectableProviderInstance(providers, undefined)).toBe("neopi_work");
  });

  it("falls back to the first enabled and available instance", () => {
    const disabled = ProviderInstanceId.make("codex");
    const fallback = ProviderInstanceId.make("claudeAgent");
    const providers = [
      provider({
        provider: ProviderDriverKind.make("codex"),
        instanceId: disabled,
        enabled: false,
      }),
      provider({ provider: ProviderDriverKind.make("claudeAgent"), instanceId: fallback }),
    ];

    expect(resolveSelectableProviderInstance(providers, disabled)).toBe(fallback);
  });

  it("prefers a ready instance over an enabled one whose driver cannot start", () => {
    const notInstalled = ProviderInstanceId.make("codex");
    const ready = ProviderInstanceId.make("claudeAgent");
    const providers = [
      provider({
        provider: ProviderDriverKind.make("codex"),
        instanceId: notInstalled,
        status: "error",
      }),
      provider({ provider: ProviderDriverKind.make("claudeAgent"), instanceId: ready }),
    ];

    expect(resolveSelectableProviderInstance(providers, undefined)).toBe(ready);
  });

  it("prefers an unprobed (warning) instance over one whose probe errored", () => {
    const notInstalled = ProviderInstanceId.make("codex");
    const unprobed = ProviderInstanceId.make("claudeAgent");
    const providers = [
      provider({
        provider: ProviderDriverKind.make("codex"),
        instanceId: notInstalled,
        status: "error",
      }),
      provider({
        provider: ProviderDriverKind.make("claudeAgent"),
        instanceId: unprobed,
        status: "warning",
      }),
    ];

    expect(resolveSelectableProviderInstance(providers, undefined)).toBe(unprobed);
  });

  it("keeps a requested instance even when its probe errored", () => {
    const requested = ProviderInstanceId.make("codex");
    const providers = [
      provider({
        provider: ProviderDriverKind.make("codex"),
        instanceId: requested,
        status: "error",
      }),
      provider({ provider: ProviderDriverKind.make("claudeAgent"), instanceId: "claudeAgent" }),
    ];

    expect(resolveSelectableProviderInstance(providers, requested)).toBe(requested);
  });

  it("does not invent an errored instance as a new-user default", () => {
    const notInstalled = ProviderInstanceId.make("codex");
    const providers = [
      provider({
        provider: ProviderDriverKind.make("codex"),
        instanceId: notInstalled,
        status: "error",
      }),
    ];

    expect(resolveSelectableProviderInstance(providers, undefined)).toBeUndefined();
  });

  it("does not return disabled, unavailable, or unknown instances when none are sendable", () => {
    const disabled = ProviderInstanceId.make("codex");
    const unavailable = ProviderInstanceId.make("claudeAgent");
    const unknown = ProviderInstanceId.make("removed_instance");
    const providers = [
      provider({
        provider: ProviderDriverKind.make("codex"),
        instanceId: disabled,
        enabled: false,
      }),
      provider({
        provider: ProviderDriverKind.make("claudeAgent"),
        instanceId: unavailable,
        availability: "unavailable",
      }),
    ];

    expect(resolveSelectableProviderInstance(providers, disabled)).toBeUndefined();
    expect(resolveSelectableProviderInstance(providers, unavailable)).toBeUndefined();
    expect(resolveSelectableProviderInstance(providers, unknown)).toBeUndefined();
  });
});

describe("getDefaultProviderInstanceModel", () => {
  it("uses the instance's own models, not the default instance of the kind", () => {
    const providers = [
      provider({
        provider: ProviderDriverKind.make("claudeAgent"),
        instanceId: "claude_openrouter",
        models: [model("openai/gpt-5.5", true), model("claude-opus-4-8")],
      }),
      provider({
        provider: ProviderDriverKind.make("claudeAgent"),
        instanceId: "claudeAgent",
        models: [model("claude-sonnet-5")],
      }),
    ];

    expect(
      getDefaultProviderInstanceModel(providers, ProviderInstanceId.make("claude_openrouter")),
    ).toBe("claude-opus-4-8");
  });

  it("falls back to the driver default when the instance reports no models", () => {
    const providers = [
      provider({ provider: ProviderDriverKind.make("claudeAgent"), instanceId: "claudeAgent" }),
    ];

    const resolved = getDefaultProviderInstanceModel(
      providers,
      ProviderInstanceId.make("claudeAgent"),
    );
    expect(typeof resolved).toBe("string");
    expect(resolved?.length).toBeGreaterThan(0);
  });

  it("honors the instance's declared default before model-list order", () => {
    const providers = [
      provider({
        provider: ProviderDriverKind.make("claudeAgent"),
        instanceId: "claudeAgent",
        models: [model("claude-sonnet-5"), model("claude-opus-4-8", false, true)],
      }),
    ];

    expect(getDefaultProviderInstanceModel(providers, ProviderInstanceId.make("claudeAgent"))).toBe(
      "claude-opus-4-8",
    );
  });

  it("returns undefined for an unknown instance", () => {
    expect(
      getDefaultProviderInstanceModel([], ProviderInstanceId.make("removed_instance")),
    ).toBeUndefined();
  });
});

describe("resolveDefaultProviderModelSelection", () => {
  it("uses a healthy alternative when NeoPi has no model to seed a new thread", () => {
    const providers = [
      provider({ provider: ProviderDriverKind.make("neopi"), instanceId: "neopi", models: [] }),
      provider({
        provider: ProviderDriverKind.make("codex"),
        instanceId: "codex",
        models: [model("codex-default", false, true)],
      }),
    ];
    expect(resolveDefaultProviderModelSelection(providers, null)).toEqual({
      instanceId: "codex",
      model: "codex-default",
    });

    const saved = { instanceId: ProviderInstanceId.make("neopi"), model: "saved-custom-model" };
    expect(resolveDefaultProviderModelSelection(providers, saved)).toBe(saved);
  });
  it.each([
    ["codex", "codex", "gpt-5.6"],
    ["claudeAgent", "claudeAgent", "claude-fable-5"],
    ["cursor", "cursor", "composer-2"],
  ])("uses the only available %s instance", (driver, instanceId, modelSlug) => {
    const providers = [
      provider({
        provider: ProviderDriverKind.make(driver),
        instanceId,
        models: [model(modelSlug, false, true)],
      }),
    ];

    expect(resolveDefaultProviderModelSelection(providers, null)).toEqual({
      instanceId,
      model: modelSlug,
    });
  });

  it("preserves a valid stored selection including its options", () => {
    const providers = [
      provider({
        provider: ProviderDriverKind.make("claudeAgent"),
        instanceId: "claudeAgent",
        models: [model("claude-opus-4-8")],
      }),
      provider({
        provider: ProviderDriverKind.make("neopi"),
        instanceId: "neopi",
        models: [model("neopi-default", false, true)],
      }),
    ];
    const stored = {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "custom-model",
      options: [{ id: "effort", value: "high" }],
    };

    expect(resolveDefaultProviderModelSelection(providers, stored)).toBe(stored);
  });

  it("replaces a stale stored instance with ready NeoPi and its own default model", () => {
    const providers = [
      provider({
        provider: ProviderDriverKind.make("codex"),
        instanceId: "codex",
        status: "warning",
        models: [model("gpt-5.6")],
      }),
      provider({
        provider: ProviderDriverKind.make("claudeAgent"),
        instanceId: "claudeAgent",
        models: [model("claude-opus-4-8", false, true)],
      }),
    ];
    providers.push(
      provider({
        provider: ProviderDriverKind.make("neopi"),
        instanceId: "neopi",
        models: [model("neopi-default", false, true)],
      }),
    );

    expect(
      resolveDefaultProviderModelSelection(providers, {
        instanceId: ProviderInstanceId.make("removed-provider"),
        model: "stale-model",
      }),
    ).toEqual({ instanceId: "neopi", model: "neopi-default" });
  });

  it.each([{ enabled: false }, { availability: "unavailable" as const }])(
    "replaces an unavailable stored instance deterministically",
    (requestedState) => {
      const providers = [
        provider({
          provider: ProviderDriverKind.make("codex"),
          instanceId: "codex",
          models: [model("gpt-5.6")],
          ...requestedState,
        }),
        provider({
          provider: ProviderDriverKind.make("claudeAgent"),
          instanceId: "claudeAgent",
          models: [model("claude-opus-4-8", false, true)],
        }),
      ];

      expect(
        resolveDefaultProviderModelSelection(providers, {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.6",
        }),
      ).toEqual({ instanceId: "claudeAgent", model: "claude-opus-4-8" });
    },
  );

  it("returns no selection for empty, disabled, unavailable, or error-only profiles", () => {
    expect(resolveDefaultProviderModelSelection([], null)).toBeNull();
    expect(
      resolveDefaultProviderModelSelection(
        [
          provider({
            provider: ProviderDriverKind.make("codex"),
            instanceId: "codex",
            enabled: false,
          }),
        ],
        null,
      ),
    ).toBeNull();
    expect(
      resolveDefaultProviderModelSelection(
        [
          provider({
            provider: ProviderDriverKind.make("codex"),
            instanceId: "codex",
            availability: "unavailable",
          }),
        ],
        null,
      ),
    ).toBeNull();
    expect(
      resolveDefaultProviderModelSelection(
        [
          provider({
            provider: ProviderDriverKind.make("codex"),
            instanceId: "codex",
            status: "error",
          }),
        ],
        null,
      ),
    ).toBeNull();
  });
});
