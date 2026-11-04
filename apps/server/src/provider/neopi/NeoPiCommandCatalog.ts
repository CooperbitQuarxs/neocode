import type { ServerProviderSkill, ServerProviderSlashCommand } from "@t3tools/contracts";
import { NEOPI_CAPABILITIES } from "./NeoPiCompatibility.ts";

export interface NeoPiAvailableCommand {
  readonly name: string;
  readonly aliases?: ReadonlyArray<string>;
  readonly description?: string;
  readonly input?: { readonly hint?: string };
  readonly source?: string;
  /** Present with `command_catalog`: `tui` commands run only in a terminal NeoPi's editor. */
  readonly availability?: string;
}

/** Command entries from `get_available_commands` or `available_commands_update`. */
export function neoPiAvailableCommands(commands: unknown): NeoPiAvailableCommand[] {
  return Array.isArray(commands)
    ? commands.filter(
        (entry): entry is NeoPiAvailableCommand =>
          typeof entry === "object" && entry !== null && typeof entry.name === "string",
      )
    : [];
}

// NeoPi's TUI reads a leading `/name` or `/ns:name`; a second `/` (`/etc/hosts`) marks a path.
const COMMAND_TOKEN = /^\/([A-Za-z][\w.-]*(?::[\w.-]+)?)(?=\s|$)/;

export function neoPiSlashCommandName(text: string): string | undefined {
  return COMMAND_TOKEN.exec(text)?.[1];
}

/**
 * Where a terminal-attached session receives composer text. `tui` types it into the
 * pane's editor, which dispatches the command as if typed there; `rpc` keeps the prompt
 * path, where headless commands answer the caller and anything unknown is chat. Without
 * `command_catalog` NeoPi lists only headless commands, so an unlisted name may be a
 * TUI builtin and goes to the pane.
 */
export function neoPiTerminalTextRoute(
  text: string,
  commands: ReadonlyArray<NeoPiAvailableCommand>,
  catalog: boolean,
): "tui" | "rpc" {
  const name = neoPiSlashCommandName(text);
  if (!name) return "rpc";
  const command = commands.find((entry) => entry.name === name || entry.aliases?.includes(name));
  if (command) return command.availability === "tui" ? "tui" : "rpc";
  return catalog ? "rpc" : "tui";
}

// NeoPi builtin-lifecycle.ts, builtin-session.ts and builtin-modes.ts: these
// change session identity/context (or exit the TUI); T3 owns that lifecycle.
const SESSION_COMMANDS = new Set([
  "new",
  "clear",
  "delete",
  "switch",
  "resume",
  "session",
  "branch",
  "tree",
  "fork",
  "quit",
  "exit",
]);

export function toNeoPiCommandCatalog(
  commands: ReadonlyArray<NeoPiAvailableCommand>,
  capabilities: ReadonlySet<string> = new Set(),
): { slashCommands: ServerProviderSlashCommand[]; skills: ServerProviderSkill[] } {
  const slashCommands: ServerProviderSlashCommand[] = [];
  const skills: ServerProviderSkill[] = [];
  const seen = new Set<string>();
  for (const command of commands) {
    const name = command.name?.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const description = command.description?.trim() || undefined;
    if (command.source === "skill") {
      const skillName = name.startsWith("skill:") ? name.slice(6) : name;
      if (skillName)
        skills.push({
          name: skillName,
          ...(description ? { description } : {}),
          path: `neopi:skill/${skillName}`,
          scope: "user",
          enabled: true,
          userInvocable: true,
        });
      continue;
    }
    if (
      name === "compact" ||
      name === "quit" ||
      name === "exit" ||
      name === "model" ||
      (command.source === "builtin" && SESSION_COMMANDS.has(name))
    )
      continue;
    const hint = command.input?.hint?.trim();
    const source = command.source;
    slashCommands.push({
      name,
      ...(description ? { description } : {}),
      ...(hint ? { input: { hint } } : {}),
      ...(source === "builtin" ||
      source === "extension" ||
      source === "custom" ||
      source === "mcp_prompt" ||
      source === "file"
        ? { source }
        : {}),
      ...(command.availability === "tui" ? { availability: "tui" as const } : {}),
    });
  }
  if (capabilities.has(NEOPI_CAPABILITIES.setChatMode)) {
    const chat = slashCommands.find((command) => command.name === "chat");
    return {
      slashCommands: [
        chat ?? {
          name: "chat",
          description: "Switch NeoPi chat mode",
          input: { hint: "chat|erp|raw|off" },
          source: "builtin",
        },
        ...slashCommands.filter((command) => command.name !== "chat"),
      ],
      skills,
    };
  }
  return { slashCommands, skills };
}
