import { describe, expect, it } from "vite-plus/test";

import {
  dictationCursor,
  dictationInsertion,
  dictationStatusLabel,
} from "./composerDictation.logic";

describe("composer dictation", () => {
  it("separates spoken text from neighbouring words only where needed", () => {
    expect(dictationInsertion("", 0, " hello world ")).toBe("hello world");
    expect(dictationInsertion("fix", 3, "the bug")).toBe(" the bug");
    expect(dictationInsertion("fix ", 4, "the bug")).toBe("the bug");
    expect(dictationInsertion("fix the", 3, "that")).toBe(" that");
    expect(dictationInsertion("fixthe", 3, "that")).toBe(" that ");
    expect(dictationInsertion("fix\nthe", 4, "that")).toBe("that ");
    expect(dictationInsertion("anything", 3, "  \n ")).toBe("");
  });

  it("keeps the cursor from the start unless the draft changed during the capture", () => {
    const anchor = { prompt: "hello", cursor: 2 };
    expect(dictationCursor(anchor, "hello", 5)).toBe(2);
    expect(dictationCursor(anchor, "hello there", 11)).toBe(11);
    expect(dictationCursor({ prompt: "hello", cursor: 9 }, "hello", 5)).toBe(5);
  });

  it("names the shortcut only when one is bound", () => {
    expect(dictationStatusLabel("recording", "Ctrl+Space")).toContain("or Ctrl+Space to stop");
    expect(dictationStatusLabel("recording", null)).not.toContain(" or ");
  });
});
