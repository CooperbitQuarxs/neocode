import { isMonospaceFamily } from "./appearanceFonts";

// Installed families do not change during enumeration. Reuse measurements
// across the code and terminal pickers and across Appearance remounts.
const monospaceByFamily = new Map<string, boolean>();

/** Probe an opened picker without monopolizing the UI thread. */
export function filterInstalledMonospaceFonts(
  families: readonly string[],
  signal: AbortSignal,
): Promise<readonly string[]> {
  return new Promise((resolve) => {
    const matches: string[] = [];
    let index = 0;
    const scan = () => {
      if (signal.aborted) {
        resolve([]);
        return;
      }
      const deadline = performance.now() + 8;
      while (index < families.length) {
        const family = families[index++]!;
        let monospace = monospaceByFamily.get(family);
        if (monospace === undefined) {
          monospace = isMonospaceFamily(family);
          monospaceByFamily.set(family, monospace);
        }
        if (monospace) matches.push(family);
        if (performance.now() >= deadline) break;
      }
      if (index === families.length) {
        resolve(matches);
      } else {
        setTimeout(scan, 0);
      }
    };
    // Yield before the first measurement too, so opening paints immediately.
    setTimeout(scan, 0);
  });
}
