import { describe, expect, it } from "vite-plus/test";

import { AGENT_NAME_CATALOG } from "./agentNameCatalog.ts";
import { agentIdentity, nativeSessionIdentityKey } from "./agentNames.ts";

const sessionIds = Array.from(
  { length: 5000 },
  (_, index) => `01a0d991-${index.toString(16).padStart(4, "0")}-7237-9515-784545e350a5`,
);

describe("agent name catalog", () => {
  it("is large enough to be memorable and has no duplicate names", () => {
    expect(AGENT_NAME_CATALOG.length).toBeGreaterThanOrEqual(250);
    const names = AGENT_NAME_CATALOG.map((entry) => entry.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it("has clean entries", () => {
    for (const entry of AGENT_NAME_CATALOG) {
      expect(entry.name).toBe(entry.name.trim());
      expect(entry.name.length).toBeGreaterThan(1);
      expect(["she", "he"]).toContain(entry.gender);
    }
  });
});

describe("agentIdentity", () => {
  it("is deterministic and well formed", () => {
    const first = agentIdentity("01a0d991-8cab-7237-9515-784545e350a5");
    expect(agentIdentity("01a0d991-8cab-7237-9515-784545e350a5")).toEqual(first);
    expect(first.designation).toMatch(/^[A-HJ-NP-Z]-\d\d$/);
    expect(first.label).toBe(`${first.name} ${first.designation}`);
    expect(first.pronouns).toBe(first.gender === "she" ? "she/her" : "he/him");
  });

  it("draws the name and its pronouns from the same catalog entry", () => {
    for (const id of sessionIds.slice(0, 200)) {
      const identity = agentIdentity(id);
      expect(
        AGENT_NAME_CATALOG.some(
          (entry) =>
            entry.name === identity.name &&
            entry.gender === identity.gender &&
            entry.origin === identity.origin,
        ),
      ).toBe(true);
    }
  });

  it("uses the whole catalog and every designation letter roughly evenly", () => {
    const names = new Map<string, number>();
    const letters = new Map<string, number>();
    for (const id of sessionIds) {
      const identity = agentIdentity(id);
      names.set(identity.name, (names.get(identity.name) ?? 0) + 1);
      letters.set(identity.designation[0]!, (letters.get(identity.designation[0]!) ?? 0) + 1);
    }
    // 5000 draws over ~360 names: every name is hit, none dominates.
    expect(names.size).toBeGreaterThan(AGENT_NAME_CATALOG.length * 0.95);
    expect(Math.max(...names.values())).toBeLessThan(40);
    expect(letters.size).toBe(24);
    expect(Math.max(...letters.values())).toBeLessThan((5000 / 24) * 1.4);
  });

  it("rarely repeats a full label across many sessions", () => {
    const labels = new Set(sessionIds.map((id) => agentIdentity(id).label));
    expect(labels.size).toBeGreaterThan(sessionIds.length * 0.99);
  });

  it("draws from a replacement catalog", () => {
    const catalog = [{ name: "Only", gender: "she", origin: "tes" }] as const;
    expect(agentIdentity("anything", catalog).name).toBe("Only");
    expect(agentIdentity("anything", catalog).pronouns).toBe("she/her");
  });
});

describe("nativeSessionIdentityKey", () => {
  const id = "01a0d991-8cab-7237-9515-784545e350a5";
  const file = `/home/me/.pi/agent/sessions/--home-me--/2026-09-25T17-16-29-739Z_${id}.jsonl`;

  it("prefers the session id", () => {
    expect(nativeSessionIdentityKey({ sessionId: id, sessionFile: file })).toBe(id);
  });

  it("recovers the same key from the file name, so a name does not change when the id arrives", () => {
    expect(nativeSessionIdentityKey({ sessionFile: file })).toBe(id);
    expect(nativeSessionIdentityKey({ sessionId: "", sessionFile: file })).toBe(id);
    expect(agentIdentity(nativeSessionIdentityKey({ sessionFile: file }))).toEqual(
      agentIdentity(
        nativeSessionIdentityKey({ sessionId: id, sessionFile: "/moved/x_other.jsonl" }),
      ),
    );
  });

  it("keeps a moved session's identity through its id and falls back to the path", () => {
    expect(nativeSessionIdentityKey({ sessionId: id, sessionFile: "/wt/moved.jsonl" })).toBe(id);
    expect(nativeSessionIdentityKey({ sessionFile: "/native/session.jsonl" })).toBe(
      "/native/session.jsonl",
    );
  });
});
