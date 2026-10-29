import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { shouldShowNeoPiThemes } from "./neopiThemeCatalogPreference";

afterEach(() => {
  vi.doUnmock("react");
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("NeoPi theme catalog preference", () => {
  it.each([null, "false", "", "TRUE", "unknown"])(
    "does not expose the catalog without explicit opt-in (%s)",
    (stored) => {
      expect(shouldShowNeoPiThemes(stored)).toBe(false);
    },
  );

  it("recognizes a persisted opt-in", () => {
    expect(shouldShowNeoPiThemes("true")).toBe(true);
  });

  it.each([null, "system", "light", "dark", "custom:not-loaded-yet"])(
    "opts in and out without changing the saved graphical choice or adopting old sync (%s)",
    async (theme) => {
      const halves = '{"dark":"custom:saved"}';
      const storage = new Map<string, string>([
        ["t3code:theme-halves:v1", halves],
        ["neocode:native-themes:follow:v1", "true"],
      ]);
      if (theme !== null) storage.set("t3code:theme", theme);
      const events = new EventTarget();
      vi.stubGlobal("window", {
        localStorage: {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: (key: string, value: string) => storage.set(key, value),
        },
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
        dispatchEvent: events.dispatchEvent.bind(events),
      });
      let current = false;
      let readSnapshot = () => false;
      let unsubscribe = () => {};
      vi.doMock("react", () => ({
        useSyncExternalStore: (
          subscribe: (listener: () => void) => () => void,
          getSnapshot: () => boolean,
        ) => {
          readSnapshot = getSnapshot;
          unsubscribe = subscribe(() => {
            current = getSnapshot();
          });
          return getSnapshot();
        },
      }));
      const { setShowNeoPiThemes, useShowNeoPiThemes } =
        await import("./neopiThemeCatalogPreference");
      current = useShowNeoPiThemes();
      expect(current).toBe(false);

      setShowNeoPiThemes(true);
      expect(current).toBe(true);
      expect(readSnapshot()).toBe(true);
      setShowNeoPiThemes(false);
      expect(current).toBe(false);
      expect(readSnapshot()).toBe(false);

      expect(storage.get("t3code:theme") ?? null).toBe(theme);
      expect(storage.get("t3code:theme-halves:v1")).toBe(halves);
      unsubscribe();
    },
  );
});
