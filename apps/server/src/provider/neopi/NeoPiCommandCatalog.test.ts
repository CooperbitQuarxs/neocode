import { describe, expect, it } from "vite-plus/test";
import {
  neoPiSlashCommandName,
  neoPiTerminalTextRoute,
  toNeoPiCommandCatalog,
} from "./NeoPiCommandCatalog.ts";
import { NEOPI_CAPABILITIES } from "./NeoPiCompatibility.ts";

describe("NeoPi command catalog", () => {
  const commands = [
    { name: "new", source: "builtin", description: "New session" },
    { name: "quit", source: "builtin" },
    { name: "compact", source: "builtin" },
    { name: "review", source: "extension", description: "Review files", input: { hint: "path" } },
    {
      name: "skill:unslop",
      source: "skill",
      description: "Remove slop",
      input: { hint: "arguments" },
    },
  ];
  it("retains native inputs, filters session mutation and publishes skills separately", () => {
    expect(toNeoPiCommandCatalog(commands)).toEqual({
      slashCommands: [
        {
          name: "review",
          description: "Review files",
          input: { hint: "path" },
          source: "extension",
        },
      ],
      skills: [
        {
          name: "unslop",
          description: "Remove slop",
          path: "neopi:skill/unslop",
          scope: "user",
          enabled: true,
          userInvocable: true,
        },
      ],
    });
  });
  it("hides the native builtin model command while keeping T3's model picker distinct", () => {
    const catalog = toNeoPiCommandCatalog([
      { name: "model", source: "builtin", description: "Choose a NeoPi model" },
      { name: "model", source: "extension", description: "Duplicate" },
      { name: "models", source: "builtin" },
    ]);
    expect(catalog.slashCommands.map((command) => command.name)).toEqual(["models"]);
  });
  it("places chat first only when supported or explicitly listed by the peer", () => {
    expect(
      toNeoPiCommandCatalog(commands).slashCommands.some((command) => command.name === "chat"),
    ).toBe(false);
    expect(
      toNeoPiCommandCatalog([{ name: "chat", source: "builtin" }, ...commands]).slashCommands[0]
        ?.name,
    ).toBe("chat");
    expect(
      toNeoPiCommandCatalog(commands, new Set([NEOPI_CAPABILITIES.setChatMode])).slashCommands[0],
    ).toMatchObject({ name: "chat", input: { hint: "chat|erp|raw|off" } });
  });
  it("marks commands NeoPi runs only in its terminal UI", () => {
    expect(
      toNeoPiCommandCatalog([
        { name: "personality", source: "builtin", availability: "tui" },
        { name: "usage", source: "builtin", availability: "headless" },
      ]).slashCommands,
    ).toEqual([
      { name: "personality", source: "builtin", availability: "tui" },
      { name: "usage", source: "builtin" },
    ]);
  });
});

describe("terminal slash routing", () => {
  const listed = [
    { name: "personality", availability: "tui" },
    { name: "usage", aliases: ["u"], availability: "headless" },
    { name: "skill:unslop", source: "skill", availability: "headless" },
  ];
  it("reads command tokens the way NeoPi's TUI does", () => {
    expect(neoPiSlashCommandName("/personality Angel")).toBe("personality");
    expect(neoPiSlashCommandName("/skill:unslop now")).toBe("skill:unslop");
    expect(neoPiSlashCommandName("/etc/hosts is wrong")).toBeUndefined();
    expect(neoPiSlashCommandName(" /usage")).toBeUndefined();
    expect(neoPiSlashCommandName("hello /usage")).toBeUndefined();
  });
  it("sends TUI-only commands to the pane and keeps the rest on the prompt path", () => {
    expect(neoPiTerminalTextRoute("/personality Angel", listed, true)).toBe("tui");
    expect(neoPiTerminalTextRoute("/u", listed, true)).toBe("rpc");
    expect(neoPiTerminalTextRoute("/skill:unslop", listed, true)).toBe("rpc");
    expect(neoPiTerminalTextRoute("/unknown thing", listed, true)).toBe("rpc");
    expect(neoPiTerminalTextRoute("/tmp/x", listed, true)).toBe("rpc");
    expect(neoPiTerminalTextRoute("plain prompt", listed, true)).toBe("rpc");
  });
  it("lets the pane parse unlisted names when NeoPi lists only headless commands", () => {
    expect(neoPiTerminalTextRoute("/personality Angel", [{ name: "usage" }], false)).toBe("tui");
    expect(neoPiTerminalTextRoute("/usage", [{ name: "usage" }], false)).toBe("rpc");
  });
});
