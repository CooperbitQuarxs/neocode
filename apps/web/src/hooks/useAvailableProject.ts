import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useState } from "react";

import { findAvailableProject } from "../lib/projectLanding";

/** Only automatic destinations are filtered; project and thread stores remain intact. */
export function useAvailableProject<
  T extends { environmentId: EnvironmentId; workspaceRoot: string },
>(candidates: readonly T[], enabled = true): T | null | undefined {
  const key = JSON.stringify(
    candidates.map(({ environmentId, workspaceRoot }) => [environmentId, workspaceRoot]),
  );
  const readCandidates = useEffectEvent(() => candidates);
  const [selection, setSelection] = useState<{ key: string; index: number } | null>(null);

  useEffect(() => {
    if (!enabled) {
      setSelection(null);
      return;
    }
    let cancelled = false;
    const projects = readCandidates();
    void findAvailableProject(projects, () => cancelled).then((project) => {
      if (!cancelled) {
        setSelection({ key, index: project === null ? -1 : projects.indexOf(project) });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [key, enabled]);

  return enabled && selection?.key === key ? (candidates[selection.index] ?? null) : undefined;
}
