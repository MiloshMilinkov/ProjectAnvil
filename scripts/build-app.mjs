import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sourceFingerprint, recordBuild } from "./build-fingerprint.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const fingerprint = await sourceFingerprint(root);
for (const args of [
  ["scripts/run-framework.mjs", "build"],
  ["scripts/generate-pwa-assets.mjs"],
]) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
await recordBuild(root, fingerprint);
