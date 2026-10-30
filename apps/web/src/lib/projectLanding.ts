import type { EnvironmentId } from "@t3tools/contracts";
import { ensureBrowseDirectoryPath } from "@t3tools/client-runtime/state/projects";
import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { filesystemEnvironment } from "../state/filesystem";

interface ProjectLandingCandidate {
  readonly environmentId: EnvironmentId;
  readonly workspaceRoot: string;
}

/** Probe the actual directory on its owning environment, not a project file. */
export async function isProjectDirectoryAvailable(
  project: ProjectLandingCandidate,
): Promise<boolean> {
  const result = await executeAtomQuery(
    appAtomRegistry,
    filesystemEnvironment.browse({
      environmentId: project.environmentId,
      input: { partialPath: ensureBrowseDirectoryPath(project.workspaceRoot) },
    }),
    { refresh: true, reportFailure: false, reportDefect: false },
  );
  return result._tag === "Success";
}

/** Automatic landing skips unavailable workspaces without removing their history. */
export async function findAvailableProject<T extends ProjectLandingCandidate>(
  orderedProjects: readonly T[],
  isCancelled: () => boolean = () => false,
): Promise<T | null> {
  for (const project of orderedProjects) {
    if (isCancelled()) return null;
    if (await isProjectDirectoryAvailable(project)) {
      return isCancelled() ? null : project;
    }
  }
  return null;
}
