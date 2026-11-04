import type { AgentIdentity } from "@t3tools/shared/agentNames";

import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** A session's name and designation as muted secondary text; its pronouns show on hover. */
export function AgentLabel({
  identity,
  className,
}: {
  readonly identity: AgentIdentity;
  readonly className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className={cn("shrink-0 text-3xs text-secondary-label", className)} />}
      >
        {identity.label}
      </TooltipTrigger>
      <TooltipPopup side="top">{identity.pronouns}</TooltipPopup>
    </Tooltip>
  );
}
