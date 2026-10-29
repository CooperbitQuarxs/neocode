import { describe, expect, it } from "vite-plus/test";
import { formatNeoPiModelTokenLimit } from "./neopiModels.ts";

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
