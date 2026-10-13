import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const desktopDir = NodePath.resolve(__dirname, "..");
const mainJs = NodePath.resolve(desktopDir, "dist-electron/boot.cjs");
// oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone launcher has no Effect runtime.
const hostPlatform = NodeOS.platform();
const isLinux = hostPlatform === "linux";
const isWindows = hostPlatform === "win32";
const fatalPatterns = [
  "Cannot find module",
  "MODULE_NOT_FOUND",
  "Refused to execute",
  "Uncaught Error",
  "Uncaught TypeError",
  "Uncaught ReferenceError",
  "fatal startup",
];
const scratch = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-desktop-smoke-"));
const stateDir = NodePath.join(scratch, "state");
const logPath = NodePath.join(scratch, "output.log");
const inspectionLogPath = NodePath.join(scratch, "processes.log");
const trackedProcesses = new Map();
let child;
let logFd;
let observationTimer;
let monitor;
let launchStartedAt;
let launchReturnedAt;
let stopObservation;
let interruptedSignal;

// The backend starts in a separate POSIX group. Retain creation identities
// across ancestor exits instead of treating the outer group as an enclosure.
function processSnapshot() {
  if (isLinux) {
    const snapshot = [];
    for (const name of NodeFS.readdirSync("/proc")) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const stat = NodeFS.readFileSync(`/proc/${name}/stat`, "utf8");
        const fields = stat
          .slice(stat.lastIndexOf(")") + 2)
          .trim()
          .split(/\s+/);
        let tagged = false;
        try {
          tagged = NodeFS.readFileSync(`/proc/${name}/environ`)
            .toString()
            .split("\0")
            .includes(`T3CODE_DESKTOP_SMOKE_ROOT=${scratch}`);
        } catch (error) {
          if (!["ENOENT", "ESRCH", "EACCES", "EPERM"].includes(error.code)) throw error;
        }
        snapshot.push({
          pid: Number(name),
          parent: Number(fields[1]),
          group: Number(fields[2]),
          identity: fields[19],
          started: BigInt(fields[19]),
          tagged,
        });
      } catch (error) {
        if (!["ENOENT", "ESRCH", "EACCES", "EPERM"].includes(error.code)) throw error;
      }
    }
    return snapshot;
  }
  if (isWindows) {
    const output = NodeChildProcess.execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | Where-Object { $_.CreationDate } | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; parent = $_.ParentProcessId; identity = $_.CreationDate.ToUniversalTime().Ticks.ToString() } } | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8", timeout: 3_000, windowsHide: true },
    );
    const rows = JSON.parse(output);
    return (Array.isArray(rows) ? rows : [rows]).map((entry) => ({
      ...entry,
      started: BigInt(entry.identity),
    }));
  }
  const output = NodeChildProcess.execFileSync("ps", ["-axo", "pid=,ppid=,pgid=,lstart="], {
    encoding: "utf8",
    timeout: 3_000,
    env: { ...process.env, LC_ALL: "C" },
  });
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [pid, parent, group, ...date] = line.trim().split(/\s+/);
      const identity = date.join(" ");
      return {
        pid: Number(pid),
        parent: Number(parent),
        group: Number(group),
        identity,
        started: BigInt(Date.parse(identity)),
      };
    });
}

