import type { DesktopUpdateChannel } from "@t3tools/contracts";

// Release runs may end in a numeric attempt or a pinned canary's git revision.
const NIGHTLY_VERSION_PATTERN = /^[^-+]+-nightly\.\d{8}\.\d+(?:\.(?:\d+|[a-f0-9]{7,40}))?$/;
// Preview builds are the maintainers' test train, cut by hand from unreleased
// branches to exercise the release flow. They share nightly's branding but
// are packaged without an update feed (see
// isDesktopPreviewVersion in scripts/build-desktop-artifact.ts), so the
// channel a preview install reports is cosmetic: it never checks for updates
// and no updater feed ever lists a preview release.
const PRERELEASE_VERSION_PATTERN =
  /^[^-+]+-(?:nightly|preview)\.\d{8}\.\d+(?:\.(?:\d+|[a-f0-9]{7,40}))?$/;

export function isNightlyDesktopVersion(version: string): boolean {
  return PRERELEASE_VERSION_PATTERN.test(version);
}

export function resolveDefaultDesktopUpdateChannel(appVersion: string): DesktopUpdateChannel {
  return NIGHTLY_VERSION_PATTERN.test(appVersion) ? "nightly" : "latest";
}
