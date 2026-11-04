import { describe, expect, it } from "vite-plus/test";
import { reduceAgentView, SESSION_AGENT_VIEW } from "./agentViewStore";

describe("agent view transitions", () => {
  it("returns an agent opened from the hub to the hub, then to the session", () => {
    let state = reduceAgentView(SESSION_AGENT_VIEW, { type: "toggleHub" });
    state = reduceAgentView(state, { type: "select", id: "a" });
    state = reduceAgentView(state, { type: "open", id: "a" });
    expect(state).toMatchObject({ mode: "agent", selectedId: "a", returnTo: "hub" });
    state = reduceAgentView(state, { type: "back" });
    expect(state).toMatchObject({ mode: "hub", selectedId: "a" });
    state = reduceAgentView(state, { type: "back" });
    expect(state.mode).toBe("session");
  });

  it("returns an agent opened from the panel straight to the session", () => {
    const opened = reduceAgentView(SESSION_AGENT_VIEW, { type: "open", id: "a" });
    expect(opened.returnTo).toBe("session");
    expect(reduceAgentView(opened, { type: "back" }).mode).toBe("session");
  });

  it("shows the hub from an open agent, and a second toggle closes it", () => {
    const hub = reduceAgentView(SESSION_AGENT_VIEW, { type: "toggleHub" });
    const opened = reduceAgentView(hub, { type: "open", id: "a" });
    const toggled = reduceAgentView(opened, { type: "toggleHub" });
    expect(toggled.mode).toBe("hub");
    expect(reduceAgentView(toggled, { type: "toggleHub" }).mode).toBe("session");
  });
});
