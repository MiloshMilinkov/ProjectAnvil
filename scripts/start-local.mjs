import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const host = "127.0.0.1";
const port = 5173;
const url = `http://${host}:${port}/`;
const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);

async function portIsOpen() {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (open) => { socket.destroy(); resolve(open); };
    socket.setTimeout(1500, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function isForgeboard() {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: "error" });
    if (!response.ok || !(await response.text()).includes("Forgeboard")) return false;
    const stateResponse = await fetch(new URL("api/state", url), { signal: AbortSignal.timeout(10000), redirect: "error" });
    if (!stateResponse.ok) return false;
    const { workspace } = await stateResponse.json();
    return typeof workspace?.name === "string" && typeof workspace?.revision === "number"
      && ["people", "projects", "tasks", "notes", "media", "canvases", "savedViews"]
        .every((key) => Array.isArray(workspace[key]));
  } catch { return false; }
}

function openBrowser() {
  // This URL is fixed, contains no shell metacharacters, and is never user input.
  const opener = process.platform === "win32"
    ? spawn("cmd.exe", ["/d", "/c", `start "" "${url}"`], { windowsHide: true, windowsVerbatimArguments: true, stdio: "ignore" })
    : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { stdio: "ignore" });
  opener.once("error", () => console.log(`Open your browser at ${url}`));
  opener.unref();
}

if (await portIsOpen()) {
  if (await isForgeboard()) {
    console.log(`Forgeboard is already running at ${url}`);
    console.log("Opening it. Use its original console window to stop the app.");
    openBrowser();
    process.exitCode = 0;
  } else {
    console.error(`Port ${port} is already in use. Forgeboard has not started another server.`);
    console.error("Close the app using that port, or check whether Forgeboard is still starting in another window, then try again.");
    process.exitCode = 1;
  }
} else {
  let finished = false;
  let interrupted = false;
  const child = spawn(process.execPath, ["scripts/run-framework.mjs", "dev"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, CLOUDFLARE_CF_FETCH_ENABLED: "false", WRANGLER_SEND_METRICS: "false" },
  });
  const completion = new Promise((resolve) => {
    child.once("error", (error) => {
      finished = true;
      console.error(error.message);
      resolve(1);
    });
    child.once("close", (code, signal) => {
      finished = true;
      resolve(interrupted || signal === "SIGINT" ? 0 : (code ?? 1));
    });
  });
  // Both processes share the user's console, so Ctrl+C reaches the server too.
  // Keep the launcher alive until the server has completed its cleanup.
  const onInterrupt = () => { interrupted = true; console.log("\nStopping Forgeboard..."); };
  process.on("SIGINT", onInterrupt);
  const deadline = Date.now() + 120000;
  let ready = false;
  while (!finished && Date.now() < deadline) {
    if (await isForgeboard()) { ready = true; break; }
    if (!finished) await delay(1000);
  }
  if (ready && !finished) {
    console.log(`\nForgeboard is ready: ${url}`);
    console.log("Keep this window open. Press Ctrl+C here to stop the app.\n");
    openBrowser();
  } else if (!finished) {
    console.log(`\nForgeboard is taking longer to start. Keep this window open and try ${url}`);
  }
  process.exitCode = await completion;
  process.off("SIGINT", onInterrupt);
}
