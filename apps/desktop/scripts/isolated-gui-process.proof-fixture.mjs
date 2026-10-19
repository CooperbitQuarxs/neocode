// Explicit owner proof only; never imported by an automatically discovered test.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";

const root = process.env.T3CODE_GUI_PROOF_ROOT;
const mode = process.env.T3CODE_GUI_PROOF_CASE;
if (!root || !mode) throw new Error("Owner proof context is required");
const self = NodeURL.fileURLToPath(import.meta.url);
function receipt() {
  const fields = NodeFS.readFileSync(`/proc/${process.pid}/stat`, "utf8")
    .split(") ")
    .at(-1)
    .trim()
    .split(/\s+/);
  return {
    pid: process.pid,
    group: Number(fields[2]),
    identity: fields[19],
    args: process.argv,
    env: process.env,
  };
}
function write(name, value) {
  NodeFS.writeFileSync(NodePath.join(root, name), JSON.stringify(value), { mode: 0o600 });
}
async function readReceipt(name) {
  const target = NodePath.join(root, name);
  return new Promise((resolve, reject) => {
    const watcher = NodeFS.watch(root, inspect);
    const deadline = setTimeout(() => {
      watcher.close();
      reject(new Error(`Missing ${name} receipt`));
    }, 20_000);
    function inspect() {
      try {
        const value = JSON.parse(NodeFS.readFileSync(target, "utf8"));
        watcher.close();
        clearTimeout(deadline);
        resolve(value);
      } catch (error) {
        if (error.code !== "ENOENT") {
          watcher.close();
          clearTimeout(deadline);
          reject(error);
        }
      }
    }
    inspect();
  });
}

if (process.argv.includes("--proof-backend")) {
  process.on("SIGTERM", () => {});
  write("backend.json", receipt());
  process.send({ ready: true });
  // Keep the TERM-resistant fixture alive after its frontend's IPC closes.
  setInterval(() => {}, 60_000);
} else {
  write("frontend.json", receipt());
  const backend = NodeChildProcess.spawn(process.execPath, [self, "--proof-backend"], {
    env: process.env,
    detached: true,
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  await new Promise((resolve, reject) => {
    backend.once("message", (message) =>
      message.ready ? resolve() : reject(new Error("Invalid backend receipt")),
    );
    backend.once("error", reject);
    backend.once("exit", () => reject(new Error("Backend exited before its readiness handshake")));
  });
  // The hook writes this only after the public harness inspects this exact backend identity.
  const owned = await readReceipt("backend-observed.json");
  if (mode === "discfail") write("fault-armed.json", { armed: true });
  if (mode === "interrupt") process.kill(owned.runnerPid, "SIGTERM");
  if (mode === "latefatal") {
    console.log("app ready\nUncaught Error: fixture failure before complete desktop readiness");
  } else if (mode !== "timeout" && mode !== "interrupt") {
    console.log("app ready\ndesktop app control socket ready\nmain window created");
  }
  setInterval(() => {}, 60_000);
}
