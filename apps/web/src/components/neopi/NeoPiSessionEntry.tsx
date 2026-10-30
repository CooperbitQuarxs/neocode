import { HistoryIcon } from "lucide-react";
import { create } from "zustand";

import { useEnvironments } from "../../state/environments";
import type { CommandPaletteActionItem } from "../CommandPalette.logic";
import { SidebarMenuButton } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { NeoPiSessionPicker } from "./NeoPiSessionPicker";

const usePickerRequest = create<{ open: boolean }>(() => ({ open: false }));

export function useNeoPiSessionPickerAction(): CommandPaletteActionItem | null {
  const { environments } = useEnvironments();
  if (!environments.length) return null;
  return {
    kind: "action",
    value: "action:resume-neopi-session",
    title: "Open NeoPi session",
    searchTerms: ["neopi", "npi", "resume", "terminal", "session", "attach"],
    icon: <HistoryIcon className="size-4 text-icon-muted" />,
    run: async () => {
      usePickerRequest.setState({ open: true });
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
  const open = usePickerRequest((state) => state.open);
  return open ? (
    <NeoPiSessionPicker onClose={() => usePickerRequest.setState({ open: false })} />
  ) : null;
}
