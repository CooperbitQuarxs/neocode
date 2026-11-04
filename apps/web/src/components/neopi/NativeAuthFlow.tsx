import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useId, useRef, useState } from "react";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatEnvironmentQueryError } from "../../state/query";
import { SettingsRow } from "../settings/settingsLayout";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button, InlineButton } from "../ui/button";
import { Input } from "../ui/input";
import { Kbd } from "../ui/kbd";
import { Spinner } from "../ui/spinner";
import { neopiModels } from "./modelsPageState";

/** Presents native prompts without owning credentials, trust decisions, or the login lifetime. */
export function NativeAuthFlow({
  environmentId,
  flowId,
  providerId,
  title,
  description,
  variant = "row",
  finish,
}: {
  environmentId: EnvironmentId;
  flowId: string;
  providerId: string;
  title: string;
  description?: string | undefined;
  variant?: "row" | "card";
  finish: (status: "complete" | "cancelled" | "failed", message: string | null) => void;
}) {
  const state = useAtomValue(neopiModels.authChanges({ environmentId, input: { flowId } }));
  const respond = useAtomCommand(neopiModels.respondAuth, { reportFailure: false });
  const cancel = useAtomCommand(neopiModels.cancelAuth, { reportFailure: false });
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const finished = useRef(false);
  const mounted = useRef(false);
  const pendingRequest = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const confirmationId = useId();
  const result = AsyncResult.isSuccess(state) ? state.value : null;
  const prompt = result?.prompt ?? null;
  const promptId = useRef(prompt?.id);
  promptId.current = prompt?.id;
  const isNeoProxy = providerId === "neoproxy";
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setValue("");
    setError(null);
    setSubmitting(false);
    pendingRequest.current = null;
    if (prompt?.kind === "confirm") confirmationRef.current?.focus();
    else if (prompt?.kind === "input") inputRef.current?.focus();
  }, [prompt?.id, prompt?.kind]);
  useEffect(() => {
    if (finished.current) return;
    if (AsyncResult.isFailure(state)) {
      finished.current = true;
      finish("failed", formatEnvironmentQueryError(state.cause));
    } else if (result && result.status !== "running") {
      finished.current = true;
      finish(result.status, result.message);
    }
  }, [state, result, finish]);
  const send = (requestId: string, answer: { value: string } | { confirmed: boolean }) => {
    if (pendingRequest.current !== null || cancelling || result?.status !== "running") return;
    pendingRequest.current = requestId;
    setSubmitting(true);
    setError(null);
    void respond({ environmentId, input: { flowId, requestId, ...answer } }).then((response) => {
      if (!mounted.current || promptId.current !== requestId) return;
      if (response._tag === "Failure") {
        const cause = squashAtomCommandFailure(response);
        setError(cause instanceof Error ? cause.message : String(cause));
        pendingRequest.current = null;
        setSubmitting(false);
      } else setValue("");
    });
  };
  const url = result?.url && /^https?:\/\//i.test(result.url) ? result.url : null;
  const control = (
    <div className="flex items-center gap-1.5">
      {!prompt ? (
        <span role="status" className="flex items-center gap-1.5 text-xs">
          <Spinner size="sm" />
          {result?.message ??
            (isNeoProxy
              ? "Connecting…"
              : url || result?.userCode
                ? "Waiting for browser…"
                : "Working…")}
        </span>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={cancelling}
        onClick={() => {
          if (cancelling) return;
          setCancelling(true);
          void cancel({ environmentId, input: { flowId } }).then((response) => {
            if (!mounted.current) return;
            if (response._tag === "Failure") {
              const cause = squashAtomCommandFailure(response);
              setError(cause instanceof Error ? cause.message : String(cause));
              setCancelling(false);
            }
          });
        }}
      >
        Cancel
      </Button>
    </div>
  );
  const status = error ? (
    <p role="alert" className="text-xs text-destructive">
      {error}
    </p>
  ) : prompt && result?.message ? (
    <p role="status" className="text-xs text-muted-foreground">
      {result.message}
    </p>
  ) : null;
  const body = (
    <div className="space-y-3">
      {url ? (
        <InlineButton render={<a href={url} target="_blank" rel="noreferrer noopener" />}>
          Open sign-in page
        </InlineButton>
      ) : null}
      {result?.userCode ? <Kbd>{result.userCode}</Kbd> : null}
      {result?.instructions ? (
        <p className="whitespace-pre-wrap text-xs text-muted-foreground">{result.instructions}</p>
      ) : null}
      {prompt?.kind === "input" ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (value.trim()) send(prompt.id, { value });
          }}
        >
          <label className="block space-y-1.5 text-sm">
            <span>{prompt.title}</span>
            <Input
              ref={inputRef}
              aria-label={prompt.title}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              inputMode={isNeoProxy && !prompt.secret ? "url" : undefined}
              type={prompt.secret ? "password" : "text"}
              value={value}
              placeholder={prompt.placeholder ?? undefined}
              disabled={submitting || cancelling}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          <Button type="submit" size="sm" disabled={!value.trim() || submitting || cancelling}>
            Continue
          </Button>
        </form>
      ) : prompt?.kind === "confirm" ? (
        <Alert
          role="group"
          aria-labelledby={`${confirmationId}-title`}
          aria-describedby={`${confirmationId}-message`}
        >
          <AlertTitle
            ref={confirmationRef}
            id={`${confirmationId}-title`}
            role="heading"
            aria-level={3}
            tabIndex={-1}
          >
            {prompt.title}
          </AlertTitle>
          <AlertDescription>
            <p
              id={`${confirmationId}-message`}
              tabIndex={0}
              className="max-h-64 overflow-y-auto font-mono text-xs break-words whitespace-pre-wrap select-text"
            >
              {prompt.message}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={submitting || cancelling}
                onClick={() => send(prompt.id, { confirmed: false })}
              >
                {isNeoProxy ? "Don't trust" : "Decline"}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={submitting || cancelling}
                onClick={() => send(prompt.id, { confirmed: true })}
              >
                {isNeoProxy ? "Trust this server" : "Confirm"}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
  return variant === "card" ? (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {control}
      </div>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      {status}
      {body}
    </div>
  ) : (
    <SettingsRow title={title} description={description} status={status} control={control}>
      {body}
    </SettingsRow>
  );
}
