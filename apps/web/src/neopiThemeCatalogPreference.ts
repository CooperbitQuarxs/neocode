import { useSyncExternalStore } from "react";

// The retired follow preference never opts this client into catalog access.
const KEY = "neocode:native-themes:catalog:v1";
const EVENT = "neocode:native-theme-catalog-preference";

/** Catalog access is opt-in and never follows the runtime's active selection. */
export function shouldShowNeoPiThemes(stored: string | null): boolean {
  return stored === "true";
}
export function readShowNeoPiThemes() {
  try {
    return shouldShowNeoPiThemes(window.localStorage.getItem(KEY));
  } catch {
    return false;
  }
}
export function subscribeToNeoPiThemeCatalogPreference(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === null || event.key === KEY) listener();
  };
  window.addEventListener("storage", storage);
  window.addEventListener(EVENT, listener);
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener(EVENT, listener);
  };
}
export function setShowNeoPiThemes(show: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, String(show));
  window.dispatchEvent(new Event(EVENT));
}
export function useShowNeoPiThemes() {
  return useSyncExternalStore(
    subscribeToNeoPiThemeCatalogPreference,
    readShowNeoPiThemes,
    () => false,
  );
}
