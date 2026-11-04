import type { ComponentProps } from "react";

import { cn } from "~/lib/utils";

/**
 * The dock stays on the chat frame edge with an opaque background, so the
 * conversation never scrolls behind the prompt. Inside it the prompt is a card
 * centered on the conversation column, as in the floating composer.
 */
function Shell({
  contextStrip = false,
  className,
  ...props
}: ComponentProps<"div"> & { contextStrip?: boolean }) {
  return (
    <div
      data-slot="composer-shell"
      data-with-context={contextStrip || undefined}
      className={cn(
        "@container/composer-surface group/composer-surface relative isolate w-full bg-background px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4",
        "[--chat-composer-drawer-inset:1.375rem] [--chat-composer-glass-surface:var(--chat-composer-surface)] [--chat-composer-outline:var(--border)]",
        className,
      )}
      {...props}
    />
  );
}

function Host({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="composer-host"
      className={cn(
        "relative z-10 mx-auto w-full max-w-(--chat-max-width) rounded-2xl border border-(--chat-composer-outline) bg-(--chat-composer-glass-surface) shadow-composer dark:shadow-none",
        // Card-relative gutters for the prompt, attachments and footer.
        "[--workspace-gutter-start:0.875rem] [--workspace-gutter-end:0.875rem]",
        className,
      )}
      {...props}
    />
  );
}

function Main({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-chat-composer-main-surface="true"
      className={cn("group relative z-10 rounded-2xl", className)}
      {...props}
    />
  );
}

/** A plain row under the card (environment, worktree, branch) with no surface of its own. */
function ContextStrip({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="composer-context-strip"
      className={cn(
        "group/composer-context relative mx-auto flex w-full max-w-(--chat-max-width) items-center gap-2 overflow-x-clip overflow-y-visible px-2 pt-1.5 text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export const ComposerSurface = { Shell, Host, Main, ContextStrip };
