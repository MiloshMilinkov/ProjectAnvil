import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const directories = ["app", "public", "build", "scripts"];
const configuration = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "next.config.ts",
  "postcss.config.mjs",
  ".openai/hosting.json",
];
const stampPath = "dist/.projectanvil-build.json";

/** Fingerprints source only: runtime databases, secrets and backups are excluded. */
export async function sourceFingerprint(root) {
  const files = [];
  async function visit(relative) {
    let entries;
    try {
      entries = await fs.readdir(path.join(root, relative), {
        withFileTypes: true,
      });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) files.push(child);
    }
  }
  for (const directory of directories) await visit(directory);
  for (const relative of configuration) {
    try {
      if ((await fs.lstat(path.join(root, relative))).isFile())
        files.push(relative);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const hash = createHash("sha256");
  for (const relative of files.sort()) {
    hash
      .update(relative)
      .update("\0")
      .update(await fs.readFile(path.join(root, relative)))
      .update("\0");
  }
  return hash.digest("hex");
}

export async function isBuildCurrent(root) {
  try {
    const stamp = JSON.parse(
      await fs.readFile(path.join(root, stampPath), "utf8"),
    );
    for (const relative of [
      "dist/server/wrangler.json",
      "dist/client/service-worker.js",
      "dist/client/app-assets.json",
    ])
      if (!(await fs.stat(path.join(root, relative))).isFile()) return false;
    return (
      stamp.format === 1 &&
      stamp.fingerprint === (await sourceFingerprint(root))
    );
  } catch {
    return false;
  }
}

export async function recordBuild(root, fingerprint) {
  if ((await sourceFingerprint(root)) !== fingerprint)
    throw new Error(
      "Source changed during the build. Build again before starting ProjectAnvil.",
    );
  await fs.writeFile(
    path.join(root, stampPath),
    JSON.stringify({ format: 1, fingerprint }, null, 2) + "\n",
  );
}
