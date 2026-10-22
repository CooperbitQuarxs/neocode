import {
  isAtomCommandInterrupted,
  mapAtomCommandResult,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  type ProjectId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ServerSettings,
} from "@t3tools/contracts";
import { projectActionsPatch, resolveProjectScripts } from "@t3tools/shared/projectScripts";
import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { useRef, useState } from "react";

import { isElectron } from "../../env";
import {
  decodeProjectScriptKeybindingRule,
  keybindingValueForCommand,
} from "../../lib/projectScriptKeybindings";
import {
  buildProjectScript,
  commandForProjectScript,
  nextProjectScriptId,
} from "../../projectScripts";
import { useProjects } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import type { NewProjectScriptInput } from "../projectScriptEditor";
import { toastManager } from "../ui/toast";

function reportScriptFailure(result: AtomCommandResult<unknown, unknown>) {
  if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
    const error = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title: "Failed to save actions",
      description: error instanceof Error ? error.message : "An error occurred.",
    });
  }
  return mapAtomCommandResult(result, () => undefined);
}

/**
 * Edits changed action IDs at the selected scopes, preserving inherited IDs.
 * Shortcuts are shared by action ID across projects on each environment.
 */
export function useProjectScriptSettings(
  targets: readonly {
    environmentId: EnvironmentId;
    settings: ServerSettings;
    keybindings: ResolvedKeybindingsConfig;
    project?: { id: ProjectId; scripts: readonly ProjectScript[] };
  }[],
) {
  const projects = useProjects();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, "project actions update");
  const upsertKeybinding = useAtomCommand(
    serverEnvironment.upsertKeybinding,
    "action shortcut update",
  );
  const removeKeybinding = useAtomCommand(
    serverEnvironment.removeKeybinding,
    "action shortcut removal",
  );

  async function persist(
    transform: (current: readonly ProjectScript[]) => readonly ProjectScript[] | null,
    scriptId?: string,
    keybinding?: string | null,
    resetId?: string,
  ): Promise<AtomCommandResult<void, unknown>> {
    if (savingRef.current || targets.length === 0) {
      const message = "No available machine, or another action change is saving.";
      toastManager.add({ type: "error", title: "Actions not saved", description: message });
      return AsyncResult.failure(Cause.fail(new Error(message)));
    }
    savingRef.current = true;
    setSaving(true);
    try {
      for (const { environmentId, settings, keybindings, project } of targets) {
        const current = resolveProjectScripts(settings, project ?? null);
        const nextScripts = transform(current);
        const patch = projectActionsPatch(settings, project ?? null, nextScripts, resetId);
        const nextSettings = applyServerSettingsPatch(settings, patch);
        const effectiveScripts = resolveProjectScripts(nextSettings, project ?? null);
        const result = await updateSettings({
          environmentId,
          input: { patch },
        });
        if (result._tag === "Failure") return reportScriptFailure(result);
        if (!isElectron || resetId !== undefined) continue;
        const changedIds = scriptId
          ? [scriptId]
          : current
              .filter((script) => !effectiveScripts.some((next) => next.id === script.id))
              .map((script) => script.id);
        for (const id of changedIds) {
          const command = commandForProjectScript(id);
          const previousValue = keybindingValueForCommand(keybindings, command);
          const previous = previousValue
            ? decodeProjectScriptKeybindingRule({ keybinding: previousValue, command })
            : null;
          const next = decodeProjectScriptKeybindingRule({ keybinding, command });
          const retainedElsewhere =
            !effectiveScripts.some((script) => script.id === id) &&
            (resolveProjectScripts(nextSettings, null).some((script) => script.id === id) ||
              projects.some(
                (other) =>
                  other.environmentId === environmentId &&
                  other.id !== project?.id &&
                  resolveProjectScripts(nextSettings, other).some((script) => script.id === id),
              ));
          const bindingResult = next
            ? await upsertKeybinding({
                environmentId,
                input:
                  previous && previous.key !== next.key ? { ...next, replace: previous } : next,
              })
            : previous && !retainedElsewhere
              ? await removeKeybinding({ environmentId, input: previous })
              : null;
          if (bindingResult?._tag === "Failure") return reportScriptFailure(bindingResult);
        }
      }
      return AsyncResult.success(undefined);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function submit(scriptId: string | null, input: NewProjectScriptInput) {
    const existingIds = [
      ...projects.flatMap((project) => project.scripts.map((script) => script.id)),
      ...targets.flatMap(({ settings, project }) =>
        [
          ...settings.defaultProjectScripts,
          ...Object.values(settings.actions).filter((script) => script !== null),
          ...Object.values(settings.projectSettingsOverrides).flatMap(
            (entry) => [
              ...(entry.defaultProjectScripts ?? []),
              ...Object.values(entry.actions ?? {}).filter((script) => script !== null),
            ],
          ),
          ...(project?.scripts ?? []),
        ].map((script) => script.id),
      ),
    ];
    const id = scriptId ?? nextProjectScriptId(input.name, existingIds);
    const next = buildProjectScript(id, input);
    return persist(
      (current) => {
        const updated = current.map((script) =>
          script.id === id
            ? next
            : input.runOnWorktreeCreate
              ? { ...script, runOnWorktreeCreate: false }
              : script,
        );
        return scriptId === null ? [...updated, next] : updated;
      },
      id,
      input.keybinding,
    );
  }

  return {
    saving,
    persist,
    submit,
    reset: (id: string) => persist((current) => current, id, undefined, id),
  };
}
