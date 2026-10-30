import type { WorkspaceRef } from "@t3tools/client-runtime/environment";
import { DiscoveryListRow } from "../ui/discovery-list";

import { PreviewFaviconIcon } from "./PreviewFaviconIcon";
import type { PreviewableServer } from "./useDiscoveredLocalServers";

interface Props {
  threadRef: WorkspaceRef;
  server: PreviewableServer;
  onOpen: () => void;
}

export function PreviewLocalServerCard({ threadRef, server, onOpen }: Props) {
  const subtitle = describeServer(server);
  return (
    <DiscoveryListRow
      onClick={onOpen}
      icon={<PreviewFaviconIcon threadRef={threadRef} url={server.requestedUrl} />}
      title={subtitle}
      description={`${server.host}:${server.port}`}
    />
  );
}

function describeServer(server: PreviewableServer): string {
  if (server.processName) return server.processName;
  return "Listening";
}
