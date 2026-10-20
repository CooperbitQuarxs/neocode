import { describe, expect, it } from "vite-plus/test";

import {
  cliArchiveFileName,
  cliArchivePlatformKey,
  cliArchiveTarCommand,
  cliReleaseDownloadBaseUrl,
  cliReleaseChannelOf,
  cliReleaseIndexPageUrl,
  newestCliReleaseVersion,
  parseChecksums,
} from "./cliRelease.ts";

const publishedRelease = (version: string, draft = false) => ({
  tag_name: `v${version}`,
  draft,
  assets: [{ name: "SHA256SUMS" }, { name: cliArchiveFileName(version, "linux-x64") }],
});

describe("cliRelease", () => {
  it("names archives by version and platform, zip only on Windows", () => {
    expect(cliArchiveFileName("1.2.3-preview.20260911.4", "linux-x64")).toBe(
      "t3-1.2.3-preview.20260911.4-linux-x64.tar.gz",
    );
    expect(cliArchiveFileName("1.2.3", "win32-x64")).toBe("t3-1.2.3-win32-x64.zip");
  });

  it("only maps platforms and architectures that have a release archive", () => {
    expect(cliArchivePlatformKey("darwin", "arm64")).toBe("darwin-arm64");
    expect(cliArchivePlatformKey("linux", "x64")).toBe("linux-x64");
    expect(cliArchivePlatformKey("win32", "x64")).toBe("win32-x64");
    // Node single-executables are unsupported on x64 macOS.
    expect(cliArchivePlatformKey("darwin", "x64")).toBeUndefined();
    expect(cliArchivePlatformKey("linux", "arm64")).toBe("linux-arm64");
    expect(cliArchivePlatformKey("win32", "arm64")).toBe("win32-arm64");
    expect(cliArchivePlatformKey("freebsd", "x64")).toBeUndefined();
    expect(cliArchivePlatformKey("linux", "ia32")).toBeUndefined();
  });

  it("resolves download URLs under the tagged release, honoring a mirror", () => {
    expect(cliReleaseDownloadBaseUrl("1.2.3")).toBe(
      "https://github.com/PsychedelicShayna/neocode/releases/download/v1.2.3",
    );
    expect(cliReleaseDownloadBaseUrl("1.2.3", "https://mirror.example/t3/")).toBe(
      "https://mirror.example/t3/v1.2.3",
    );
  });

  it("parses sha256sum output with relative paths and binary-mode markers", () => {
    const checksums = parseChecksums(
      [
        `${"a".repeat(64)}  ./t3-1.2.3-linux-x64.tar.gz`,
        `${"B".repeat(64)} *t3-1.2.3-win32-x64.zip`,
        "not a checksum line",
        "",
      ].join("\n"),
    );
    expect(checksums.get("t3-1.2.3-linux-x64.tar.gz")).toBe("a".repeat(64));
    expect(checksums.get("t3-1.2.3-win32-x64.zip")).toBe("b".repeat(64));
    expect(checksums.size).toBe(2);
  });

  it("extracts with the System32 bsdtar on Windows and plain tar elsewhere", () => {
    expect(cliArchiveTarCommand("linux", {})).toBe("tar");
    expect(cliArchiveTarCommand("win32", { SystemRoot: "D:\\Win" })).toBe(
      "D:\\Win\\System32\\tar.exe",
    );
    expect(cliArchiveTarCommand("win32", {})).toBe("C:\\Windows\\System32\\tar.exe");
  });

  it("derives the release channel from the version alone", () => {
    expect(cliReleaseChannelOf("1.2.3")).toBe("stable");
    expect(cliReleaseChannelOf("1.2.3-nightly.20260911.4")).toBe("nightly");
    expect(cliReleaseChannelOf("1.2.3-preview.20260911.4")).toBe("preview");
    expect(cliReleaseChannelOf("1.2.3-nightly.20261020.39488899088.1")).toBe("nightly");
    expect(cliReleaseChannelOf("1.2.3-preview.20261020.39488899088.2")).toBe("preview");
    expect(cliReleaseChannelOf("1.2.3+build.39488899088.1")).toBe("stable");
    expect(cliReleaseChannelOf("1.2.3-nightly.20261020.39488899088.1+build.2")).toBe("nightly");
    expect(cliReleaseChannelOf("1.2.3-preview.20261020.39488899088.1+build.2")).toBe("preview");
    // A prerelease that is not one of our trains is not silently a nightly.
    expect(cliReleaseChannelOf("1.2.3-rc.1")).toBe("stable");
  });

  it("picks the newest non-draft release on the requested channel", () => {
    const releases = [
      publishedRelease("1.2.4-preview.20260912.9.1", true),
      publishedRelease("1.2.4-preview.20260912.8.2"),
      publishedRelease("1.2.4-nightly.20260912.7.1"),
      { tag_name: "desktop-preview", assets: [] },
      publishedRelease("1.2.3"),
      publishedRelease("1.2.3-nightly.20260911.2"),
    ];
    expect(newestCliReleaseVersion(releases, "preview")).toBe("1.2.4-preview.20260912.8.2");
    expect(newestCliReleaseVersion(releases, "nightly")).toBe("1.2.4-nightly.20260912.7.1");
    expect(newestCliReleaseVersion(releases, "stable")).toBe("1.2.3");
    expect(newestCliReleaseVersion([publishedRelease("1.2.3")], "preview")).toBeUndefined();
  });

  it("keeps the full stable build version for downloads, archives and mirrored checksums", () => {
    const version = "1.2.3+build.39488899088.2";
    const releases = [
      publishedRelease("1.2.4-nightly.20261020.39488899088.1+build.3"),
      publishedRelease("1.2.4-preview.20261020.39488899088.1+build.3"),
      {
        ...publishedRelease("1.2.3+build.39488899089.1"),
        assets: publishedRelease("1.2.3").assets,
      },
      publishedRelease(version),
    ];
    const selected = newestCliReleaseVersion(releases, "stable", "linux-x64");
    expect(selected).toBe(version);
    const fileName = cliArchiveFileName(selected!, "linux-x64");
    expect(fileName).toBe(`t3-${version}-linux-x64.tar.gz`);
    expect(cliReleaseDownloadBaseUrl(selected!, "https://mirror.example/releases/")).toBe(
      `https://mirror.example/releases/v${version}`,
    );
    expect(parseChecksums(`${"a".repeat(64)}  ./${fileName}\n`).get(fileName)).toBe("a".repeat(64));
  });

  it("skips incomplete releases and archives for other platforms", () => {
    const release = publishedRelease("1.2.3+build.4.1");
    expect(
      newestCliReleaseVersion([{ ...release, assets: release.assets.slice(1) }], "stable"),
    ).toBeUndefined();
    expect(
      newestCliReleaseVersion([{ ...release, assets: release.assets.slice(0, 1) }], "stable"),
    ).toBeUndefined();
    expect(newestCliReleaseVersion([release], "stable", "darwin-arm64")).toBeUndefined();
    expect(
      newestCliReleaseVersion(
        [{ ...release, assets: publishedRelease("1.2.3").assets }, publishedRelease("1.2.2")],
        "stable",
        "linux-x64",
      ),
    ).toBe("1.2.2");
  });

  it("pages through the release index at the largest page GitHub allows", () => {
    expect(cliReleaseIndexPageUrl(1)).toBe(
      "https://api.github.com/repos/PsychedelicShayna/neocode/releases?per_page=100&page=1",
    );
    expect(cliReleaseIndexPageUrl(3)).toContain("page=3");
  });
});
