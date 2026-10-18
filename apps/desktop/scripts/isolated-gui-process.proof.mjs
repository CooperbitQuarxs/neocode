// Owner-only explicit proof. This file is deliberately not an auto-discovered test.
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";

const modes = [
  "real",
  "termignore",
  "discfail",
  "latefatal",
  "earlyeio",
  "identity-change",
  "group-change",
  "mount-root",
  "mount-child",
  "mount-sibling",
  "mount-read",
  "mount-malformed",
  "timeout",
  "interrupt",
];
const mode = process.argv[2] === "--case" ? process.argv[3] : undefined;
if (!modes.includes(mode))
  throw new Error(`Usage: node isolated-gui-process.proof.mjs --case ${modes.join("|")}`);
// oxlint-disable-next-line t3code/no-global-process-runtime -- Explicit owner-run standalone proof.
if (NodeOS.platform() !== "linux")
  throw new Error(
    "This owner proof driver requires Linux; Windows/macOS native proof remains separate",
  );
const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const repository = NodePath.resolve(here, "../../..");
const root = NodeFS.mkdtempSync("/tmp/t3-gui-proof-");
const write = (name, value) =>
  NodeFS.writeFileSync(NodePath.join(root, name), value, { mode: 0o600 });
const json = (name) => JSON.parse(NodeFS.readFileSync(NodePath.join(root, name), "utf8"));
const quote = (value) => `'${value.replace(/'/g, "'\\''")}'`;
let entry = NodePath.join(here, "smoke-test.mjs");
if (mode !== "real") {
  const executable = NodePath.join(root, "fixture");
  write(
    "fixture",
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(NodePath.join(here, "isolated-gui-process.proof-fixture.mjs"))} "$@"\n`,
  );
  NodeFS.chmodSync(executable, 0o700);
  entry = NodePath.join(root, "run.mjs");
  write(
    "run.mjs",
    `import {runIsolatedGuiProcess} from ${JSON.stringify(NodePath.join(repository, "scripts/lib/isolated-gui-process.mjs"))};
import fs from "node:fs";
const signals=["SIGINT","SIGTERM","SIGHUP"];
const existing=signals.map(signal=>process.listeners(signal));
const result=await runIsolatedGuiProcess({
 executable:${JSON.stringify(executable)},cwd:${JSON.stringify(repository)},
 readinessPatterns:["app ready","desktop app control socket ready","main window created"],
 fatalPatterns:["Uncaught Error"],startupTimeoutMs:6000,cleanupTimeoutMs:8000,
 env:{HOME:"/untrusted/home",USERPROFILE:"/untrusted/home",APPDATA:"/untrusted/config",LOCALAPPDATA:"/untrusted/data",T3CODE_HOME:"/untrusted/t3",XDG_CONFIG_HOME:"/untrusted/config",XDG_DATA_HOME:"/untrusted/data",XDG_CACHE_HOME:"/untrusted/cache",XDG_STATE_HOME:"/untrusted/state",XDG_RUNTIME_DIR:"/untrusted/runtime",TMPDIR:"/untrusted/"+"deep/".repeat(80),TMP:"/untrusted/tmp",TEMP:"/untrusted/tmp",DISPLAY:":0",WAYLAND_DISPLAY:"host",XAUTHORITY:"/untrusted/auth",DBUS_SESSION_BUS_ADDRESS:"unix:path=/untrusted/bus",DBUS_SYSTEM_BUS_ADDRESS:"unix:path=/untrusted/system",DBUS_STARTER_ADDRESS:"unix:path=/untrusted/starter",XDG_CURRENT_DESKTOP:"host",XDG_SESSION_DESKTOP:"host",XDG_SESSION_TYPE:"wayland",DESKTOP_SESSION:"host",SESSION_MANAGER:"host",GVFS_DISABLE_FUSE:"0",T3CODE_DESKTOP_SMOKE_ROOT:"/untrusted/root"}
});
fs.writeFileSync(${JSON.stringify(NodePath.join(root, "outcome.json"))},JSON.stringify({...result,failure:result.failure?.message,cleanupFailure:result.cleanupFailure?.message,handlersRestored:signals.every((signal,i)=>{const after=process.listeners(signal);return after.length===existing[i].length&&after.every((listener,j)=>listener===existing[i][j]);})}),{mode:0o600});
process.exitCode=result.exitCode;
`,
  );
}
const stdout = NodeFS.openSync(NodePath.join(root, "runner.stdout"), "wx", 0o600);
const stderr = NodeFS.openSync(NodePath.join(root, "runner.stderr"), "wx", 0o600);
const env = {
  PATH: process.env.PATH,
  LANG: "C.UTF-8",
  HOME: NodePath.join(root, "driver-home"),
  TMPDIR: root,
  T3CODE_GUI_PROOF_ROOT: root,
  T3CODE_GUI_PROOF_CASE: mode,
  T3CODE_GUI_PROOF_ENTRY: entry,
};
NodeFS.mkdirSync(env.HOME, { mode: 0o700 });
console.log(`Owner proof artifacts: ${root}`);
const child = NodeChildProcess.spawn(
  process.execPath,
  ["--import", NodePath.join(here, "isolated-gui-process.proof-hook.mjs"), entry],
  {
    cwd: repository,
    env,
    stdio: ["ignore", stdout, stderr],
  },
);
// Only the runner captured at spawn is signalled. This bounds the observer,
// not descendant cleanup: a watchdog expiry is always a failed owner proof.
function waitForRunner(runner, timeoutMs = 55_000, graceMs = 2_000) {
  let terminate;
  let kill;
  let closed;
  let deadlineExpired = false;
  return new Promise((resolve, reject) => {
    runner.once("error", reject);
    runner.once("close", (code, signal) => resolve({ code, signal, deadlineExpired }));
    terminate = setTimeout(() => {
      deadlineExpired = true;
      runner.kill("SIGTERM");
      kill = setTimeout(() => {
        runner.kill("SIGKILL");
        closed = setTimeout(
          () => reject(new Error("Captured proof runner did not close after SIGKILL")),
          graceMs,
        );
      }, graceMs);
    }, timeoutMs);
  }).finally(() => {
    clearTimeout(terminate);
    clearTimeout(kill);
    clearTimeout(closed);
  });
}
let status;
try {
  status = await waitForRunner(child);
} finally {
  NodeFS.closeSync(stdout);
  NodeFS.closeSync(stderr);
}
const { deadlineExpired } = status;
const expectedFailure = [
  "discfail",
  "latefatal",
  "earlyeio",
  "mount-root",
  "mount-child",
  "mount-read",
  "mount-malformed",
  "timeout",
].includes(mode);
const expectedCode = mode === "interrupt" ? 143 : expectedFailure ? 1 : 0;
const launch = json("launch.json");
const state = NodePath.join(launch.scratch, "state");
const retained = [
  "discfail",
  "earlyeio",
  "mount-root",
  "mount-child",
  "mount-read",
  "mount-malformed",
].includes(mode);
const records = NodeFS.existsSync(NodePath.join(root, "observed.jsonl"))
  ? NodeFS.readFileSync(NodePath.join(root, "observed.jsonl"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  : [];
const identities = [launch, ...records];
const survivors = [];
for (const identity of identities) {
  try {
    const fields = NodeFS.readFileSync(`/proc/${identity.pid}/stat`, "utf8")
      .split(") ")
      .at(-1)
      .trim()
      .split(/\s+/);
    if (fields[19] === identity.identity) survivors.push(identity);
  } catch (error) {
    if (!["ENOENT", "ESRCH"].includes(error.code)) throw error;
  }
}
const mounts = [];
for (const line of NodeFS.readFileSync("/proc/self/mounts", "utf8").trim().split("\n")) {
  const encoded = line.split(/\s+/)[1];
  if (!encoded) throw new Error("Independent mount observation could not be parsed");
  const mounted = NodePath.resolve(
    encoded.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8))),
  );
  if (
    [root, launch.scratch].some(
      (candidate) => mounted === candidate || mounted.startsWith(`${candidate}/`),
    )
  )
    mounts.push(mounted);
}
write(
  "receipt.json",
  JSON.stringify(
    {
      mode,
      status,
      deadlineExpired,
      launch,
      survivors,
      mounts,
      stateExists: NodeFS.existsSync(state),
      expectedCode,
      expectedStateRetained: retained,
      globalDiscoveryVerified: !["discfail", "earlyeio"].includes(mode),
    },
    null,
    2,
  ),
);
NodeAssert.equal(deadlineExpired, false, "Owner proof exceeded its own deadline");
NodeAssert.equal(status.code, expectedCode);
NodeAssert.equal(status.signal, null);
NodeAssert.equal(
  survivors.length,
  0,
  "Captured creation identities must be gone, not merely the wrapper",
);
NodeAssert.equal(mounts.length, 0, "No actual owned mounts may remain");
NodeAssert.equal(NodeFS.existsSync(state), retained);
NodeAssert.equal(
  NodeFS.existsSync(NodePath.join(root, "unsafe-signal.json")),
  false,
  "Changed identity/group must not authorize a group signal",
);
NodeAssert.ok(NodeFS.existsSync(NodePath.join(launch.scratch, "output.log")));
NodeAssert.equal(NodeFS.statSync(NodePath.join(launch.scratch, "output.log")).mode & 0o777, 0o600);
json("launch-exit.json"); // Exact captured launcher was reaped.
if (mode === "earlyeio") {
  NodeAssert.equal(
    NodeFS.existsSync(NodePath.join(root, "frontend.json")),
    false,
    "First discovery must precede application/private-bus/Xvfb startup",
  );
  NodeAssert.equal(records.length, 0);
} else {
  const runtime =
    mode === "real"
      ? records.find((record) => record.args.some((arg) => arg.endsWith("dist-electron/boot.cjs")))
      : json("frontend.json");
  NodeAssert.ok(runtime, "Actual runtime arguments must have been observed");
  const environment = runtime.initialEnvironment
    ? Object.fromEntries(
        runtime.initialEnvironment.map((item) => {
          const at = item.indexOf("=");
          return [item.slice(0, at), item.slice(at + 1)];
        }),
      )
    : runtime.env;
  for (const [key, relative] of Object.entries({
    HOME: "home",
    USERPROFILE: "home",
    APPDATA: "config",
    LOCALAPPDATA: "data",
    XDG_CONFIG_HOME: "config",
    XDG_DATA_HOME: "data",
    XDG_CACHE_HOME: "cache",
    XDG_STATE_HOME: "local-state",
    XDG_RUNTIME_DIR: "runtime",
    T3CODE_HOME: "t3",
    TMPDIR: "tmp",
    TMP: "tmp",
    TEMP: "tmp",
  }))
    NodeAssert.equal(environment[key], NodePath.join(state, relative));
  NodeAssert.ok(environment.DISPLAY && !/^:0(?:\.|$)/.test(environment.DISPLAY));
  NodeAssert.ok(environment.DBUS_SESSION_BUS_ADDRESS?.startsWith("unix:"));
  NodeAssert.equal(environment.GVFS_DISABLE_FUSE, "1");
  NodeAssert.equal(environment.XDG_SESSION_TYPE, "x11");
  NodeAssert.equal(environment.T3CODE_DESKTOP_SMOKE_ROOT, launch.scratch);
  for (const key of [
    "WAYLAND_DISPLAY",
    "XDG_CURRENT_DESKTOP",
    "XDG_SESSION_DESKTOP",
    "DBUS_SYSTEM_BUS_ADDRESS",
    "DBUS_STARTER_ADDRESS",
    "DESKTOP_SESSION",
    "SESSION_MANAGER",
  ])
    NodeAssert.equal(environment[key], undefined);
  NodeAssert.ok(runtime.args.includes("--password-store=basic"));
  NodeAssert.ok(runtime.args.includes(`--user-data-dir=${NodePath.join(state, "profile")}`));
  if (mode === "real") {
    const backend = records.find((record) =>
      record.args.some((arg) => arg.endsWith("dist/bin.mjs")),
    );
    NodeAssert.ok(backend, "Observe actual backend startup, not only Electron's outer environment");
    const inherited = Object.fromEntries(
      backend.initialEnvironment.map((item) => {
        const at = item.indexOf("=");
        return [item.slice(0, at), item.slice(at + 1)];
      }),
    );
    for (const key of [
      "HOME",
      "DISPLAY",
      "DBUS_SESSION_BUS_ADDRESS",
      "T3CODE_HOME",
      "XDG_RUNTIME_DIR",
      "GVFS_DISABLE_FUSE",
    ])
      NodeAssert.equal(inherited[key], environment[key]);
    for (const key of ["WAYLAND_DISPLAY", "XDG_CURRENT_DESKTOP", "XDG_SESSION_DESKTOP"])
      NodeAssert.equal(inherited[key], undefined);
  } else {
    const backend = json("backend.json");
    const observed = json("backend-observed.json");
    NodeAssert.equal(backend.identity, observed.identity);
    NodeAssert.equal(backend.pid, observed.pid);
    NodeAssert.equal(backend.group, backend.pid, "Backend must have its own detached group");
    NodeAssert.notEqual(backend.group, runtime.group);
  }
}
if (["discfail", "earlyeio", "identity-change", "group-change", "mount-read"].includes(mode))
  NodeAssert.ok(NodeFS.readFileSync(NodePath.join(root, "fault-hits.jsonl"), "utf8").trim());
if (mode !== "real") {
  const outcome = json("outcome.json");
  NodeAssert.equal(outcome.handlersRestored, true);
  NodeAssert.equal(outcome.cleanupVerified, !retained);
}
console.log(
  `PASS ${mode}: outcome ${status.code}; captured identities gone; actual mounts clear; state ${retained ? "retained" : "deleted"}. Private receipts: ${root}`,
);
