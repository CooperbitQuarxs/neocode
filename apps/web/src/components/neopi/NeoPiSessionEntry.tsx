import type { ScopedProjectRef } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { HistoryIcon } from "lucide-react";
import { create } from "zustand";

import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { useProjects, useServerConfigs } from "../../state/entities";
import type { CommandPaletteActionItem } from "../CommandPalette.logic";
import { SidebarMenuButton } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { NeoPiSessionPicker } from "./NeoPiSessionPicker";

const usePickerRequest = create<{ target: ScopedProjectRef | null }>(() => ({ target: null }));

export function useNeoPiSessionPickerAction(): CommandPaletteActionItem | null {
  const { activeThread, activeDraftThread, defaultProjectRef } = useHandleNewThread();
  const configs = useServerConfigs();
  const projects = useProjects();
  const active = activeThread ?? activeDraftThread;
  const preferred = active
    ? scopeProjectRef(active.environmentId, active.projectId)
    : defaultProjectRef;
  const configured = (target: ScopedProjectRef) =>
    configs
      .get(target.environmentId)
      ?.providers.some(
        (provider) =>
          provider.driver === "neopi" &&
          provider.enabled &&
          provider.availability !== "unavailable",
      ) === true;
  const fallback = projects.find((project) =>
    configured(scopeProjectRef(project.environmentId, project.id)),
  );
  const target =
    preferred && configured(preferred)
      ? preferred
      : fallback
        ? scopeProjectRef(fallback.environmentId, fallback.id)
        : null;
  if (!target) return null;
  return {
    kind: "action",
    value: "action:resume-neopi-session",
    title: "Resume NeoPi session",
    searchTerms: ["neopi", "npi", "resume", "terminal", "session", "attach"],
    icon: <HistoryIcon className="size-4 text-icon-muted" />,
    run: async () => {
      usePickerRequest.setState({ target });
    },
  };
}

export function NeoPiSessionEntry() {
  const action = useNeoPiSessionPickerAction();
  if (!action) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarMenuButton
            size="icon"
            aria-label="Resume NeoPi session"
            onClick={() => {
              void action.run();
            }}
          />
        }
      >
        <HistoryIcon />
      </TooltipTrigger>
      <TooltipPopup>Resume NeoPi session</TooltipPopup>
    </Tooltip>
  );
}

export function NeoPiSessionPickerHost() {
  const target = usePickerRequest((state) => state.target);
  return target ? (
    <NeoPiSessionPicker
      key={`${target.environmentId}:${target.projectId}`}
      target={target}
      onClose={() => usePickerRequest.setState({ target: null })}
    />
  ) : null;
}
