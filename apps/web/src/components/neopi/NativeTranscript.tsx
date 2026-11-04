import type { EnvironmentId, NeoPiNativeSessionRef, ScopedThreadRef } from "@t3tools/contracts";
import type {
  AssistantRow,
  DividerRow,
  NoteRow,
  RecordRow,
  ThinkingRow,
  ToolRow,
  TranscriptImage,
  TranscriptRow,
  UserRow,
  WorkToggleRow,
} from "@t3tools/client-runtime/neopi-transcript";
import { modelDisplayName } from "@t3tools/client-runtime/neopi-transcript";
import {
  ArrowRightLeftIcon,
  BotIcon,
  BracesIcon,
  BrainIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CodeIcon,
  EyeIcon,
  FilePlusIcon,
  GlobeIcon,
  HourglassIcon,
  InfoIcon,
  ListChecksIcon,
  MessageCircleIcon,
  NotebookPenIcon,
  RadioIcon,
  SearchIcon,
  SparklesIcon,
  SquarePenIcon,
  TerminalIcon,
  WrenchIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import {
  createContext,
  memo,
  use,
  useCallback,
  useMemo,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import ChatMarkdown from "../ChatMarkdown";
import { cn } from "../../lib/utils";
import type { ExpandedImagePreview } from "../chat/ExpandedImagePreview";
import { NativeMarkdownFilePreview } from "./NativeMarkdownFilePreview";
import { NativeCommandOutput } from "./NativeCommandOutput";

/**
 * The native NeoPi transcript, drawn as a conversation. Rows come from
 * `projectTranscript`; this file only decides how each kind looks.
 *
 * Reading order of attention: the person's words (bubble), the agent's
 * answer (prose), then the work between them as quiet one-line steps that
 * open on demand. Native records never appear inline; the debug toggle adds a
 * small JSON affordance to every row instead.
 */

export interface NativeTranscriptContext {
  readonly environmentId: EnvironmentId;
  readonly nativeRef: NeoPiNativeSessionRef | undefined;
  readonly threadRef: ScopedThreadRef | undefined;
  readonly cwd: string | undefined;
  readonly debug: boolean;
  readonly onToggleGroup: (groupId: string) => void;
  readonly onImageExpand: ((preview: ExpandedImagePreview) => void) | undefined;
  /** Rows the reader opened; survives list recycling. */
  readonly openRows: Set<string>;
}

export const NativeTranscriptCtx = createContext<NativeTranscriptContext>(null!);

const MESSAGE_HEADING_LEVEL = 3;

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function stopRowToggle(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

/** Row-level disclosure state that survives LegendList recycling. */
function useOpenRow(id: string) {
  const ctx = use(NativeTranscriptCtx);
  const [open, setOpen] = useState(() => ctx.openRows.has(id));
  const toggle = useCallback(() => {
    setOpen((previous) => {
      const next = !previous;
      if (next) ctx.openRows.add(id);
      else ctx.openRows.delete(id);
      return next;
    });
  }, [ctx.openRows, id]);
  return [open, toggle] as const;
}

function Chevron({ open, hidden = false }: { open: boolean; hidden?: boolean }) {
  return (
    <span
      className={cn("flex size-4 shrink-0 items-center justify-center", hidden && "invisible")}
      aria-hidden
    >
      <ChevronRightIcon
        className={cn(
          "size-3 shrink-0 text-icon-muted opacity-70 transition-transform duration-200",
          open && "rotate-90",
        )}
      />
    </span>
  );
}

function formatClock(timestamp: string): string | null {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function RowClock({ timestamp, className }: { timestamp: string; className?: string }) {
  const label = formatClock(timestamp);
  if (!label) return null;
  return (
    <time
      dateTime={timestamp}
      title={new Date(timestamp).toLocaleString()}
      className={cn(
        "shrink-0 text-2xs tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100",
        className,
      )}
    >
      {label}
    </time>
  );
}

/** Pretty JSON behind a tiny toggle; shown only while debug is on. */
function NativeRecord({ value, label = "Native record" }: { value: unknown; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1 ms-7">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((previous) => !previous);
        }}
        onPointerDown={stopRowToggle}
        className="inline-flex items-center gap-1 rounded px-1 py-0.5 font-mono text-3xs text-muted-foreground hover:bg-accent/30 hover:text-foreground"
        aria-expanded={open}
      >
        <BracesIcon className="size-3" aria-hidden />
        {label}
      </button>
      {open ? (
        <pre
          className="mt-1 max-h-80 cursor-text select-text overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/40 p-3 font-mono text-2xs"
          onClick={stopRowToggle}
          onPointerDown={stopRowToggle}
        >
          {JSON.stringify(value, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

function DebugRecord({ value, label }: { value: unknown; label?: string }) {
  const ctx = use(NativeTranscriptCtx);
  return ctx.debug ? <NativeRecord value={value} {...(label ? { label } : {})} /> : null;
}

function Markdown({
  text,
  className,
  lineBreaks,
  streaming,
}: {
  text: string;
  className?: string;
  lineBreaks?: boolean;
  streaming?: boolean;
}) {
  const ctx = use(NativeTranscriptCtx);
  const [file, setFile] = useState<string | null>(null);
  const openFile = useCallback((path: string) => setFile(path), []);
  return (
    <>
      <ChatMarkdown
        text={text}
        cwd={ctx.cwd}
        threadRef={ctx.threadRef}
        nativeRef={ctx.nativeRef}
        environmentId={ctx.environmentId}
        onOpenFile={ctx.nativeRef ? openFile : undefined}
        onImageExpand={ctx.onImageExpand}
        headingLevelOffset={MESSAGE_HEADING_LEVEL}
        {...(className ? { className } : {})}
        lineBreaks={lineBreaks === true}
        isStreaming={streaming === true}
      />
      {file && ctx.nativeRef ? (
        <NativeMarkdownFilePreview
          environmentId={ctx.environmentId}
          nativeRef={ctx.nativeRef}
          cwd={ctx.cwd}
          path={file}
          onClose={() => setFile(null)}
        />
      ) : null}
    </>
  );
}

function ImageGrid({
  images,
  className,
  maxHeight = "max-h-64",
}: {
  images: ReadonlyArray<TranscriptImage>;
  className?: string;
  maxHeight?: string;
}) {
  const ctx = use(NativeTranscriptCtx);
  if (images.length === 0) return null;
  const expand = (index: number) =>
    ctx.onImageExpand?.({
      images: images.map((image, position) => ({ src: image.src, name: `Image ${position + 1}` })),
      index,
    });
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {images.map((image, index) => (
        <button
          key={index}
          type="button"
          aria-label={`Open image ${index + 1} of ${images.length}`}
          className="overflow-hidden rounded-md border border-border/60 bg-background/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
          onClick={(event) => {
            event.stopPropagation();
            expand(index);
          }}
          onPointerDown={stopRowToggle}
        >
          <img
            src={image.src}
            alt=""
            loading="lazy"
            className={cn("block max-w-[min(100%,28rem)] object-contain", maxHeight)}
          />
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

function UserRowView({ row }: { row: UserRow }) {
  return (
    <div className="group/row flex flex-col items-end gap-1 py-2">
      <div className="relative max-w-[80%] rounded-2xl bg-message px-3.5 py-2.5 text-message-foreground">
        <h3 className="sr-only select-none">You</h3>
        <ImageGrid images={row.images} className="mb-2" maxHeight="max-h-48" />
        {row.text ? <Markdown text={row.text} lineBreaks /> : null}
        {row.files.length ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {row.files.map((file) => (
              <li
                key={file.path}
                title={file.skippedReason ?? undefined}
                className={cn(
                  "rounded-md border border-border/60 bg-background/50 px-1.5 py-0.5 font-mono text-2xs",
                  file.skippedReason && "line-through opacity-70",
                )}
              >
                {file.path}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="flex items-center gap-2 pe-1 text-2xs text-muted-foreground">
        {row.steering ? <span>steered mid-turn</span> : null}
        {row.live ? <span>sending…</span> : <RowClock timestamp={row.timestamp} />}
      </div>
      <DebugRecord value={row.entry} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assistant
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return `${minutes}m ${rest}s`;
}

function AssistantRowView({ row }: { row: AssistantRow }) {
  const meta = row.meta;
  return (
    <div className="group/row relative min-w-0 px-1 py-1.5">
      <h3 className="sr-only select-none">Agent</h3>
      <ImageGrid images={row.images} {...(row.text ? { className: "mb-2" } : {})} />
      {row.text ? <Markdown text={row.text} streaming={row.live} /> : null}
      {meta ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-muted-foreground">
          {meta.model ? <span>{modelDisplayName(meta.model)}</span> : null}
          {meta.durationMs !== null ? <span>{formatDuration(meta.durationMs)}</span> : null}
          {meta.outputTokens ? <span>{meta.outputTokens.toLocaleString()} tokens out</span> : null}
          {meta.stopReason === "aborted" ? <span className="text-warning">interrupted</span> : null}
          {meta.errorMessage && meta.stopReason !== "aborted" ? (
            <span className="text-destructive">{meta.errorMessage}</span>
          ) : null}
          <RowClock timestamp={row.timestamp} />
        </div>
      ) : null}
      <DebugRecord value={row.entry} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thinking
// ---------------------------------------------------------------------------

const ThinkingRowView = memo(function ThinkingRowView({ row }: { row: ThinkingRow }) {
  const [open, toggle] = useOpenRow(row.id);
  return (
    <div className={cn("group/row flex flex-col", open && "mb-1")}>
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="flex cursor-pointer select-none items-center gap-1.5 rounded-md px-0.5 py-0.5 text-start transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
      >
        <span className="flex size-6 shrink-0 items-center justify-center text-icon-muted">
          <BrainIcon aria-hidden className="block size-4 shrink-0 stroke-2 opacity-70" />
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-sm leading-relaxed text-secondary-label">
            {row.live ? "Thinking…" : row.summary ? "Thought (summary)" : "Thought"}
          </span>
          <RowClock timestamp={row.timestamp} />
          <Chevron open={open} />
        </span>
      </button>
      {open ? (
        <div className="mt-1 ms-7 flex max-h-96 flex-col gap-3 overflow-auto px-0.5 py-1 select-text">
          <Markdown text={row.text} className="text-foreground/80" lineBreaks />
        </div>
      ) : null}
      <DebugRecord value={row.entry} />
    </div>
  );
});

// ---------------------------------------------------------------------------
// Tool rows
// ---------------------------------------------------------------------------

function toolIcon(name: string): ReactNode {
  const className = "block size-4 shrink-0 stroke-2";
  switch (name) {
    case "bash":
      return <TerminalIcon className={className} aria-hidden />;
    case "read":
      return <EyeIcon className={className} aria-hidden />;
    case "write":
      return <FilePlusIcon className={className} aria-hidden />;
    case "edit":
    case "ast_edit":
      return <SquarePenIcon className={className} aria-hidden />;
    case "glob":
    case "grep":
    case "find":
      return <SearchIcon className={className} aria-hidden />;
    case "web_search":
    case "browser":
      return <GlobeIcon className={className} aria-hidden />;
    case "task":
      return <BotIcon className={className} aria-hidden />;
    case "ask":
      return <MessageCircleIcon className={className} aria-hidden />;
    case "eval":
      return <CodeIcon className={className} aria-hidden />;
    case "todo":
      return <ListChecksIcon className={className} aria-hidden />;
    case "wait":
      return <HourglassIcon className={className} aria-hidden />;
    case "ctl":
      return <RadioIcon className={className} aria-hidden />;
    case "context_notes":
      return <NotebookPenIcon className={className} aria-hidden />;
    case "manage_skill":
      return <SparklesIcon className={className} aria-hidden />;
    default:
      return <WrenchIcon className={className} aria-hidden />;
  }
}

const LONG_ARGUMENT = 240;

/** Arguments as a reader would want them: the one big text as code, the rest as a key list. */
function ToolArguments({ name, args }: { name: string; args: Record<string, unknown> }) {
  const entries = Object.entries(args).filter(([key]) => key !== "i");
  if (entries.length === 0) return null;
  const primaryKey =
    name === "bash"
      ? "command"
      : name === "eval"
        ? "code"
        : name === "edit"
          ? "input"
          : name === "write"
            ? "content"
            : null;
  const primary = primaryKey ? args[primaryKey] : undefined;
  const rest = entries.filter(([key]) => key !== primaryKey);
  return (
    <div className="space-y-2">
      {typeof primary === "string" ? (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/60 px-3 py-2 font-mono text-(length:--font-size-code,var(--text-2xs)) leading-relaxed">
          {name === "bash" ? `$ ${primary}` : primary}
        </pre>
      ) : null}
      {rest.length ? (
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-2xs">
          {rest.map(([key, value]) => {
            const text =
              typeof value === "string"
                ? value
                : typeof value === "number" || typeof value === "boolean"
                  ? String(value)
                  : JSON.stringify(value, null, 1);
            const long = text.length > LONG_ARGUMENT || text.includes("\n");
            return (
              <div key={key} className="contents">
                <dt className="font-mono text-muted-foreground">{key}</dt>
                <dd className="min-w-0">
                  {long ? (
                    <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/60 px-2 py-1.5 font-mono leading-relaxed">
                      {text}
                    </pre>
                  ) : (
                    <span className="break-words font-mono">{text}</span>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : null}
    </div>
  );
}

const RESULT_PREVIEW_LIMIT = 24_000;

function ToolResultView({ row }: { row: ToolRow }) {
  const result = row.result;
  if (!result) {
    return (
      <p className="text-2xs text-muted-foreground">
        {row.live ? "Running…" : "No result recorded on this branch."}
      </p>
    );
  }
  const text = result.text;
  const truncated = text.length > RESULT_PREVIEW_LIMIT;
  return (
    <div className="space-y-2">
      <ImageGrid images={result.images} />
      {text.trim().length ? (
        <pre
          className={cn(
            "max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md px-3 py-2 font-mono text-(length:--font-size-code,var(--text-2xs)) leading-relaxed",
            result.isError
              ? "bg-error-surface/60 text-error-foreground"
              : "bg-background/60 text-secondary-label",
          )}
        >
          {truncated
            ? `${text.slice(0, RESULT_PREVIEW_LIMIT)}\n… ${(text.length - RESULT_PREVIEW_LIMIT).toLocaleString()} more characters`
            : text}
        </pre>
      ) : result.images.length === 0 ? (
        <p className="text-2xs text-muted-foreground">Finished without output.</p>
      ) : null}
    </div>
  );
}

const ToolRowView = memo(function ToolRowView({ row }: { row: ToolRow }) {
  const [open, toggle] = useOpenRow(row.id);
  const failed = row.result?.isError === true;
  const running = row.result === null && row.live;
  const pending = row.result === null && !row.live;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Nested controls (images, debug JSON) keep their own keyboard behaviour.
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  };
  // Only a click that ends a real text selection is withheld from the toggle.
  const onLabelClick = (event: MouseEvent<HTMLElement>) => {
    if (open && (window.getSelection()?.toString().length ?? 0) > 0) event.stopPropagation();
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-label={failed ? `${row.label}, failed` : row.label}
      onClick={toggle}
      onKeyDown={onKeyDown}
      className={cn(
        "group/row relative flex cursor-pointer flex-col rounded-md px-0.5 py-0.5 transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
        open && "mb-1",
      )}
    >
      <div className="flex select-none items-center gap-1.5">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center",
            failed ? "text-tool-error-icon/70" : "text-icon-muted",
            running && "animate-pulse",
          )}
          role={failed ? "img" : undefined}
          aria-label={failed ? "Tool call failed" : undefined}
        >
          {toolIcon(row.call.name)}
        </span>
        <p className="flex min-w-0 flex-1 items-baseline gap-1.5 text-sm leading-relaxed">
          <span
            className={cn(
              "min-w-0 flex-1 text-secondary-label",
              open ? "whitespace-pre-wrap break-words select-text" : "truncate",
            )}
            onClick={onLabelClick}
          >
            {row.label}
          </span>
        </p>
        {failed ? <XIcon aria-hidden className="size-3 shrink-0 text-tool-error-icon/70" /> : null}
        {pending ? (
          <span className="text-2xs text-muted-foreground" title="No result on this branch">
            ·
          </span>
        ) : null}
        <RowClock timestamp={row.timestamp} />
        <Chevron open={open} />
      </div>
      {open ? (
        <div
          className="mt-1 ms-7 cursor-default space-y-3 rounded-md bg-muted/40 px-3 py-2"
          onClick={stopRowToggle}
          onPointerDown={stopRowToggle}
        >
          <ToolArguments name={row.call.name} args={row.call.arguments} />
          <ToolResultView row={row} />
        </div>
      ) : null}
      {open ? (
        <>
          <DebugRecord value={row.entry} label="Call record" />
          {row.result ? <DebugRecord value={row.result.entry} label="Result record" /> : null}
        </>
      ) : null}
    </div>
  );
});

const WorkToggleRowView = memo(function WorkToggleRowView({ row }: { row: WorkToggleRow }) {
  const ctx = use(NativeTranscriptCtx);
  const label = `Worked through ${row.count} steps${row.failed ? ` · ${row.failed} failed` : ""}`;
  return (
    <button
      type="button"
      onClick={() => ctx.onToggleGroup(row.groupId)}
      aria-expanded={row.expanded}
      className="group/row flex w-full cursor-pointer select-none items-center gap-1.5 rounded-md px-0.5 py-0.5 text-start transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
    >
      <span className="flex size-6 shrink-0 items-center justify-center text-icon-muted">
        <WrenchIcon aria-hidden className="block size-4 shrink-0 stroke-2 opacity-70" />
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-sm leading-relaxed">
        <span className="shrink-0 text-secondary-label">{label}</span>
        {!row.expanded ? (
          <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
            {row.preview.join(" · ")}
          </span>
        ) : null}
      </span>
      <RowClock timestamp={row.timestamp} />
      <Chevron open={row.expanded} />
    </button>
  );
});

// ---------------------------------------------------------------------------
// Notes, dividers, records, commands
// ---------------------------------------------------------------------------

function noteIcon(tone: NoteRow["tone"]): ReactNode {
  const className = "block size-4 shrink-0 stroke-2 opacity-70";
  if (tone === "error") return <CircleAlertIcon className={className} aria-hidden />;
  if (tone === "notice") return <ZapIcon className={className} aria-hidden />;
  return <InfoIcon className={className} aria-hidden />;
}

/** First readable line of a note, with any XML wrapper reduced to its text. */
function firstLine(text: string): string {
  const plain = text.replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ");
  const line =
    plain
      .split("\n")
      .find((part) => part.trim().length > 0)
      ?.trim() ?? "";
  if (line) return line;
  // A note that is only a tag carries its message in attributes.
  return [...text.matchAll(/\w+="([^"]*)"/g)].map((match) => match[1]).join(" · ");
}

const NoteRowView = memo(function NoteRowView({ row }: { row: NoteRow }) {
  const [open, toggle] = useOpenRow(row.id);
  const preview = firstLine(row.text);
  const short = row.text.trim().length <= 160 && !row.text.includes("\n");
  return (
    <div className={cn("group/row flex flex-col", open && "mb-1")}>
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="flex cursor-pointer select-none items-center gap-1.5 rounded-md px-0.5 py-0.5 text-start transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
      >
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center",
            row.tone === "error" ? "text-destructive" : "text-icon-muted",
          )}
        >
          {noteIcon(row.tone)}
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-sm leading-relaxed">
          <span
            className={cn(
              "shrink-0 capitalize",
              row.tone === "error" ? "text-destructive" : "text-secondary-label",
            )}
          >
            {row.label}
          </span>
          {!open ? (
            <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
              {preview}
            </span>
          ) : null}
        </span>
        <RowClock timestamp={row.timestamp} />
        <Chevron open={open} hidden={short && preview === row.text.trim()} />
      </button>
      {open ? (
        <div
          className="mt-1 ms-7 max-h-96 cursor-default overflow-auto rounded-md bg-muted/40 px-3 py-2 select-text"
          onClick={stopRowToggle}
          onPointerDown={stopRowToggle}
        >
          <Markdown text={row.text} className="text-foreground/85" lineBreaks />
        </div>
      ) : null}
      <DebugRecord value={row.entry} />
    </div>
  );
});

function DividerRowView({ row }: { row: DividerRow }) {
  return (
    <div className="group/row flex items-center gap-3 py-2 text-2xs text-muted-foreground">
      <span className="h-px flex-1 bg-border/70" />
      <span className="flex items-center gap-1.5">
        <ArrowRightLeftIcon className="size-3 opacity-70" aria-hidden />
        {row.text}
      </span>
      <span className="h-px flex-1 bg-border/70" />
      <DebugRecord value={row.entry} />
    </div>
  );
}

function RecordRowView({ row }: { row: RecordRow }) {
  return (
    <div className="group/row flex items-center gap-1.5 py-0.5">
      <span className="flex size-6 shrink-0 items-center justify-center text-icon-muted">
        <BracesIcon className="block size-4 shrink-0 stroke-2 opacity-60" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">{row.label}</span>
      <RowClock timestamp={row.timestamp} />
      <NativeRecord value={row.entry} label="JSON" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export const NativeTranscriptRowView = memo(function NativeTranscriptRowView({
  row,
}: {
  row: TranscriptRow;
}) {
  switch (row.kind) {
    case "user":
      return <UserRowView row={row} />;
    case "assistant":
      return <AssistantRowView row={row} />;
    case "thinking":
      return <ThinkingRowView row={row} />;
    case "tool":
      return <ToolRowView row={row} />;
    case "work-toggle":
      return <WorkToggleRowView row={row} />;
    case "note":
      return <NoteRowView row={row} />;
    case "divider":
      return <DividerRowView row={row} />;
    case "record":
      return <RecordRowView row={row} />;
    case "command":
      return (
        <div className="my-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2">
          <NativeCommandOutput text={row.text} />
        </div>
      );
  }
});

/** Vertical rhythm: conversation rows breathe, work rows sit tight. */
export function transcriptRowClassName(_row: TranscriptRow): string {
  return "mx-auto w-full max-w-(--chat-max-width) px-5";
}

export function transcriptRowType(row: TranscriptRow): string {
  return row.kind;
}

export function useTranscriptOpenRows() {
  return useMemo(() => new Set<string>(), []);
}
