import { describe, expect, it } from "vite-plus/test";
import type { NeoPiModelsConfiguration, NeoPiNativeModel } from "@t3tools/contracts";
import {
  isModelRuleSelectorValid,
  modelContextLabel,
  modelDisplayName,
  modelEffortLabel,
  modelProviderGroups,
  modelRoleForScope,
  modelsForView,
  moveModelItem,
} from "./modelsPresentation";

describe("Models catalog presentation", () => {
  it("uses a model's id instead of empty or descriptive names", () => {
    expect(modelDisplayName({ id: "model-id", name: " " })).toBe("model-id");
    expect(modelDisplayName({ id: "model-id", name: "x".repeat(48) })).toBe("x".repeat(48));
    expect(modelDisplayName({ id: "model-id", name: "x".repeat(49) })).toBe("model-id");
    expect(modelDisplayName({ id: "model-id", name: "  Model name  " })).toBe("Model name");
  });

  it("formats native binary-million context and keeps unknown separate from zero", () => {
    expect(modelContextLabel(1_048_576)).toBe("1M");
    expect(modelContextLabel(272_000)).toBe("272K");
    expect(modelContextLabel(null)).toBe("—");
    expect(modelContextLabel(0)).toBe("0");
  });

  it("collapses only contiguous canonical effort runs, regardless of input order", () => {
    expect(modelEffortLabel(["xhigh", "low", "high", "medium"])).toBe("low–xhigh");
    expect(modelEffortLabel(["max", "off", "high", "xhigh"])).toBe("off, high–max");
    expect(modelEffortLabel(["low", "high"])).toBe("low, high");
    expect(modelEffortLabel(["max", "max"])).toBe("max");
    expect(modelEffortLabel([])).toBe("—");
  });
});

describe("Models ordered rule edits", () => {
  it("moves exactly one item without changing the source or out-of-range order", () => {
    const items = ["exact/model", "re:^provider/", "provider/*"];
    expect(moveModelItem(items, 1, -1)).toEqual(["re:^provider/", "exact/model", "provider/*"]);
    expect(moveModelItem(items, 1, 1)).toEqual(["exact/model", "provider/*", "re:^provider/"]);
    expect(moveModelItem(items, 0, -1)).toEqual(items);
    expect(items).toEqual(["exact/model", "re:^provider/", "provider/*"]);
  });

  it("prevents malformed explicit regexes and missing provider/model parts before save", () => {
    expect(isModelRuleSelectorValid("re:[")).toBe(false);
    expect(isModelRuleSelectorValid("re:^gpt-6")).toBe(true);
    expect(isModelRuleSelectorValid("anthropic/*")).toBe(true);
    expect(isModelRuleSelectorValid("*gpt*")).toBe(false);
    expect(isModelRuleSelectorValid("/gpt*")).toBe(false);
    expect(isModelRuleSelectorValid("openai*/")).toBe(false);
    expect(isModelRuleSelectorValid("provider/model")).toBe(true);
    expect(isModelRuleSelectorValid("provider/")).toBe(false);
    expect(isModelRuleSelectorValid("/model")).toBe(false);
    expect(isModelRuleSelectorValid("")).toBe(false);
  });
});

describe("native Ready provider catalog", () => {
  const provider = (
    id: string,
    available: boolean,
    authenticated: boolean,
  ): NeoPiModelsConfiguration["providers"][number] => ({
    id,
    name: `A misleading login name for ${id}`,
    mark: { text: "unused", seed: id, icon: "" },
    available,
    authenticated,
    authSource: null,
    disabled: false,
    acceptsKeys: true,
    loginProviders: [],
    envVars: [],
  });
  const model = (provider: string, id: string, available = true): NeoPiNativeModel => ({
    provider,
    id,
    name: `Display ${id}`,
    available,
    kind: "chat",
    contextWindow: null,
    effectiveContextWindow: 0,
    maxTokens: null,
    reasoning: false,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    supportsFastMode: false,
    supportedThinkingLevels: [],
    permittedEfforts: [],
  });
  const configuration = {
    providers: [
      provider("z-public", true, false),
      provider("a-signed-in", false, true),
      provider("m-ready", true, true),
    ],
    models: [
      model("a-signed-in", "catalog-only", false),
      model("z-public", "anonymous"),
      model("m-ready", "private"),
    ],
  };

  it("groups and sorts exact provider ids by availability, not authentication or login names", () => {
    const groups = modelProviderGroups(configuration.providers, "");
    expect(groups.ready.map((provider) => provider.id)).toEqual(["m-ready", "z-public"]);
    expect(groups.notSetUp.map((provider) => provider.id)).toEqual(["a-signed-in"]);
    expect(
      modelProviderGroups(configuration.providers, " PUBLIC ").ready.map((provider) => provider.id),
    ).toEqual(["z-public"]);
  });

  it("keeps unconfigured provider catalogs visible but excludes them from All models", () => {
    expect(modelsForView(configuration, null, "").map((model) => model.id)).toEqual([
      "anonymous",
      "private",
    ]);
    expect(modelsForView(configuration, "a-signed-in", "").map((model) => model.id)).toEqual([
      "catalog-only",
    ]);
    expect(
      modelsForView(configuration, null, " DISPLAY PRIVATE ").map((model) => model.id),
    ).toEqual(["private"]);
    expect(modelsForView(configuration, null, "a-signed-in")).toEqual([]);
    expect(configuration.models.map((model) => model.id)).toEqual([
      "catalog-only",
      "anonymous",
      "private",
    ]);
  });
});

describe("native role editing scopes", () => {
  const globalEffort = { mode: "fixed", level: "high" } as const;
  const role = {
    global: { selector: "@advisor:high", effort: globalEffort },
    project: { selector: "re:^project/", effort: null },
    resolved: { provider: "runtime", modelId: "overlay" },
    scopedResolutions: {
      global: { provider: "global-provider", modelId: "global" },
      project: { provider: "project-provider", modelId: "project" },
    },
  };
  it("uses the edited native scope rather than runtime resolution or selector parsing", () => {
    expect(modelRoleForScope(role, "global")).toEqual({
      selector: "@advisor:high",
      effort: globalEffort,
      resolution: role.scopedResolutions.global,
    });
    expect(modelRoleForScope(role, "project")).toEqual({
      selector: "re:^project/",
      effort: globalEffort,
      resolution: role.scopedResolutions.project,
    });
  });
  it("inherits selector and effort independently and keeps unresolved aliases unresolved", () => {
    const projectEffort = { mode: "fixed", level: "low" } as const;
    expect(
      modelRoleForScope(
        {
          ...role,
          project: { selector: null, effort: projectEffort },
          scopedResolutions: { ...role.scopedResolutions, project: null },
        },
        "project",
      ),
    ).toEqual({
      selector: "@advisor:high",
      effort: projectEffort,
      resolution: null,
    });
  });
});
