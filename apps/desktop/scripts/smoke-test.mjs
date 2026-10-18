import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { runIsolatedGuiProcess } from "../../../scripts/lib/isolated-gui-process.mjs";

const desktopDir = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const mainJs = NodePath.resolve(desktopDir, "dist-electron/boot.cjs");
const fatalPatterns = [
  "Cannot find module",
  "MODULE_NOT_FOUND",
  "Refused to execute",
  "Uncaught Error",
  "Uncaught TypeError",
  "Uncaught ReferenceError",
  "fatal startup",
];
// App-ready precedes menu, URL registration and backend/window bootstrap.
const readinessPatterns = ["app ready", "desktop app control socket ready", "main window created"];

try {
  // Use installed Electron, never the runtime downloader or registration launcher.
  const electronPath = NodeModule.createRequire(import.meta.url)("electron");
  NodeFS.accessSync(electronPath, NodeFS.constants.X_OK);
  const args = [mainJs];
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone launcher has no Effect runtime.
  if (NodeOS.platform() === "linux") {
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
  console.log("\nLaunching isolated Electron smoke test...");
  const outcome = await runIsolatedGuiProcess({
    executable: electronPath,
    args,
    cwd: desktopDir,
    readinessPatterns,
    fatalPatterns,
    env: { VITE_DEV_SERVER_URL: "", ELECTRON_ENABLE_LOGGING: "1" },
  });
  console.log(`Smoke stdout/stderr: ${outcome.logPath}`);
  console.log(`Smoke process inspection: ${outcome.inspectionLogPath}`);
  if (outcome.failure) console.error(`Desktop smoke test failed: ${outcome.failure.message}`);
  if (outcome.cleanupFailure)
    console.error(`Desktop smoke cleanup failed: ${outcome.cleanupFailure.message}`);
  if (outcome.cleanupVerified) console.log("Smoke process-tree cleanup verified.");
  if (outcome.exitCode === 0) console.log("Desktop smoke test passed.");
  process.exitCode = outcome.exitCode;
} catch (error) {
  console.error(`Desktop smoke test failed: ${error.message}`);
  process.exitCode = 1;
}
