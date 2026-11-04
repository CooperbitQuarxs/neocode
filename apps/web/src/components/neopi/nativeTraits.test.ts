import { describe, expect, it } from "vite-plus/test";

import { nextPromotableNativeQueuedMessageId, nativeQueuedMessages } from "./nativeTimeline";
import {
  nativeTraitsCommands,
  nativeTraitsDescriptors,
  nativeTraitsStateFromSession,
  parseNativeThinkingLevels,
} from "./nativeTraits";

const levels = ["off", "low", "medium", "high", "xhigh"];

describe("native traits", () => {
  it("reads levels and state from NeoPi", () => {
    expect(parseNativeThinkingLevels({ levels: ["off", 3, "high", ""] })).toEqual(["off", "high"]);
    expect(parseNativeThinkingLevels(null)).toEqual([]);
    expect(
      nativeTraitsStateFromSession(
        {
          thinkingLevel: "high",
          fastModeEnabled: true,
          model: { id: "m", supportsFastMode: true },
        },
        levels,
      ),
    ).toEqual({ thinkingLevel: "high", levels, fastModeSupported: true, fastModeEnabled: true });
    expect(nativeTraitsStateFromSession({}, []).fastModeSupported).toBe(false);
  });

  it("offers exactly NeoPi's levels, and fast mode only when the model supports it", () => {
    const [effort, fast] = nativeTraitsDescriptors({
      thinkingLevel: "medium",
      levels,
      fastModeSupported: true,
      fastModeEnabled: false,
    });
    expect(effort).toMatchObject({
      id: "effort",
      type: "select",
      currentValue: "medium",
      options: levels.map((id) => expect.objectContaining({ id })),
    });
    expect(fast).toMatchObject({ id: "fastMode", type: "boolean", currentValue: false });
    expect(
      nativeTraitsDescriptors({
        thinkingLevel: "off",
        levels: ["off"],
        fastModeSupported: false,
        fastModeEnabled: true,
      }),
    ).toEqual([]);
  });

  it("keeps a current level NeoPi did not list so the trigger stays truthful", () => {
    const [effort] = nativeTraitsDescriptors({
      thinkingLevel: "inherit",
      levels,
      fastModeSupported: false,
      fastModeEnabled: false,
    });
    expect(effort?.type === "select" && effort.options.at(-1)?.id).toBe("inherit");
  });

  it("turns only changed selections into RPCs", () => {
    const current = { thinkingLevel: "medium", fastModeEnabled: false };
    expect(
      nativeTraitsCommands(current, [
        { id: "effort", value: "high" },
        { id: "fastMode", value: false },
      ]),
    ).toEqual([{ type: "set_thinking_level", level: "high" }]);
    expect(
      nativeTraitsCommands(current, [
        { id: "effort", value: "medium" },
        { id: "fastMode", value: true },
      ]),
    ).toEqual([{ type: "set_fast_mode", enabled: true }]);
    expect(nativeTraitsCommands(current, undefined)).toEqual([]);
  });
});

describe("Enter sends the queued prompt now", () => {
  const queued = (queue: Parameters<typeof nativeQueuedMessages>[0]) =>
    nativeQueuedMessages(queue, "2026-11-04T00:00:00.000Z");

  it("promotes the oldest follow-up", () => {
    const messages = queued({ steering: [], followUp: ["first", "second"], liveSteered: 0 });
    expect(nextPromotableNativeQueuedMessageId(messages)).toBe(messages[0]?.id);
  });

  it("skips prompts that are already steering", () => {
    const messages = queued({
      steering: ["steered", "waiting"],
      followUp: ["later"],
      liveSteered: 1,
    });
    expect(nextPromotableNativeQueuedMessageId(messages)).toBe(messages[2]?.id);
    expect(
      nextPromotableNativeQueuedMessageId(
        queued({ steering: ["steered"], followUp: [], liveSteered: 1 }),
      ),
    ).toBeNull();
  });

  it("does nothing with an empty queue", () => {
    expect(nextPromotableNativeQueuedMessageId([])).toBeNull();
  });
});