function remainingProcesses() {
  const snapshot = processSnapshot();
  const byPid = new Map(snapshot.map((entry) => [entry.pid, entry]));
  const owned = new Map();
  const now = isWindows ? BigInt(Date.now()) * 10_000n + 621355968000000000n : BigInt(Date.now());
  for (const entry of snapshot) {
    if (entry.tagged || trackedProcesses.get(entry.pid)?.identity === entry.identity) {
      owned.set(entry.pid, entry);
    }
  }
  if (trackedProcesses.size === 0) {
    const root = byPid.get(child.pid);
    if (root) {
      const createdAt = isWindows
        ? Number((root.started - 621355968000000000n) / 10_000n)
        : Number(root.started);
      const tolerance = isWindows ? 1 : 1_000;
      if (
        root.tagged ||
        (!isLinux &&
          createdAt >= launchStartedAt - tolerance &&
          createdAt <= launchReturnedAt + tolerance)
      ) {
        owned.set(root.pid, root);
      }
    }
    if (owned.size === 0) throw new Error("Could not establish the launched process identity");
  }
  for (const [pid, tracked] of trackedProcesses) {
    if (!byPid.has(pid) && tracked.missingAfter === undefined) tracked.missingAfter = now;
  }
  let added;
  do {
    added = false;
    for (const entry of snapshot) {
      if (owned.has(entry.pid)) continue;
      const parent = owned.get(entry.parent);
      const historicalParent = trackedProcesses.get(entry.parent);
      const orphanParent =
        !isLinux &&
        !byPid.has(entry.parent) &&
        historicalParent?.missingAfter !== undefined &&
        entry.started <= historicalParent.missingAfter
          ? historicalParent
          : undefined;
      const ancestor = parent ?? orphanParent;
      const inOwnedGroup =
        !isWindows &&
        [...owned.values()].some(
          (member) => member.group === entry.group && entry.started >= member.started,
        );
      if ((ancestor && entry.started >= ancestor.started) || inOwnedGroup) {
        owned.set(entry.pid, entry);
        added = true;
      }
    }
  } while (added);
  for (const entry of owned.values()) {
    if (
      trackedProcesses.get(entry.pid)?.identity !== entry.identity &&
      isLinux &&
      logFd !== undefined
    ) {
      try {
        // Inspect only launched processes, logging no inherited host-secret variables.
        const args = NodeFS.readFileSync(`/proc/${entry.pid}/cmdline`).toString().split("\0");
        const environment = NodeFS.readFileSync(`/proc/${entry.pid}/environ`)
          .toString()
          .split("\0");
        const isolatedEnvironment = environment.filter((value) =>
          /^(HOME|XDG_RUNTIME_DIR|XDG_CURRENT_DESKTOP|DISPLAY|DBUS_SESSION_BUS_ADDRESS|T3CODE_HOME)=/.test(
            value,
          ),
        );
        const stat = NodeFS.readFileSync(`/proc/${entry.pid}/stat`, "utf8");
        const identity = stat
          .slice(stat.lastIndexOf(")") + 2)
          .trim()
          .split(/\s+/)[19];
        if (identity !== entry.identity) continue;
        NodeFS.appendFileSync(
          inspectionLogPath,
          `Smoke process ${entry.pid}, group ${entry.group}: ${JSON.stringify(args)} ${JSON.stringify(isolatedEnvironment)}\n`,
          { mode: 0o600 },
        );
      } catch (error) {
        if (!["ENOENT", "ESRCH", "EACCES", "EPERM"].includes(error.code)) throw error;
      }
    }
    trackedProcesses.set(entry.pid, entry);
  }
  return [...owned.values()];
}

