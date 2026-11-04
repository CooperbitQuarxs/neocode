import {
  nativeSessionKey,
  type NativeSessionTarget,
} from "@t3tools/client-runtime/neopi-native-sessions";

export type NativeSessionTabs = readonly NativeSessionTarget[];

const indexOfTab = (tabs: NativeSessionTabs, target: NativeSessionTarget) => {
  const key = nativeSessionKey(target);
  return tabs.findIndex((tab) => nativeSessionKey(tab) === key);
};

/** Opening a session that already has a tab keeps its place. */
export function openNativeSessionTab(
  tabs: NativeSessionTabs,
  target: NativeSessionTarget,
): NativeSessionTabs {
  return indexOfTab(tabs, target) === -1 ? [...tabs, target] : tabs;
}

/** NeoPi moved the session to another file (fork, branch): the tab follows in place. */
export function replaceNativeSessionTab(
  tabs: NativeSessionTabs,
  from: NativeSessionTarget,
  to: NativeSessionTarget,
): NativeSessionTabs {
  const fromIndex = indexOfTab(tabs, from);
  if (fromIndex === -1) return openNativeSessionTab(tabs, to);
  if (indexOfTab(tabs, to) !== -1) return tabs.filter((_, index) => index !== fromIndex);
  return tabs.map((tab, index) => (index === fromIndex ? to : tab));
}

/** Closing the active tab activates its right neighbour, else its left one, like a browser. */
export function closeNativeSessionTab(
  tabs: NativeSessionTabs,
  active: NativeSessionTarget | null,
  closing: NativeSessionTarget,
): { readonly tabs: NativeSessionTabs; readonly active: NativeSessionTarget | null } {
  const index = indexOfTab(tabs, closing);
  if (index === -1) return { tabs, active };
  const remaining = tabs.filter((_, position) => position !== index);
  if (!active || nativeSessionKey(active) !== nativeSessionKey(closing))
    return { tabs: remaining, active };
  return { tabs: remaining, active: remaining[index] ?? remaining[index - 1] ?? null };
}

/** Wraps around. With no active tab, next starts at the first and previous at the last. */
export function cycleNativeSessionTab(
  tabs: NativeSessionTabs,
  active: NativeSessionTarget | null,
  direction: "previous" | "next",
): NativeSessionTarget | null {
  if (tabs.length === 0) return null;
  const index = active ? indexOfTab(tabs, active) : -1;
  if (index === -1) return (direction === "next" ? tabs[0] : tabs.at(-1)) ?? null;
  const step = direction === "next" ? 1 : -1;
  return tabs[(index + step + tabs.length) % tabs.length] ?? null;
}
