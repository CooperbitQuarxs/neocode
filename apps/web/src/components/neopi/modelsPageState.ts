import { EnvironmentId, ProjectId, type NeoPiModelsTarget } from "@t3tools/contracts";
import { makeNeoPiModelsClientState } from "@t3tools/client-runtime/neopi-models";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useActiveEnvironmentId, useProjects, useServerConfigs } from "../../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { nativeSessionAtoms, useNativeSessionSelection } from "../../state/neopiNativeSessions";

export const neopiModels = makeNeoPiModelsClientState(connectionAtomRuntime);
export interface ModelsSearch {
  environment?: string;
  instance?: string;
  project?: string;
  sessionFile?: string;
  section?: string;
}
type ModelsSearchUpdate = { [Key in keyof ModelsSearch]?: string | undefined };
export function validateModelsSearch(raw: Record<string, unknown>): ModelsSearch {
  return Object.fromEntries(
    ["environment", "instance", "project", "sessionFile", "section"].flatMap((key) =>
      typeof raw[key] === "string" && raw[key] !== "" ? [[key, raw[key]]] : [],
    ),
  );
}
export function useModelsPageTarget() {
  const search = useLocation({ select: (location) => validateModelsSearch(location.search) });
  const navigate = useNavigate();
  const { environments } = useEnvironments();
  const primary = usePrimaryEnvironmentId();
  const selected = useNativeSessionSelection((state) => state.target);
  const environmentId = search.environment
    ? EnvironmentId.make(search.environment)
    : (selected?.environmentId ?? primary);
  const configs = useServerConfigs();
  const providers = environmentId
    ? (configs
        .get(environmentId)
        ?.providers.filter((provider) => provider.driver === "neopi" && provider.enabled) ?? [])
    : [];
  const selectedInstanceId =
    search.instance ??
    (selected?.environmentId === environmentId ? selected.ref.providerInstanceId : undefined);
  const provider = selectedInstanceId
    ? providers.find((provider) => provider.instanceId === selectedInstanceId)
    : providers[0];
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const nativeCwd = selected ? nativeSessionAtoms.cached(selected)?.session?.cwd : undefined;
  const projectId = search.project
    ? ProjectId.make(search.project)
    : search.sessionFile && selected?.ref.sessionFile === search.sessionFile
      ? projects.find((project) => project.workspaceRoot === nativeCwd)?.id
      : undefined;
  const target: NeoPiModelsTarget | null = provider
    ? {
        providerInstanceId: provider.instanceId,
        ...(projectId ? { projectId } : {}),
        ...(search.sessionFile ? { sessionFile: search.sessionFile } : {}),
      }
    : null;
  const changeSearch = (patch: ModelsSearchUpdate) =>
    void navigate({
      to: "/models",
      search: validateModelsSearch({
        ...search,
        ...(["environment", "instance", "project"].some((key) => Object.hasOwn(patch, key))
          ? { sessionFile: undefined }
          : {}),
        ...patch,
      }),
      replace: true,
    });
  return {
    search,
    environmentId,
    environments,
    providers,
    selectedInstanceId,
    provider,
    projects,
    projectId,
    target,
    changeSearch,
  };
}
export function useOpenModels() {
  const navigate = useNavigate();
  const selected = useNativeSessionSelection((state) => state.target);
  const activeEnvironment = useActiveEnvironmentId();
  const isOpen = useLocation({ select: (location) => location.pathname === "/models" });
  return useCallback(() => {
    if (isOpen) return;
    void navigate({
      to: "/models",
      search: selected
        ? {
            environment: selected.environmentId,
            instance: selected.ref.providerInstanceId,
            sessionFile: selected.ref.sessionFile,
          }
        : { ...(activeEnvironment ? { environment: activeEnvironment } : {}) },
    });
  }, [navigate, selected, activeEnvironment, isOpen]);
}
