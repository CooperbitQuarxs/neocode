import type { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { CheckIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { NativeAuthFlow } from "./NativeAuthFlow";
import { neopiModels } from "./modelsPageState";

/**
 * One place to connect NeoPi to a NeoProxy: address first, then the member
 * key and certificate trust through NeoPi's own login prompts. Used by the
 * first-run wizard; the Models page keeps its per-provider account flow.
 */
export function NeoProxyConnect({
  environmentId,
  providerInstanceId,
  initialServerUrl = "",
  autoFocus = false,
  onConnected,
}: {
  readonly environmentId: EnvironmentId;
  readonly providerInstanceId: ProviderInstanceId;
  readonly initialServerUrl?: string;
  readonly autoFocus?: boolean;
  readonly onConnected?: (() => void) | undefined;
}) {
  const target = useMemo(() => ({ providerInstanceId }), [providerInstanceId]);
  const catalog = useEnvironmentQuery(neopiModels.changes({ environmentId, input: target }));
  const startAuth = useAtomCommand(neopiModels.startAuth, { reportFailure: false });
  const cancelAuth = useAtomCommand(neopiModels.cancelAuth, { reportFailure: false });
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [serverUrl, setServerUrl] = useState(initialServerUrl);
  const [flowId, setFlowId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [connectedByFlow, setConnectedByFlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const startingRef = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const configuration = catalog.isSuccess && !catalog.isPending ? catalog.data : null;
  const neoProxy = configuration?.providers.find((entry) => entry.id === "neoproxy");
  const connected = connectedByFlow || neoProxy?.authenticated === true;
  const canConnect = neoProxy?.loginProviders.some((method) => method.available) === true;
  const grantedModels =
    configuration?.models.filter((model) => model.provider === "neoproxy" && model.available)
      .length ?? 0;
  const addressValid = /^https?:\/\/\S+$/i.test(serverUrl.trim());
  const login = async () => {
    if (startingRef.current || flowId !== null || !addressValid) return;
    startingRef.current = true;
    setStarting(true);
    setError(null);
    const result = await startAuth({
      environmentId,
      input: { target, providerId: "neoproxy", serverUrl: serverUrl.trim() },
    });
    startingRef.current = false;
    if (!mounted.current) {
      if (result._tag === "Success") void cancelAuth({ environmentId, input: result.value });
      return;
    }
    setStarting(false);
    if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    else setFlowId(result.value.flowId);
  };
  if (flowId) {
    return (
      <NativeAuthFlow
        key={flowId}
        variant="card"
        environmentId={environmentId}
        flowId={flowId}
        providerId="neoproxy"
        title={`Connecting to ${serverUrl.trim()}`}
        finish={(status, message) => {
          setFlowId(null);
          if (status === "complete") {
            setConnectedByFlow(true);
            catalog.refresh();
            void refreshProviders({ environmentId, input: {} });
            onConnected?.();
          } else if (status === "failed") {
            setError(
              message ??
                "Couldn't connect to NeoProxy. Check the address and your member key, then try again.",
            );
          }
        }}
      />
    );
  }
  if (connected) {
    return (
      <div className="space-y-1.5">
        <p role="status" className="flex items-center gap-1.5 text-sm text-success-foreground">
          <CheckIcon className="size-3.5" />
          Connected to NeoProxy
        </p>
        <p className="text-xs text-muted-foreground">
          {grantedModels > 0
            ? `${grantedModels} model${grantedModels === 1 ? "" : "s"} granted to you. They appear as neoproxy/… in the model picker.`
            : "No models are granted to your key yet. Ask your NeoProxy administrator, then refresh from Models."}
        </p>
      </div>
    );
  }
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void login();
      }}
    >
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-foreground">Server address</span>
        <Input
          autoFocus={autoFocus}
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="https://neoproxy.example.com"
          value={serverUrl}
          onChange={(event) => setServerUrl(event.target.value)}
          aria-invalid={serverUrl.length > 0 && !addressValid}
        />
        <span className="block text-xs text-muted-foreground">
          HTTPS, or plain HTTP on this computer. Your administrator gives you the address and a
          member key; the key is asked for next.
        </span>
      </label>
      {neoProxy?.disabled ? (
        <p role="status" className="text-xs text-muted-foreground">
          NeoProxy is disabled in NeoPi. Enable it from NeoPi settings first.
        </p>
      ) : null}
      {configuration && !canConnect ? (
        <p className="text-xs text-muted-foreground">
          This NeoPi cannot run a NeoProxy login. Update NeoPi, then try again.
        </p>
      ) : null}
      {error || catalog.error ? (
        <p role="alert" className="text-xs text-destructive">
          {error ?? catalog.error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={starting || !addressValid || (configuration !== null && !canConnect)}
        >
          {starting ? "Connecting…" : "Connect"}
        </Button>
        {catalog.isPending && !configuration ? (
          <span role="status" className="text-xs text-muted-foreground">
            Checking NeoPi…
          </span>
        ) : null}
      </div>
    </form>
  );
}
