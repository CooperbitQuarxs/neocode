import { projectTranscript } from "@t3tools/client-runtime/neopi-transcript";
import { describe, expect, it } from "vite-plus/test";
import { formatCost, previewLines } from "./agentFormat";

const message = (id: string, message: Record<string, unknown>) => ({
  id,
  parentId: null,
  type: "message",
  timestamp: "2026-10-29T00:00:00.000Z",
  message,
});

describe("agent transcript preview", () => {
  const rows = projectTranscript(
    {
      entries: [
        message("u1", { role: "user", content: "Inspect the protocol" }),
        message("a1", {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "private reasoning" },
            { type: "text", text: "Reading it now" },
            { type: "toolCall", id: "t1", name: "read", arguments: { path: "a.ts" } },
          ],
          stopReason: "toolUse",
        }),
        message("r1", {
          role: "toolResult",
          toolCallId: "t1",
          toolName: "read",
          content: [{ type: "text", text: "boom" }],
          isError: true,
        }),
      ],
      pending: [],
      leafId: "r1",
    },
    { debug: false },
  );

  it("keeps the newest lines in order, without reasoning, and flags failed tools", () => {
    const lines = previewLines(rows, 3);
    expect(lines.map((line) => line.kind)).toEqual(["user", "assistant", "tool"]);
    expect(lines.some((line) => line.text.includes("private reasoning"))).toBe(false);
    expect(lines.at(-1)?.error).toBe(true);
    expect(previewLines(rows, 2).map((line) => line.kind)).toEqual(["assistant", "tool"]);
  });
});

describe("formatCost", () => {
  it("never rounds a real spend down to zero", () => {
    expect(formatCost(0)).toBe("$0");
    expect(formatCost(0.004)).toBe("<$0.01");
    expect(formatCost(1.234)).toBe("$1.23");
  });
});
