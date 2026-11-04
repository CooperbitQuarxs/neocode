import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { nativeDictationAvailable } from "./nativeDictation";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const base = {
  isDesktop: true,
  localEnvironmentDisabled: false,
  environmentId: local,
  primaryEnvironmentId: local,
  attachment: "owned" as const,
};

describe("native dictation availability", () => {
  it("is offered only for an owned session on the desktop app's own backend", () => {
    expect(nativeDictationAvailable(base)).toBe(true);
    expect(nativeDictationAvailable({ ...base, isDesktop: false })).toBe(false);
    expect(nativeDictationAvailable({ ...base, environmentId: remote })).toBe(false);
    expect(nativeDictationAvailable({ ...base, primaryEnvironmentId: null })).toBe(false);
    expect(nativeDictationAvailable({ ...base, localEnvironmentDisabled: true })).toBe(false);
    expect(nativeDictationAvailable({ ...base, attachment: "terminal" })).toBe(false);
    expect(nativeDictationAvailable({ ...base, attachment: undefined })).toBe(false);
  });
});