function signalProcesses(remaining, signal) {
  if (isWindows) {
    // Re-check creation identity inside the terminating command. Never let
    // taskkill /T traverse an unvalidated, reused PID.
    const identities = remaining.map((entry) => `${entry.pid}='${entry.identity}'`).join(";");
    NodeChildProcess.execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$owned=@{${identities}}; Get-CimInstance Win32_Process | Where-Object { $_.CreationDate } | ForEach-Object { if ($owned.ContainsKey([int]$_.ProcessId) -and $owned[[int]$_.ProcessId] -eq $_.CreationDate.ToUniversalTime().Ticks.ToString()) { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }`,
      ],
      { stdio: "ignore", timeout: 3_000, windowsHide: true },
    );
    return;
  }
  const groups = new Set(remaining.map((entry) => entry.group));
  for (const group of groups) {
    // The preceding group's termination may reap this group's leader.
    // Require a still-live, identity-matching member immediately before signalling.
    const fresh = new Map(processSnapshot().map((entry) => [entry.pid, entry]));
    const anchored = remaining.some(
      (entry) =>
        entry.group === group &&
        fresh.get(entry.pid)?.identity === entry.identity &&
        fresh.get(entry.pid)?.group === group,
    );
    if (!anchored) continue;
    try {
      process.kill(-group, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
}

async function cleanup() {
  clearInterval(monitor);
  clearTimeout(observationTimer);
  if (!child?.pid) return;
  const deadline = Date.now() + 8_000;
  const escalateAt = Date.now() + 2_000;
  let remaining = remainingProcesses();
  while (remaining.length > 0 && Date.now() < deadline) {
    signalProcesses(remaining, Date.now() < escalateAt ? "SIGTERM" : "SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 100));
    remaining = remainingProcesses();
  }
  if (remaining.length > 0) {
    throw new Error(
      `Smoke cleanup left processes: ${remaining.map((entry) => entry.pid).join(", ")}`,
    );
  }
}

function onSignal(signal) {
  interruptedSignal = signal;
  stopObservation?.(new Error(`Smoke interrupted by ${signal}`));
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, onSignal);

console.log("\nLaunching isolated Electron smoke test...");
console.log(`Smoke stdout/stderr: ${logPath}`);

try {
  const directories = {
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
  };
  const env = { ...process.env, VITE_DEV_SERVER_URL: "", ELECTRON_ENABLE_LOGGING: "1" };
  for (const [name, directory] of Object.entries(directories)) {
    env[name] = NodePath.join(stateDir, directory);
    NodeFS.mkdirSync(env[name], { recursive: true, mode: 0o700 });
  }
  for (const name of [
    "DBUS_SESSION_BUS_ADDRESS",
    "DBUS_STARTER_ADDRESS",
    "DBUS_STARTER_BUS_TYPE",
    "XDG_CURRENT_DESKTOP",
    "XDG_SESSION_DESKTOP",
    "DESKTOP_SESSION",
    "SESSION_MANAGER",
    "WAYLAND_DISPLAY",
    "DISPLAY",
    "XAUTHORITY",
    "ELECTRON_RUN_AS_NODE",
  ])
    delete env[name];
  if (isLinux) {
    // No inherited session address: dbus-run-session supplies a private bus.
    delete env.DBUS_SYSTEM_BUS_ADDRESS;
  }
  env.T3CODE_DESKTOP_SMOKE_ROOT = scratch;

  // Use installed Electron, not a runtime downloader or macOS registration launcher.
  let electronPath;
  try {
    electronPath = NodeModule.createRequire(import.meta.url)("electron");
    NodeFS.accessSync(electronPath, NodeFS.constants.X_OK);
  } catch (error) {
    throw new Error(
      `Electron runtime is unavailable; run vp run --filter @t3tools/desktop ensure:electron first. ${error.message}`,
      { cause: error },
    );
  }
  const args = [
    "--password-store=basic",
    `--user-data-dir=${NodePath.join(stateDir, "profile")}`,
    mainJs,
  ];
  if (isLinux) {
    const sandboxPath = NodePath.join(NodePath.dirname(electronPath), "chrome-sandbox");
    let sandboxConfigured = false;
    try {
      const stat = NodeFS.statSync(sandboxPath);
      sandboxConfigured = stat.uid === 0 && (stat.mode & 0o4777) === 0o4755;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (!sandboxConfigured) args.unshift("--no-sandbox");
  }
  logFd = NodeFS.openSync(logPath, "ax", 0o600);
  launchStartedAt = Date.now();
  child = NodeChildProcess.spawn(
    isLinux ? "dbus-run-session" : electronPath,
    isLinux ? ["--", "xvfb-run", "-a", electronPath, ...args] : args,
    {
      cwd: desktopDir,
      stdio: ["ignore", logFd, logFd],
      env,
      detached: !isWindows,
      windowsHide: true,
    },
  );
  launchReturnedAt = Date.now();
  await new Promise((resolve, reject) => {
    stopObservation = reject;
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      reject(
        new Error(
          `Electron smoke exited before observation completed (code=${code}, signal=${signal})`,
        ),
      );
    });
    observationTimer = setTimeout(resolve, 8_000);
    const observe = () => {
      try {
        remainingProcesses();
      } catch (error) {
        reject(error);
      }
    };
    child.once("spawn", observe);
    monitor = setInterval(observe, isWindows ? 500 : 200);
    if (interruptedSignal) onSignal(interruptedSignal);
  });
  const output = NodeFS.readFileSync(logPath, "utf8");
  const failures = fatalPatterns.filter((pattern) => output.includes(pattern));
  if (failures.length > 0) throw new Error(`Fatal smoke output: ${failures.join(", ")}`);
  if (!output.includes("app ready"))
    throw new Error("Timed out before Electron reported app ready");
} catch (error) {
  console.error(`\nDesktop smoke test failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  try {
    await cleanup();
    // Retain output.log, but remove private application/profile state only after teardown.
    NodeFS.rmSync(stateDir, { recursive: true, force: true });
    console.log("Smoke process-tree cleanup verified.");
  } catch (error) {
    console.error(`\nDesktop smoke cleanup failed: ${error.message}`);
    process.exitCode = 1;
  }
  if (logFd !== undefined) NodeFS.closeSync(logFd);
  child?.unref();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.removeListener(signal, onSignal);
  if (interruptedSignal) {
    process.exitCode =
      interruptedSignal === "SIGINT" ? 130 : interruptedSignal === "SIGTERM" ? 143 : 129;
  }
}

if (!process.exitCode) console.log("Desktop smoke test passed.");
