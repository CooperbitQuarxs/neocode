import type { AgentHubAgent, AgentHubSource } from "@t3tools/client-runtime/neopi-native-agent-hub";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Kbd } from "~/components/ui/kbd";

/** Open the agent's own view, or stop it while it runs. */
export function AgentActions({
  agent,
  source,
  onOpen,
}: {
  agent: AgentHubAgent;
  source: AgentHubSource;
  onOpen: (id: string) => void;
}) {
  const [error, setError] = useState<{ readonly id: string; readonly message: string } | null>(
    null,
  );
  return (
    <>
      {error?.id === agent.id ? (
        <span role="alert" className="max-w-48 truncate text-2xs text-destructive-foreground">
          {error.message}
        </span>
      ) : null}
      {agent.live ? (
        <Button
          size="xs"
          variant="outline"
          onClick={() =>
            void source.cancel(agent.id).catch((cause) =>
              setError({
                id: agent.id,
                message: cause instanceof Error ? cause.message : String(cause),
              }),
            )
          }
        >
          Stop
        </Button>
      ) : null}
      <Button size="xs" onClick={() => onOpen(agent.id)}>
        Open
        <Kbd>↵</Kbd>
      </Button>
    </>
  );
}
