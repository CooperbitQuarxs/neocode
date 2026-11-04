import { Bot } from "lucide-react";

import { AgentActions } from "./AgentActions";
import { AgentDetail } from "./AgentDetail";
import { AgentRoster } from "./AgentRoster";
import { AgentSummary } from "./AgentSummary";
import { useAgentSelection } from "./useAgentSelection";
import { useAgentHubSource } from "./useNativeAgentHubSource";

/**
 * The agents right-panel surface: the roster plus the highlighted agent's facts and
 * transcript preview. Click or arrow to preview, Enter or double-click to open.
 */
export function NativeAgentsPanel({ viewKey }: { viewKey: string }) {
  const source = useAgentHubSource();
  const { selected, select, open } = useAgentSelection(source, viewKey);
  if (source.agents.length === 0 || selected === null)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Bot aria-hidden className="size-6 text-muted-foreground/60" />
        <p className="text-sm font-medium">No agents yet</p>
        <p className="max-w-56 text-xs text-muted-foreground">
          When this session spawns subagents, they show up here with live status, activity and token
          usage.
        </p>
      </div>
    );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <AgentSummary
        agents={source.agents}
        className="shrink-0 border-b border-border/60 px-3 py-1.5"
      />
      <div className="max-h-[45%] min-h-[4.75rem] shrink-0 overflow-y-auto border-b border-border/60">
        <AgentRoster
          agents={source.agents}
          selectedId={selected.id}
          onSelect={select}
          onOpen={open}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AgentDetail
          agent={selected}
          source={source}
          previewCount={6}
          actions={<AgentActions agent={selected} source={source} onOpen={open} />}
        />
      </div>
    </div>
  );
}
