import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
process.env.WRANGLER_SEND_METRICS ??= "false";
process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
await import("./check-maintenance.mjs");
await import("./prepare-local-accounts.mjs");
await import("./sites-env.mjs");
const options = process.argv.slice(2);
if (
  options.length &&
  (options.length !== 2 || options[0] !== "--port" || !/^\d+$/.test(options[1]))
)
  throw new Error("Use --port followed by a local port number.");
const port = options.length ? Number(options[1]) : 5173;
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Choose a local port between 1024 and 65535.");
const cli = new URL(
  "../node_modules/wrangler/bin/wrangler.js",
  import.meta.url,
);
const args = [
  fileURLToPath(cli),
  "dev",
  "--config",
  fileURLToPath(new URL("../dist/server/wrangler.json", import.meta.url)),
  "--env-file",
  fileURLToPath(new URL("../.dev.vars", import.meta.url)),
  "--local",
  "--persist-to",
  fileURLToPath(new URL("../.wrangler/state", import.meta.url)),
  "--ip",
  "127.0.0.1",
  "--port",
  String(port),
  "--inspector-port",
  "0",
];
(await import("./check-maintenance.mjs")).assertNoMaintenance();
const result = spawnSync(process.execPath, args, {
  stdio: "inherit",
  cwd: fileURLToPath(new URL("../", import.meta.url)),
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
