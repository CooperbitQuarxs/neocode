import { describe, expect, it } from "vite-plus/test";
import type { ServerProviderModel } from "@t3tools/contracts";

import {
  describeModelCapabilities,
  groupModelsForDisplay,
  nextHiddenModelsForBulkToggle,
} from "./ProviderModelsSection";

function model(slug: string, isCustom = false): ServerProviderModel {
  return { slug, name: slug, isCustom, capabilities: null };
}

describe("groupModelsForDisplay", () => {
  it("lists favorites first, then visible models in user order, then hidden ones", () => {
    const models = [model("a"), model("b"), model("c"), model("d"), model("custom", true)];

    const display = groupModelsForDisplay(models, {
      favoriteModels: new Set(["c"]),
      hiddenModels: new Set(["a", "custom"]),
      modelOrder: ["d", "b"],
    });

    // A custom model is never hidden, even if its slug is in the hidden set.
    expect(display.map((entry) => entry.slug)).toEqual(["c", "d", "b", "custom", "a"]);
  });
});

describe("nextHiddenModelsForBulkToggle", () => {
  it("hides every built-in model without hiding custom models", () => {
    const models = [model("a"), model("b"), model("custom", true)];

    expect(nextHiddenModelsForBulkToggle(models, ["a"])).toEqual(["a", "b"]);
  });

  it("shows every built-in model while preserving unrelated hidden entries", () => {
    const models = [model("a"), model("b"), model("custom", true)];

    expect(nextHiddenModelsForBulkToggle(models, ["a", "b", "legacy", "custom"])).toEqual([
      "legacy",
      "custom",
    ]);
  });
});

describe("describeModelCapabilities", () => {
  it("shows native reasoning support without requiring configurable effort", () => {
    expect(
      describeModelCapabilities({
        ...model("@reasoner"),
        capabilities: { reasoning: true, optionDescriptors: [] },
      }),
    ).toEqual(["Reasoning"]);
  });

  it("retains legacy reasoning descriptors when native capability metadata is absent", () => {
    expect(
      describeModelCapabilities({
        ...model("proxy/model"),
        capabilities: {
          optionDescriptors: [
            {
              id: "reasoningEffort",
              type: "select",
              label: "Thinking",
              options: [{ id: "high", label: "High" }],
            },
          ],
        },
      }),
    ).toEqual(["Reasoning"]);
  });

  it("does not infer reasoning support from a role's name or slug", () => {
    expect(describeModelCapabilities(model("@reasoning-fast"))).toEqual([]);
  });

  it("uses explicit native reasoning metadata instead of stale effort descriptors", () => {
    expect(
      describeModelCapabilities({
        ...model("proxy/model"),
        capabilities: {
          reasoning: false,
          optionDescriptors: [
            {
              id: "reasoningEffort",
              type: "select",
              label: "Thinking",
              options: [{ id: "high", label: "High" }],
            },
          ],
        },
      }),
    ).toEqual([]);
  });

  it("describes available fast controls rather than their requested on/off value", () => {
    for (const currentValue of [true, false]) {
      expect(
        describeModelCapabilities({
          ...model("proxy/model"),
          capabilities: {
            optionDescriptors: [
              { id: "fastMode", type: "boolean", label: "Fast mode", currentValue },
            ],
          },
        }),
      ).toEqual(["Fast mode"]);
    }
  });
});
