import type { DesktopConnectionCatalogRecovery } from "@t3tools/contracts";
import { create } from "zustand";

// The desktop record is authoritative; this projection survives route changes,
// while a new renderer receives the record again with its first catalog read.
export const useCatalogRecovery = create<{
  recovery: DesktopConnectionCatalogRecovery | null;
}>(() => ({ recovery: null }));
