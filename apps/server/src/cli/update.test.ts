import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import {
  HostProcessArchitecture,
  HostProcessEnvironment,
  HostProcessInvokedAs,
  HostProcessPlatform,
  HostProcessWorkingDirectory,
} from "@t3tools/shared/hostProcess";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { repointLauncher, resolveLauncherPath, resolveNewestVersion } from "./update.ts";

it.effect("finds a stable build only when its host archive and checksums are published", () => {
  const version = "1.2.3+build.39488899088.2";
  const requests: string[] = [];
  const client = HttpClient.make((request) => {
    requests.push(request.url);
    const releases =
      requests.length === 1
        ? [
            { tag_name: "v1.2.4-nightly.20261020.39488899088.1+build.2", assets: [] },
            {
              tag_name: `v${version}`,
              assets: [{ name: "SHA256SUMS" }, { name: "t3-1.2.3-linux-x64.tar.gz" }],
            },
            {
              tag_name: `v${version}`,
              assets: [{ name: "SHA256SUMS" }, { name: `t3-${version}-win32-x64.zip` }],
            },
          ]
        : [
            {
              tag_name: `v${version}`,
              assets: [{ name: "SHA256SUMS" }, { name: `t3-${version}-linux-x64.tar.gz` }],
            },
          ];
    return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(releases)));
  });
  return Effect.gen(function* () {
    assert.equal(yield* resolveNewestVersion("stable"), version);
    assert.deepEqual(requests, [
      "https://api.github.com/repos/PsychedelicShayna/neocode/releases?per_page=100&page=1",
      "https://api.github.com/repos/PsychedelicShayna/neocode/releases?per_page=100&page=2",
    ]);
  }).pipe(
    Effect.provideService(HttpClient.HttpClient, client),
    Effect.provideService(HostProcessPlatform, "linux"),
    Effect.provideService(HostProcessArchitecture, "x64"),
  );
});

it.layer(NodeServices.layer)("t3 update launcher", (it) => {
  it.effect("repoints a symlink that lives in a runtime versions tree", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-update-" });
      const oldExe = path.join(root, "runtime/versions/1.0.0/t3");
      const newExe = path.join(root, "runtime/versions/2.0.0/t3");
      const launcher = path.join(root, "bin/t3");
      for (const file of [oldExe, newExe]) {
        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        yield* fs.writeFileString(file, "");
      }
      yield* fs.makeDirectory(path.dirname(launcher), { recursive: true });
      yield* fs.symlink(oldExe, launcher);

      const repointed = yield* repointLauncher({
        launchedAs: launcher,
        versionsDir: path.join(root, "runtime/versions"),
        targetEntryPath: newExe,
      });

      assert.deepStrictEqual(Option.getOrUndefined(repointed), launcher);
      assert.equal(yield* fs.readLink(launcher), newExe);
    }).pipe(Effect.scoped, Effect.provideService(HostProcessPlatform, "linux")),
  );

  it.effect("leaves a plain copy or a foreign symlink alone", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-update-" });
      const newExe = path.join(root, "runtime/versions/2.0.0/t3");
      const copy = path.join(root, "copy/t3");
      const foreign = path.join(root, "foreign/t3");
      const elsewhere = path.join(root, "elsewhere/t3");
      // Another install's versions tree: same shape, different home.
      const otherHome = path.join(root, "other/runtime/versions/1.0.0/t3");
      const otherLauncher = path.join(root, "other/bin/t3");
      for (const file of [newExe, copy, elsewhere, otherHome]) {
        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        yield* fs.writeFileString(file, "");
      }
      yield* fs.makeDirectory(path.dirname(foreign), { recursive: true });
      yield* fs.symlink(elsewhere, foreign);
      yield* fs.makeDirectory(path.dirname(otherLauncher), { recursive: true });
      yield* fs.symlink(otherHome, otherLauncher);

      for (const launchedAs of [copy, foreign, otherLauncher, undefined]) {
        const repointed = yield* repointLauncher({
          launchedAs,
          versionsDir: path.join(root, "runtime/versions"),
          targetEntryPath: newExe,
        });
        assert.equal(repointed._tag, "None", launchedAs ?? "undefined");
      }
      assert.equal(yield* fs.readLink(foreign), elsewhere);
      assert.equal(yield* fs.readLink(otherLauncher), otherHome);
    }).pipe(Effect.scoped, Effect.provideService(HostProcessPlatform, "linux")),
  );

  it.effect("finds the launcher a bare command name resolved to on PATH", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-update-" });
      const launcher = path.join(root, "bin/t3");
      yield* fs.makeDirectory(path.dirname(launcher), { recursive: true });
      yield* fs.writeFileString(launcher, "");

      const bare = yield* resolveLauncherPath.pipe(
        Effect.provideService(HostProcessInvokedAs, "t3"),
        Effect.provideService(HostProcessEnvironment, {
          PATH: `${path.join(root, "missing")}:${path.join(root, "bin")}`,
        }),
        Effect.provideService(HostProcessWorkingDirectory, root),
      );
      const relative = yield* resolveLauncherPath.pipe(
        Effect.provideService(HostProcessInvokedAs, "./bin/t3"),
        Effect.provideService(HostProcessEnvironment, { PATH: "" }),
        Effect.provideService(HostProcessWorkingDirectory, root),
      );
      const absent = yield* resolveLauncherPath.pipe(
        Effect.provideService(HostProcessInvokedAs, "t3"),
        Effect.provideService(HostProcessEnvironment, { PATH: path.join(root, "missing") }),
        Effect.provideService(HostProcessWorkingDirectory, root),
      );

      assert.equal(bare, launcher);
      assert.equal(relative, launcher);
      assert.equal(absent, undefined);
    }).pipe(Effect.scoped, Effect.provideService(HostProcessPlatform, "linux")),
  );
});
