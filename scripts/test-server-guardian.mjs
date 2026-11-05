import { spawn } from "node:child_process";
import { ownedProcessStopper } from "./test-runtime.mjs";

// A Playwright worker may be terminated before asynchronous fixture teardown.
// Its IPC channel is the lease: losing the worker always stops this owned tree.
if (!process.send || !process.connected)
  throw new Error("A disposable server guardian requires its owner's IPC channel.");

const child = spawn(process.execPath, process.argv.slice(2), {
  stdio: "inherit",
  detached: process.platform !== "win32",
  windowsHide: true,
});
const stop = ownedProcessStopper(child);
let stopping = false;
let exitCode = 0;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  try {
    await stop();
  } catch {
    exitCode = 1;
    console.error("The disposable server guardian could not stop its owned process.");
  } finally {
    process.exit(exitCode);
  }
}
process.once("disconnect", () => void shutdown());
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
child.once("spawn", () => {
  if (process.connected)
    process.send({ type: "child-started", pid: child.pid }, () => {});
});
child.once("error", () => {
  exitCode = 1;
  void shutdown();
});
child.once("exit", (code) => {
  if (stopping) return;
  exitCode = code ?? 1;
  void shutdown();
});
if (!process.connected) void shutdown();
