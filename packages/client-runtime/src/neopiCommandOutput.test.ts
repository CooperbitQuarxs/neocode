import { describe, expect, it } from "vite-plus/test";
import { nativeCommandTextRuns } from "./neopiCommandOutput.ts";

const esc = "\u001b";
const plain = (text: string) => ({ text, bold: false, color: null });
const visible = (text: string) =>
  nativeCommandTextRuns(text)
    .map((run) => run.text)
    .join("");

describe("native command output presentation", () => {
  it("presents the observed context/usage SGR palette and Unicode bars", () => {
    // Colours, SGR forms and bar glyphs observed in the native /context capture.
    const text =
      `${esc}[1mContext${esc}[22m\n[` +
      `${esc}[38;2;98;114;164m░░${esc}[39m` +
      `${esc}[38;2;248;248;242m█${esc}[1m` +
      `${esc}[38;2;189;147;249m██${esc}[22m 42%${esc}[0m]\n` +
      "```";
    expect(nativeCommandTextRuns(text)).toEqual([
      { text: "Context", bold: true, color: null },
      plain("\n["),
      { text: "░░", bold: false, color: "rgb(98, 114, 164)" },
      { text: "█", bold: false, color: "rgb(248, 248, 242)" },
      { text: "██", bold: true, color: "rgb(189, 147, 249)" },
      { text: " 42%", bold: false, color: "rgb(189, 147, 249)" },
      plain("]\n```"),
    ]);
    expect(visible(text)).toBe("Context\n[░░███ 42%]\n```");
  });

  it("keeps colour and bold independent across newlines and resets both with zero or empty SGR", () => {
    const text =
      `${esc}[1;38;2;12;34;56mA\nB${esc}[22mC${esc}[1;39mD` +
      `${esc}[0mE${esc}[38;2;0;255;0mF${esc}[mG`;
    expect(nativeCommandTextRuns(text)).toEqual([
      { text: "A\nB", bold: true, color: "rgb(12, 34, 56)" },
      { text: "C", bold: false, color: "rgb(12, 34, 56)" },
      { text: "D", bold: true, color: null },
      plain("E"),
      { text: "F", bold: false, color: "rgb(0, 255, 0)" },
      plain("G"),
    ]);
    expect(nativeCommandTextRuns("next command")).toEqual([plain("next command")]);
  });

  it("discards cursor, title, link and clipboard instructions, preserving only visible link text", () => {
    const text =
      `${esc}[?25l${esc}[2Kstart${esc}]0;private title\u0007` +
      `${esc}]8;;https://example.test${esc}\\linked${esc}]8;;${esc}\\` +
      `${esc}]52;c;c2VjcmV0\u0007${esc}Pprivate payload${esc}\\` +
      `${esc}Xhidden${esc}\\${esc}^hidden${esc}\\${esc}_hidden${esc}\\` +
      `${esc}(B\u0000\u0007\u0008\u000b\u000c\r\u007fend\t\n`;
    expect(nativeCommandTextRuns(text)).toEqual([plain("startlinkedend\t\n")]);
  });

  it("handles C1 CSI and control-string forms without losing the selected style", () => {
    const text =
      "\u009b1;38;2;255;0;128mα" +
      "\u009d0;title\u009c\u0090hidden\u009c\u0098hidden\u009c" +
      "\u009ehidden\u009c\u009fhidden\u009c" +
      "\u009b?25hβ\u009b22;39mγ";
    expect(nativeCommandTextRuns(text)).toEqual([
      { text: "αβ", bold: true, color: "rgb(255, 0, 128)" },
      plain("γ"),
    ]);
  });

  it("does not reinterpret unsupported or invalid extended-colour components as SGR commands", () => {
    const text =
      `${esc}[1;38;2;20;30;40mA${esc}[48;2;0;1;22mB` +
      `${esc}[38;2;256;1;0mC${esc}[38;2;1mD${esc}[38;5;22mE` +
      `${esc}[58;2;0;1;22mF${esc}[4mG`;
    expect(nativeCommandTextRuns(text)).toEqual([
      { text: "ABCDEFG", bold: true, color: "rgb(20, 30, 40)" },
    ]);
  });

  it("preserves plain text, HTML-like text, Markdown fences, newlines and complete Unicode glyphs", () => {
    const text = "```\n<em>not HTML</em>\t░█ 🪐 e\u0301 漢字\n```";
    expect(nativeCommandTextRuns(text)).toEqual([plain(text)]);
    expect(nativeCommandTextRuns("")).toEqual([]);
  });

  it("drops truncated escape prefixes without consuming the ordinary tail after a boundary", () => {
    expect(visible(`a${esc}`)).toBe("a");
    expect(visible(`a${esc}[38;2;255;`)).toBe("a");
    expect(visible(`a${esc}[38;2;\nordinary tail`)).toBe("a\nordinary tail");
    expect(visible(`a${esc}[38;2;🪐 tail`)).toBe("a🪐 tail");
    expect(visible(`a${esc}]0;readable tail\nnext line`)).toBe("areadable tail\nnext line");
    expect(visible(`a${esc}Preadable tail`)).toBe("areadable tail");
    expect(nativeCommandTextRuns(`${esc}[38;2;${esc}[1mkept`)).toEqual([
      { text: "kept", bold: true, color: null },
    ]);
  });

  it("recovers from repeated incomplete control strings rather than hiding following text", () => {
    expect(visible("\u009d".repeat(2_000) + "tail 🪐")).toBe("tail 🪐");
    expect(visible(`${esc}]0;broken${esc}[1mvisible`)).toBe("brokenvisible");
  });
});
