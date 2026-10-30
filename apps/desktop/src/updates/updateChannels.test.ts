import { describe, expect, it } from "vite-plus/test";

import { isNightlyDesktopVersion, resolveDefaultDesktopUpdateChannel } from "./updateChannels.ts";

describe("updateChannels", () => {
  it.each([
    "0.0.41-nightly.20260911.7",
    "0.0.42-nightly.20261020.39505137750.1",
    "0.0.42-nightly.20261028.2.beb7e0771a",
  ])("keeps nightly branding and update feed for %s", (version) => {
    expect(isNightlyDesktopVersion(version)).toBe(true);
    expect(resolveDefaultDesktopUpdateChannel(version)).toBe("nightly");
  });

  it("keeps preview builds branded as nightly but on the latest update channel", () => {
    expect(isNightlyDesktopVersion("0.0.41-preview.20260911.7")).toBe(true);
    expect(resolveDefaultDesktopUpdateChannel("0.0.41-preview.20260911.7")).toBe("latest");
    expect(isNightlyDesktopVersion("0.0.42-preview.20261020.39505137750.1")).toBe(true);
    expect(resolveDefaultDesktopUpdateChannel("0.0.42-preview.20261020.39505137750.1")).toBe(
      "latest",
    );
    expect(isNightlyDesktopVersion("0.0.42-preview.20261028.2.beb7e0771a")).toBe(true);
    expect(resolveDefaultDesktopUpdateChannel("0.0.42-preview.20261028.2.beb7e0771a")).toBe(
      "latest",
    );
  });

  it.each([
    "1.2.3-foo-preview.20260911.1",
    "1.2.3",
    "1.2.3+build.39505137750.1",
    "1.2.3-nightly.20261020.39505137750.",
    "1.2.3-nightly.20261020.39505137750.retry",
    "1.2.3-nightly.20261020.39505137750.1.2",
  ])("does not classify %s as a nightly build", (version) => {
    expect(isNightlyDesktopVersion(version)).toBe(false);
    expect(resolveDefaultDesktopUpdateChannel(version)).toBe("latest");
  });
});
