import type { ComponentPropsWithoutRef } from "react";

import { cn } from "~/lib/utils";

/**
 * A row of tabs rests on a hairline. Put this on the strip's row and align the
 * tabs to its bottom edge: the active tab covers the line and reads as one
 * surface with the content below, every other tab stays closed off by it.
 */
export const TAB_BASELINE_CLASS = "shadow-[inset_0_-1px_0_var(--color-border)]";

/**
 * The one tab look, shared by the session tab bar and the right panel. Inside it,
 * `PanelTabCloseButton` swaps the tab's identity for a close action on hover.
 */
export function Tab({
  active,
  className,
  ...props
}: ComponentPropsWithoutRef<"div"> & { readonly active: boolean }) {
  return (
    <div
      data-active-tab={active}
      className={cn(
        "group/tab flex h-9 min-w-0 max-w-48 shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-t-lg border px-2.5 text-xs",
        active
          ? "border-border border-b-transparent bg-background text-foreground"
          : "border-border/70 border-b-border bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
