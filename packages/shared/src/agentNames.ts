import {
  AGENT_NAME_CATALOG,
  type AgentNameEntry,
  type AgentNameGender,
  type AgentNameOrigin,
} from "./agentNameCatalog.ts";

export type { AgentNameEntry, AgentNameGender, AgentNameOrigin };

/**
 * A session's name, pronouns and designation, derived from its id alone. Nothing
 * is stored or sent: every client that sees the same id computes the same
 * identity, so a session keeps its name across reloads and devices.
 */
export interface AgentIdentity {
  readonly name: string;
  readonly gender: AgentNameGender;
  readonly origin: AgentNameOrigin;
  /** One letter and two digits, e.g. `K-47`. Tells apart two sessions that drew the same name. */
  readonly designation: string;
  /** `Azura K-47`: the short handle for tabs, rows and transcript labels. */
  readonly label: string;
  /** `she/her` or `he/him`. */
  readonly pronouns: string;
}

// Without I and O, which read as 1 and 0 next to the digits.
const DESIGNATION_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const PRONOUNS: Record<AgentNameGender, string> = { she: "she/her", he: "he/him" };

/** cyrb53: a fast, well-mixed 53-bit string hash. The seed gives independent streams. */
function hash53(text: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * The identity for a stable key (a session id). `catalog` exists for tests; the
 * product always draws from `AGENT_NAME_CATALOG`.
 */
export function agentIdentity(
  key: string,
  catalog: readonly AgentNameEntry[] = AGENT_NAME_CATALOG,
): AgentIdentity {
  const entry = catalog[hash53(key, 0) % catalog.length]!;
  const designationHash = hash53(key, 1);
  const letter = DESIGNATION_LETTERS[designationHash % DESIGNATION_LETTERS.length]!;
  const digits = Math.floor(designationHash / DESIGNATION_LETTERS.length) % 100;
  const designation = `${letter}-${String(digits).padStart(2, "0")}`;
  return {
    name: entry.name,
    gender: entry.gender,
    origin: entry.origin,
    designation,
    label: `${entry.name} ${designation}`,
    pronouns: PRONOUNS[entry.gender],
  };
}

/** NeoPi session files are `<timestamp>_<sessionId>.jsonl`; the id is what the file is named for. */
const SESSION_FILE_ID = /_([^_/\\]+)\.jsonl$/;

/**
 * The key a native session's identity derives from: its id, or, before the id is
 * known (a tab that is not attached yet), the id its file name carries, so the
 * name does not change when the id arrives. A moved session keeps its id and so
 * its name. A file that does not follow the convention falls back to its path.
 */
export function nativeSessionIdentityKey(session: {
  readonly sessionId?: string | null | undefined;
  readonly sessionFile: string;
}): string {
  const id = session.sessionId?.trim();
  if (id) return id;
  return SESSION_FILE_ID.exec(session.sessionFile)?.[1] ?? session.sessionFile;
}
