import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const maximumFiles = 1000;
const maximumBytes = 50 * 1024 * 1024;
const publicFiles = [
  "favicon.svg",
  "manifest.webmanifest",
  "icons/projectanvil.svg",
  "icons/projectanvil-maskable.svg",
  "icons/projectanvil-180.png",
  "icons/projectanvil-192.png",
  "icons/projectanvil-512.png",
  "icons/projectanvil-maskable-512.png",
];

async function ordinaryDirectory(directory) {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("App asset directories cannot contain symbolic links.");
}

async function filesBelow(directory) {
  await ordinaryDirectory(directory);
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error("App assets cannot contain symbolic links.");
    if (entry.isDirectory()) files.push(...(await filesBelow(target)));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

/** Generates a public-only asset allowlist after a successful production build. */
export async function generatePwaAssets(root) {
  const client = path.join(root, "dist", "client");
  await ordinaryDirectory(client);
  await ordinaryDirectory(path.join(client, "_next"));
  await ordinaryDirectory(path.join(client, "icons"));
  const files = [
    ...(await filesBelow(path.join(client, "_next", "static"))),
    ...publicFiles.map((name) => path.join(client, name)),
  ].sort();
  if (files.length > maximumFiles)
    throw new Error("The offline app has too many static files.");
  let total = 0;
  const resources = [];
  const hash = createHash("sha256");
  for (const file of files) {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("App assets must be ordinary files.");
    if (stat.size > 8 * 1024 * 1024)
      throw new Error("An offline application file is too large.");
    total += stat.size;
    if (total > maximumBytes)
      throw new Error("The offline application exceeds its 50 MB limit.");
    const name = path.relative(client, file).split(path.sep).join("/");
    if (
      !/^(?:_next\/static\/[A-Za-z0-9_./-]+|favicon\.svg|manifest\.webmanifest|icons\/[A-Za-z0-9_.-]+)$/.test(
        name,
      ) ||
      name.split("/").some((part) => part === "." || part === "..")
    )
      throw new Error("An application asset has an unsupported path.");
    const bytes = await fs.readFile(file);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    resources.push({ url: "/" + name, sha256, bytes: bytes.byteLength });
    hash.update(name).update(sha256);
  }
  const template = await fs.readFile(
    path.join(root, "public", "service-worker.js"),
    "utf8",
  );
  const buildId = await fs.readFile(
    path.join(root, "dist", "server", "BUILD_ID"),
    "utf8",
  );
  const version = hash
    .update(template)
    .update(buildId)
    .digest("hex")
    .slice(0, 20);
  const worker = template
    .replace('/* PROJECTANVIL_BUILD */ "development"', JSON.stringify(version))
    .replace("/* PROJECTANVIL_RESOURCES */ []", JSON.stringify(resources));
  if (worker === template || worker.includes("/* PROJECTANVIL_RESOURCES */"))
    throw new Error("The service worker template is invalid.");
  await fs.writeFile(path.join(client, "service-worker.js"), worker);
  await fs.writeFile(
    path.join(client, "app-assets.json"),
    JSON.stringify(
      {
        mode: "production",
        version,
        assetCount: resources.length,
        bytes: total,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Offline app prepared: ${resources.length} public files, ${(total / 1024 / 1024).toFixed(1)} MB.`,
  );
  return { version, resources };
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  await generatePwaAssets(fileURLToPath(new URL("../", import.meta.url)));
