import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import type {
  NativeSessionList,
  NativeSessionTarget,
} from "@t3tools/client-runtime/neopi-native-sessions";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useCallback, useEffect, useState } from "react";
import { PlusIcon } from "lucide-react";
import { isElectron } from "../../env";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useServerConfigs, useThreadShells } from "../../state/entities";
import {
  nativeSessionAtoms,
  selectNativeSession,
  useNativeSessionSelection,
} from "../../state/neopiNativeSessions";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { SidebarChromeHeader, SidebarChromeFooter } from "../sidebar/SidebarChrome";
import {
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";
import { Input } from "../ui/input";
import { Button } from "../ui/button";

export function useOpenNativeSession() {
  const open = useAtomCommand(nativeSessionAtoms.open, { reportFailure: false });
  const navigate = useNavigate();
  return useCallback(
    async (
      environmentId: EnvironmentId,
      input: { providerInstanceId: ProviderInstanceId; sessionFile?: string; cwd?: string },
    ) => {
      const response = await open({ environmentId, input });
      if (response._tag === "Failure") throw squashAtomCommandFailure(response);
      const target = { environmentId, ref: response.value.ref };
      selectNativeSession(target);
      await navigate({ to: "/" });
      return target;
    },
    [navigate, open],
  );
}

export function useCreateNativeSession() {
  const configs = useServerConfigs();
  const primary = usePrimaryEnvironmentId();
  const selected = useNativeSessionSelection((state) => state.target);
  const open = useOpenNativeSession();
  const navigate = useNavigate();
  return useCallback(
    async (environmentId = selected?.environmentId ?? primary, cwd?: string) => {
      if (!environmentId) throw new Error("Connect an environment to start a session.");
      const config = configs.get(environmentId);
      if (!config) throw new Error("Connect to this computer before starting a NeoPi session.");
      const providers = config.providers.filter((provider) => provider.driver === "neopi");
      const selectedProvider =
        selected?.environmentId === environmentId
          ? providers.find((candidate) => candidate.instanceId === selected.ref.providerInstanceId)
          : undefined;
      const availableProviders = providers.filter(
        (provider) =>
          provider.enabled && provider.installed && provider.availability !== "unavailable",
      );
      const provider =
        availableProviders.find((candidate) => candidate === selectedProvider) ??
        availableProviders[0];
      if (!provider) {
        const setupProvider = selectedProvider ?? providers[0];
        await navigate({
          to: "/settings/neocore",
          search: {
            machine: environmentId,
            ...(setupProvider ? { instanceId: setupProvider.instanceId } : {}),
          },
        });
        return;
      }
      return open(environmentId, {
        providerInstanceId: provider.instanceId,
        ...(cwd ? { cwd } : {}),
      });
    },
    [configs, navigate, open, primary, selected],
  );
}

export function NativeSessionSidebar() {
  const { environments } = useEnvironments();
  const create = useCreateNativeSession();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const saved = useThreadShells();
  const navigate = useNavigate();
  const start = async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      await create();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreating(false);
    }
  };
  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent
        fixedHeader={
          <SidebarGroup>
            <div className="flex items-center gap-2">
              <Input
                aria-label="Search native sessions"
                placeholder="Search sessions"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="New thread"
                disabled={creating}
                onClick={() => void start()}
              >
                <PlusIcon />
              </Button>
            </div>
            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </SidebarGroup>
        }
      >
        {environments.map((environment) => (
          <NativeEnvironmentSessions
            key={environment.environmentId}
            environmentId={environment.environmentId}
            label={environment.label}
            query={query}
          />
        ))}
        {saved.length ? (
          <SidebarGroup>
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Saved workspaces and legacy history
              </summary>
              <SidebarMenu>
                {saved
                  .filter((thread) => thread.title.toLowerCase().includes(query.toLowerCase()))
                  .map((thread) => (
                    <SidebarMenuItem key={`${thread.environmentId}:${thread.id}`}>
                      <SidebarMenuButton
                        onClick={() =>
                          void navigate({
                            to: "/$environmentId/$threadId",
                            params: { environmentId: thread.environmentId, threadId: thread.id },
                          })
                        }
                      >
                        <span className="truncate">{thread.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
              </SidebarMenu>
            </details>
          </SidebarGroup>
        ) : null}
      </SidebarContent>
      <SidebarChromeFooter />
    </>
  );
}

export function NativeEnvironmentSessions({
  environmentId,
  label,
  query,
  onSelect,
}: {
  environmentId: EnvironmentId;
  label?: string;
  query: string;
  onSelect?: () => void;
}) {
  const result = useEnvironmentQuery(nativeSessionAtoms.list({ environmentId, input: {} }));
  const refresh = result.refresh;
  useEffect(() => {
    // Native terminal owners can create sessions without a NeoCode mutation.
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
  const open = useOpenNativeSession();
  const selected = useNativeSessionSelection((state) => state.target);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const choose = async (session: NativeSessionList["sessions"][number]) => {
    if (pending) return;
    setPending(session.ref.sessionFile);
    setError(null);
    try {
      await open(environmentId, session.ref);
      onSelect?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  };
  return (
    <SidebarGroup>
      {label ? <p className="mb-2 text-xs text-muted-foreground">{label}</p> : null}
      {result.error || error ? (
        <p role="alert" className="text-xs text-destructive">
          {error ?? result.error}
        </p>
      ) : null}
      {result.data?.diagnostics.map((item, index) => (
        <p key={index} className="text-xs text-muted-foreground">
          {item.providerInstanceId}: {item.message}
        </p>
      ))}
      <SidebarMenu>
        {result.data?.sessions
          .filter((session) =>
            `${session.title ?? ""} ${session.firstMessage} ${session.cwd}`
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
          .map((session) => {
            const target: NativeSessionTarget = { environmentId, ref: session.ref };
            const disabled = session.owner.kind === "process" && !session.owner.attachable;
            return (
              <SidebarMenuItem key={`${session.ref.providerInstanceId}:${session.ref.sessionFile}`}>
                <SidebarMenuButton
                  isActive={
                    selected?.environmentId === target.environmentId &&
                    selected.ref.providerInstanceId === target.ref.providerInstanceId &&
                    selected.ref.sessionFile === target.ref.sessionFile
                  }
                  disabled={pending !== null || disabled}
                  onClick={() => void choose(session)}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {session.title ?? (session.firstMessage || "New session")}
                  </span>
                  {session.owner.kind === "process" ? (
                    <span className="text-xs text-muted-foreground">
                      {disabled ? "In use" : "Terminal"}
                    </span>
                  ) : null}
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
      </SidebarMenu>
      {!result.data && result.isPending ? (
        <p className="text-xs text-muted-foreground">Reading sessions…</p>
      ) : null}
    </SidebarGroup>
  );
}
