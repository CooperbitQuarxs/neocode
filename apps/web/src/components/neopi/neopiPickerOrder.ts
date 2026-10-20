import type { ProviderInstanceEntry } from "../../providerInstances";

/** Prefer NeoPi in the picker rail without changing provider selection inputs. */
export function prioritizeNeoPiPickerEntries(
  entries: ReadonlyArray<ProviderInstanceEntry>,
): ReadonlyArray<ProviderInstanceEntry> {
  let sawOtherDriver = false;
  let needsReorder = false;
  for (const entry of entries) {
    if (entry.driverKind === "neopi") {
      if (sawOtherDriver) {
        needsReorder = true;
        break;
      }
    } else {
      sawOtherDriver = true;
    }
  }
  if (!needsReorder) return entries;

  const ordered: ProviderInstanceEntry[] = [];
  for (const entry of entries) {
    if (entry.driverKind === "neopi") ordered.push(entry);
  }
  for (const entry of entries) {
    if (entry.driverKind !== "neopi") ordered.push(entry);
  }
  return ordered;
}
