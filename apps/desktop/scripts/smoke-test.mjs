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
const trackedProcesses = new Map();
let child;
let logFd;
let observationTimer;
let stopObservation;
let interruptedSignal;

// POSIX descendants inherit the detached launch's private process group.
// Windows has no process groups, so retain the native process-tree identities.
function windowsProcesses() {
  const output = NodeChildProcess.execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate | ConvertTo-Json -Compress",
    ],
    { encoding: "utf8", timeout: 3_000, windowsHide: true },
  );
  const rows = JSON.parse(output);
  const snapshot = Array.isArray(rows) ? rows : [rows];
  const owned = new Set([child.pid]);
  let added;
  do {
    added = false;
    for (const entry of snapshot) {
      if (owned.has(entry.ParentProcessId) && !owned.has(entry.ProcessId)) {
        owned.add(entry.ProcessId);
        added = true;
      }
    }
  } while (added);
  const remaining = snapshot.filter(
    (entry) =>
      owned.has(entry.ProcessId) || trackedProcesses.get(entry.ProcessId) === entry.CreationDate,
  );
  for (const entry of remaining) trackedProcesses.set(entry.ProcessId, entry.CreationDate);
  return remaining;
}

function groupExists() {
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

function signalGroup(signal) {
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function cleanup() {
  clearTimeout(observationTimer);
  if (!child?.pid) return;
  const deadline = Date.now() + 5_000;
  if (isWindows) {
    let remaining = windowsProcesses();
    for (let index = remaining.length - 1; index >= 0; index--) {
      const entry = remaining[index];
      const result = NodeChildProcess.spawnSync(
        "taskkill.exe",
        ["/PID", String(entry.ProcessId), "/T", "/F"],
        { stdio: "ignore", timeout: 3_000, windowsHide: true },
      );
      if (result.error) throw result.error;
    }
    while (remaining.length > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      remaining = windowsProcesses();
    }
    if (remaining.length > 0) throw new Error("Smoke cleanup left Windows process-tree members");
    return;
  }
  signalGroup("SIGTERM");
  while (groupExists() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (Date.now() >= deadline - 3_000) signalGroup("SIGKILL");
  }
  if (groupExists()) throw new Error(`Smoke cleanup left process group ${child.pid}`);
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
  logFd = NodeFS.openSync(logPath, "wx", 0o600);
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
