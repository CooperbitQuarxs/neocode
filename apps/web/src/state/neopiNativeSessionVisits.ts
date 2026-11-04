import type { NativeSessionVisitState } from "@t3tools/client-runtime/neopi-native-session-attention";
import type { EnvironmentId } from "@t3tools/contracts";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Visits kept per environment; the oldest are dropped past this. */
const MAX_VISITED_SESSIONS = 400;

interface NativeSessionVisits {
  readonly environments: Readonly<Record<string, NativeSessionVisitState>>;
  /**
   * First sight of an environment's sessions: everything up to now counts as
   * already seen, so a fresh client does not report history as unread.
   */
  readonly establishBaseline: (environmentId: EnvironmentId, newestActivityAt: string) => void;
  /**
   * The user looked at this session. `activityAt` is the session's own latest
   * activity, so a server clock ahead of this one cannot leave it unread.
   */
  readonly markVisited: (
    environmentId: EnvironmentId,
    sessionFile: string,
    activityAt?: string,
  ) => void;
}

const laterOf = (a: string, b: string | undefined) => (b !== undefined && b > a ? b : a);

export const useNativeSessionVisits = create(
  persist<NativeSessionVisits>(
    (set) => ({
      environments: {},
      establishBaseline: (environmentId, newestActivityAt) =>
        set((state) => {
          if (state.environments[environmentId]) return state;
          const baseline = laterOf(new Date().toISOString(), newestActivityAt);
          return {
            environments: { ...state.environments, [environmentId]: { baseline, visited: {} } },
          };
        }),
      markVisited: (environmentId, sessionFile, activityAt) =>
        set((state) => {
          const current = state.environments[environmentId];
          if (!current) return state;
          const visitedAt = laterOf(new Date().toISOString(), activityAt);
          const visited = { ...current.visited, [sessionFile]: visitedAt };
          const files = Object.keys(visited);
          if (files.length > MAX_VISITED_SESSIONS) {
            files
              .sort((a, b) => (visited[a]! < visited[b]! ? -1 : 1))
              .slice(0, files.length - MAX_VISITED_SESSIONS)
              .forEach((file) => delete visited[file]);
          }
          return {
            environments: { ...state.environments, [environmentId]: { ...current, visited } },
          };
        }),
    }),
    { name: "neocode-native-session-visits" },
  ),
);

export const establishNativeSessionBaseline = (
  ...args: Parameters<NativeSessionVisits["establishBaseline"]>
) => useNativeSessionVisits.getState().establishBaseline(...args);
export const markNativeSessionVisited = (...args: Parameters<NativeSessionVisits["markVisited"]>) =>
  useNativeSessionVisits.getState().markVisited(...args);
