import type { NativeSessionTarget } from "@t3tools/client-runtime/neopi-native-sessions";
import { useEffect } from "react";
import { selectAgentView, useAgentViewStore } from "./agentViewStore";
import { NativeAgentHub } from "./NativeAgentHub";
import { NativeAgentView } from "./NativeAgentView";

/**
 * The Agent Hub or an opened agent, covering the session's main area. The session
 * stays mounted underneath, inert, so its scroll position and draft survive the trip.
 */
export function NativeAgentOverlay({
  target,
  viewKey,
  cwd,
}: {
  target: NativeSessionTarget;
  viewKey: string;
  cwd: string | null;
}) {
  const mode = useAgentViewStore((store) => selectAgentView(viewKey)(store).mode);
  const dispatch = useAgentViewStore((store) => store.dispatch);
  const open = mode !== "session";
  useEffect(() => {
    if (!open) return;
    // Focus can fall to the page body (the focused row unmounted, a click on empty space);
    // Escape must still leave the view.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.target !== document.body && event.target !== document.documentElement) return;
      if (document.querySelector('[data-slot$="-popup"]')) return;
      event.preventDefault();
      dispatch(viewKey, { type: "back" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, dispatch, viewKey]);
  if (mode === "session") return null;
  const back = () => dispatch(viewKey, { type: "back" });
  return (
    <div className="absolute inset-0 z-30 flex min-h-0 flex-col bg-background">
      {mode === "hub" ? (
        <NativeAgentHub viewKey={viewKey} onClose={back} />
      ) : (
        <NativeAgentView target={target} viewKey={viewKey} cwd={cwd} onBack={back} />
      )}
    </div>
  );
}
