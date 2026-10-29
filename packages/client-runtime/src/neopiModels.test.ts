import { describe, expect, it } from "vite-plus/test";
import type { NeoPiModelsConfiguration } from "@t3tools/contracts";
import { formatNeoPiModelTokenLimit, getNeoPiModelsSelectorOptions } from "./neopiModels.ts";

describe("native Models limit presentation", () => {
  it("shows unknown native limits without inventing a zero-token capability", () => {
    expect(formatNeoPiModelTokenLimit(null)).toBe("Unknown");
    expect(formatNeoPiModelTokenLimit(null)).not.toBe(formatNeoPiModelTokenLimit(0));
  });

  it("retains explicit zero and known token budgets in the user's locale", () => {
    for (const tokens of [0, 32000, 262144]) {
      expect(formatNeoPiModelTokenLimit(tokens)).toBe(tokens.toLocaleString());
    }
  });
});

const configuration = (): NeoPiModelsConfiguration => ({
  providers: [],
  models: [],
  roles: [],
  roleStorage: "project",
  effortMode: "replacement",
  effortRules: [],
  effortRulesProvenance: "global",
  effortRuleScopes: { global: null, project: null },
  effortChoices: ["off", "high"],
});

describe("native Models assignment options", () => {
  it("preserves authored scoped patterns and role references instead of replacing them with resolutions", () => {
    const globalSelector = "re:^native/(large|small)$:auto";
    const projectSelector = "@advisor:high";
    const value: NeoPiModelsConfiguration = {
      ...configuration(),
      roles: [
        {
          id: "review",
          name: "Owner-defined review role",
          alias: "@review",
          hidden: false,
          source: "configured",
          section: "chat",
          patterns: [projectSelector],
          fallbacks: { chain: [], efforts: {} },
          fallbacksGlobal: { chain: [], efforts: {} },
          scopedResolutions: {
            global: { provider: "native", modelId: "small" },
            project: { provider: "native", modelId: "large", thinkingLevel: "high" },
          },
          configured: projectSelector,
          provenance: "project",
          resolved: { provider: "native", modelId: "large", thinkingLevel: "high" },
          effort: null,
          global: { selector: globalSelector, effort: null },
          project: { selector: projectSelector, effort: { mode: "fixed", level: "high" } },
        },
      ],
      effortRuleScopes: {
        global: [{ selector: "native/*", allowed: ["high"] }],
        project: [{ selector: "re:other/.+", allowed: ["off"] }],
      },
    };

    const options = getNeoPiModelsSelectorOptions(value, "");

    expect([...options.keys()]).toEqual(
      expect.arrayContaining([
        "@review",
        projectSelector,
        globalSelector,
        "native/*",
        "re:other/.+",
      ]),
    );
    expect(options.has("native/large")).toBe(false);
  });

  it("keeps a selected selector when a native refresh no longer contains that model", () => {
    const selected = "removed/model:high";
    const options = getNeoPiModelsSelectorOptions(configuration(), selected);

    expect(options.has(selected)).toBe(true);
    expect(options.has("")).toBe(false);
  });
});
