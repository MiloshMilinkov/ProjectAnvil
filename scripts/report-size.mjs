import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { isBuildCurrent } from "./build-fingerprint.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
let disk = false,
  output,
  check = false;
for (let index = 0; index < args.length; index++) {
  if (args[index] === "--disk") disk = true;
  else if (args[index] === "--check") check = true;
  else if (args[index] === "--out" && args[index + 1]) output = args[++index];
  else
    throw new Error(
      "Use --check, --disk, and/or --out outputs/size/<name>.json.",
    );
}

async function filesBelow(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) files.push(...(await filesBelow(full)));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}
async function total(files) {
  let bytes = 0;
  for (const file of files) bytes += (await fs.stat(file)).size;
  return { files: files.length, bytes };
}

// Include new source and exclude staged deletions, generated output, and private data.
const candidates = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root, encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const source = [];
for (const relative of new Set(candidates)) {
  const file = path.join(root, relative);
  try {
    if ((await fs.lstat(file)).isFile()) source.push(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const report = {
  generatedAt: new Date().toISOString(),
  source: await total(source),
};
try {
  const client = path.join(root, "dist/client");
  const manifest = JSON.parse(
    await fs.readFile(path.join(client, ".vite/manifest.json"), "utf8"),
  );
  const app = JSON.parse(
    await fs.readFile(path.join(client, "app-assets.json"), "utf8"),
  );
  const entry = JSON.parse(
    await fs.readFile(
      path.join(client, "vinext-client-entry-manifest.json"),
      "utf8",
    ),
  );
  const roots = Object.keys(manifest).filter(
    (key) =>
      ["AccountShell", "AppInstallation", "ThemeControls"].includes(
        manifest[key].name,
      ) || manifest[key].file === entry.appBrowserEntry,
  );
  const visited = new Set();
  const startupFiles = new Set();
  function visit(key) {
    if (visited.has(key)) return;
    const item = manifest[key];
    if (!item) throw new Error(`Build manifest is missing ${key}.`);
    visited.add(key);
    if (item.file.endsWith(".js")) startupFiles.add(item.file);
    for (const dependency of item.imports || []) visit(dependency);
  }
  for (const key of roots) visit(key);
  let raw = 0,
    gzip = 0;
  for (const name of startupFiles) {
    const bytes = await fs.readFile(path.join(client, name));
    raw += bytes.length;
    gzip += gzipSync(bytes).length;
  }
  const staticFiles = await filesBelow(path.join(client, "_next/static"));
  report.build = {
    current: await isBuildCurrent(root),
    version: app.version,
    offlineFiles: app.assetCount,
    offlineBytes: app.bytes,
    startupJavaScript: {
      files: startupFiles.size,
      bytes: raw,
      gzipBytes: gzip,
    },
    fonts: {
      ...(await total(
        staticFiles.filter((file) => /\.(?:woff2?|ttf|otf)$/i.test(file)),
      )),
      legacyMathFiles: staticFiles.filter((file) =>
        /KaTeX_[^/\\]*\.(?:woff|ttf)$/i.test(file),
      ).length,
    },
    largestJavaScript: (
      await Promise.all(
        staticFiles
          .filter((file) => file.endsWith(".js"))
          .map(async (file) => ({
            name: path.basename(file),
            bytes: (await fs.stat(file)).size,
          })),
      )
    )
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 8),
  };
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  report.build = {
    available: false,
    reason: "Build the production app first.",
  };
}
if (disk) {
  report.disk = {};
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.isSymbolicLink())
      report.disk[entry.name] = await total(
        await filesBelow(path.join(root, entry.name)),
      );
  }
}
if (output) {
  output = path.resolve(root, output);
  const parent = path.resolve(root, "outputs/size");
  if (!output.startsWith(parent + path.sep) || path.extname(output) !== ".json")
    throw new Error("Size reports belong under outputs/size/.");
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify(report, null, 2));
if (check) {
  const build = report.build;
  if (!build.current)
    throw new Error("Build current source before checking size budgets.");
  if (
    build.startupJavaScript.bytes > 1_250_000 ||
    build.offlineBytes > 8_000_000 ||
    build.fonts.legacyMathFiles > 0
  )
    throw new Error(
      "Size budget exceeded: startup JS 1.25 MB, complete offline package 8 MB, WOFF2-only math fonts. Review the change before adjusting these budgets.",
    );
}
