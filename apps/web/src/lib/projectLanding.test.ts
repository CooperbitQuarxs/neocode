import { EnvironmentId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const filesystem = vi.hoisted(() => {
  const available = new Set<string>();
  return {
    available,
    browse: vi.fn((input: { environmentId: string; input: { partialPath: string } }) => input),
    execute: vi.fn(
      async (
        _registry: unknown,
        atom: { environmentId: string; input: { partialPath: string } },
      ) => ({
        _tag: available.has(JSON.stringify([atom.environmentId, atom.input.partialPath]))
          ? "Success"
          : "Failure",
      }),
    ),
  };
});

vi.mock("../rpc/atomRegistry", () => ({ appAtomRegistry: {} }));
vi.mock("../state/filesystem", () => ({ filesystemEnvironment: { browse: filesystem.browse } }));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({ executeAtomQuery: filesystem.execute }));

import { findAvailableProject, isProjectDirectoryAvailable } from "./projectLanding";

const environmentId = EnvironmentId.make("environment-local");
const staleProject = { id: "stale", environmentId, workspaceRoot: "/deleted/worktree" };
const existingProject = { id: "existing", environmentId, workspaceRoot: "/existing/project" };

beforeEach(() => {
  filesystem.available.clear();
  filesystem.browse.mockClear();
  filesystem.execute.mockClear();
});

function makeAvailable(
  project: typeof existingProject,
  directoryPath = `${project.workspaceRoot}/`,
) {
  filesystem.available.add(JSON.stringify([project.environmentId, directoryPath]));
}

describe("automatic project landing", () => {
  it("skips a stale preferred project and opens a reachable fallback without removing history", async () => {
    const projects = [staleProject, existingProject];
    makeAvailable(existingProject);

    expect(await findAvailableProject(projects)).toBe(existingProject);
    expect(projects).toEqual([staleProject, existingProject]);
    expect(filesystem.browse.mock.calls.map(([request]) => request.input.partialPath)).toEqual([
      "/deleted/worktree/",
      "/existing/project/",
    ]);
  });

  it("leaves the start screen available when every saved project directory is gone", async () => {
    const projects = [staleProject, existingProject];

    expect(await findAvailableProject(projects)).toBeNull();
    expect(projects).toEqual([staleProject, existingProject]);
  });

  it("keeps a reachable preferred project instead of changing the saved ordering", async () => {
    makeAvailable(existingProject);

    expect(await findAvailableProject([existingProject, staleProject])).toBe(existingProject);
    expect(filesystem.browse).toHaveBeenCalledTimes(1);
  });

  it("checks the owning environment even when another environment has the same path", async () => {
    const remoteProject = {
      ...existingProject,
      environmentId: EnvironmentId.make("environment-remote"),
    };
    makeAvailable(remoteProject);

    expect(await findAvailableProject([existingProject, remoteProject])).toBe(remoteProject);
    expect(filesystem.browse.mock.calls.map(([request]) => request.environmentId)).toEqual([
      environmentId,
      remoteProject.environmentId,
    ]);
  });

  it("probes the actual directory afresh rather than assuming a project file must exist", async () => {
    makeAvailable(existingProject);

    expect(await isProjectDirectoryAvailable(existingProject)).toBe(true);
    expect(filesystem.browse).toHaveBeenCalledWith({
      environmentId,
      input: { partialPath: "/existing/project/" },
    });
    expect(filesystem.execute).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      refresh: true,
      reportFailure: false,
      reportDefect: false,
    });
    filesystem.available.clear();
    expect(await isProjectDirectoryAvailable(existingProject)).toBe(false);
  });

  it("does not probe or select after the landing request is cancelled", async () => {
    let cancelled = false;
    filesystem.execute.mockImplementationOnce(async () => {
      cancelled = true;
      return { _tag: "Success" };
    });

    expect(await findAvailableProject([existingProject, staleProject], () => cancelled)).toBeNull();
    expect(filesystem.browse).toHaveBeenCalledTimes(1);
  });

  it("handles an empty saved-project list without a filesystem request", async () => {
    expect(await findAvailableProject([])).toBeNull();
    expect(filesystem.browse).not.toHaveBeenCalled();
  });
});
