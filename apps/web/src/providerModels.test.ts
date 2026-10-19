import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelCapabilities,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { getProviderModelCapabilities, resolveSelectableProvider } from "./providerModels";

const PROVIDER = ProviderDriverKind.make("claudeAgent");

function capabilities(id: string): ModelCapabilities {
  return {
    optionDescriptors: [{ id, label: id, type: "boolean" }],
  };
}

function model(input: {
  slug: string;
  capabilities: ModelCapabilities;
  aliases?: ReadonlyArray<string>;
  isCustom?: boolean;
}): ServerProviderModel {
  return {
    slug: input.slug,
    name: input.slug,
    ...(input.aliases ? { aliases: [...input.aliases] } : {}),
    isCustom: input.isCustom ?? false,
    capabilities: input.capabilities,
  };
}

describe("getProviderModelCapabilities", () => {
  it("resolves model-declared aliases", () => {
    const aliasCapabilities = capabilities("aliased-option");
    const models = [
      model({
        slug: "synthetic-model",
        aliases: ["Legacy-Synthetic-Model"],
        capabilities: aliasCapabilities,
      }),
    ];

    expect(getProviderModelCapabilities(models, "legacy-synthetic-model", PROVIDER)).toEqual(
      aliasCapabilities,
    );
  });

  it("prefers an exact custom slug over a built-in model alias", () => {
    const customCapabilities = capabilities("custom-option");
    const models = [
      model({
        slug: "synthetic-model",
        aliases: ["custom-model"],
        capabilities: capabilities("built-in-option"),
      }),
      model({ slug: "custom-model", capabilities: customCapabilities, isCustom: true }),
    ];

    expect(getProviderModelCapabilities(models, " custom-model ", PROVIDER)).toEqual(
      customCapabilities,
    );
  });

  it("returns empty capabilities for an unknown slug", () => {
    const models = [
      model({
        slug: "default-model",
        capabilities: capabilities("default-option"),
      }),
    ];

    expect(getProviderModelCapabilities(models, "unknown-model", PROVIDER)).toEqual({
      optionDescriptors: [],
    });
  });
});

describe("resolveSelectableProvider", () => {
  function provider(driver: string, overrides: Partial<ServerProvider> = {}): ServerProvider {
    return {
      driver: ProviderDriverKind.make(driver),
      instanceId: ProviderInstanceId.make(driver),
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-01-01T00:00:00.000Z",
      models: [model({ slug: "fixture-model", capabilities: {} })],
      slashCommands: [],
      skills: [],
      ...overrides,
    };
  }

  it("uses the NeoPi-first fallback for an unset or removed legacy selection", () => {
    const providers = [provider("codex"), provider("neopi")];

    expect(resolveSelectableProvider(providers, null)).toBe("neopi");
    expect(resolveSelectableProvider(providers, ProviderInstanceId.make("removed"))).toBe("neopi");
  });

  it("keeps an explicitly selected custom instance's driver even after a probe error", () => {
    const selected = provider("claudeAgent", {
      instanceId: ProviderInstanceId.make("claude_work"),
      status: "error",
    });

    expect(resolveSelectableProvider([provider("neopi"), selected], selected.instanceId)).toBe(
      "claudeAgent",
    );
  });

  it.each([
    { enabled: false },
    { availability: "unavailable" as const },
    { status: "error" as const },
    { status: "warning" as const },
    { models: [] },
  ])("uses a healthy alternative when NeoPi cannot become the default: %j", (state) => {
    expect(
      resolveSelectableProvider([provider("neopi", state), provider("codex")], undefined),
    ).toBe("codex");
  });
});
