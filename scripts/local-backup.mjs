import fs from "node:fs/promises";
import { constants, createReadStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { finished } from "node:stream/promises";

const defaultProject = fileURLToPath(new URL("../", import.meta.url));
const manifestName = "manifest.json";
const lockName = ".projectanvil-maintenance.lock";
const stateName = ".wrangler/state";
const secretName = ".dev.vars";
const maximumManifestBytes = 20_000_000;

function inside(root, relative) {
  const target = path.resolve(root, relative);
  const difference = path.relative(root, target);
  if (
    !difference ||
    difference.startsWith(`..${path.sep}`) ||
    difference === ".." ||
    path.isAbsolute(difference)
  ) {
    throw new Error(`Refusing a path outside its expected folder: ${relative}`);
  }
  return target;
}

async function exists(filename) {
  try {
    return await fs.lstat(filename);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function noLinks(filename) {
  const absolute = path.resolve(filename);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const component of absolute
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, component);
    const stat = await exists(current);
    if (stat?.isSymbolicLink())
      throw new Error(
        `Symbolic links and junctions are not supported in backup paths: ${current}`,
      );
  }
}

/** Antivirus and filesystem watchers can briefly lock Windows rename targets. */
export async function renameWithRetry(
  source,
  destination,
  { maxAttempts = 8, delayMs = 100, rename = fs.rename } = {},
) {
  const from = path.resolve(source);
  const to = path.resolve(destination);
  const relative = path.relative(from, to);
  if (
    from === to ||
    path.dirname(from) === from ||
    path.dirname(to) === to ||
    (relative && !relative.startsWith("..") && !path.isAbsolute(relative))
  )
    throw new Error("Refusing an unsafe backup move.");
  if (
    !Number.isInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > 12 ||
    !Number.isFinite(delayMs) ||
    delayMs < 0 ||
    delayMs > 1_000
  )
    throw new Error("Choose bounded backup move retry settings.");
  const transient = new Set(["EPERM", "EBUSY", "EACCES"]);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await noLinks(from);
      await noLinks(to);
      if (await exists(to)) {
        const error = new Error(
          `Refusing to overwrite an existing backup move destination: ${to}`,
        );
        error.code = "EEXIST";
        throw error;
      }
      await rename(from, to);
      return;
    } catch (error) {
      if (!transient.has(error.code)) throw error;
      if (attempt === maxAttempts - 1) {
        throw new Error(
          `Windows still prevents moving ${from} after ${maxAttempts} attempts. The source was retained at that path; close anything using it and retry.`,
          { cause: error },
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(delayMs * (attempt + 1), 750)),
      );
    }
  }
}

async function projectFolder(projectRoot) {
  const root = path.resolve(projectRoot || defaultProject);
  if (path.dirname(root) === root)
    throw new Error("Choose a project folder, not a drive root.");
  await noLinks(root);
  const stat = await fs.stat(root);
  if (!stat.isDirectory())
    throw new Error("The project path must be a directory.");
  return root;
}

function validRelative(relative, directory = false) {
  if (
    typeof relative !== "string" ||
    !relative ||
    relative.includes("\\") ||
    path.posix.isAbsolute(relative)
  )
    return false;
  const components = relative.split("/");
  if (
    components.some(
      (component) =>
        !component ||
        component === "." ||
        component === ".." ||
        /[<>:"|?*\u0000-\u001f]/u.test(component) ||
        /[. ]$/u.test(component) ||
        /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(component),
    )
  )
    return false;
  return (
    (relative === secretName && !directory) ||
    (relative === stateName && directory) ||
    relative.startsWith(`${stateName}/`)
  );
}

async function walk(
  root,
  relative = "",
  result = { files: [], directories: [] },
) {
  if (!relative) {
    const stat = await fs.lstat(root);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error(
        "The backup payload must be an ordinary directory without links.",
      );
  }
  if (relative.split("/").length > 64)
    throw new Error("The backup folder nesting is too deep.");
  for (const entry of await fs.readdir(
    relative ? inside(root, relative) : root,
    { withFileTypes: true },
  )) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    const target = inside(root, child);
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink())
      throw new Error(
        `Symbolic links and junctions cannot be backed up: ${child}`,
      );
    if (stat.isDirectory()) {
      result.directories.push(child);
      await walk(root, child, result);
    } else if (stat.isFile() && stat.nlink === 1) result.files.push(child);
    else
      throw new Error(
        `Only ordinary files and directories can be backed up: ${child}`,
      );
    if (result.files.length + result.directories.length > 100_000)
      throw new Error("This backup contains too many filesystem entries.");
  }
  return result;
}

async function hashFile(filename) {
  await noLinks(filename);
  const before = await fs.lstat(filename);
  if (!before.isFile() || before.nlink !== 1)
    throw new Error("Backup files must be ordinary files without hard links.");
  const digest = createHash("sha256");
  const stream = createReadStream(filename);
  for await (const chunk of stream) digest.update(chunk);
  await finished(stream, { cleanup: true });
  const after = await fs.lstat(filename);
  if (
    after.isSymbolicLink() ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  ) {
    throw new Error(
      "A file changed while it was being checked. Stop ProjectAnvil and try again.",
    );
  }
  return { bytes: after.size, sha256: digest.digest("hex") };
}

async function copyFileChecked(source, destination, expected) {
  await noLinks(source);
  await noLinks(path.dirname(destination));
  const before = await hashFile(source);
  if (
    expected &&
    (before.bytes !== expected.bytes || before.sha256 !== expected.sha256)
  )
    throw new Error("A backup file changed after verification.");
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await fs.copyFile(source, destination, constants.COPYFILE_EXCL);
  await fs.chmod(destination, 0o600);
  const copied = await hashFile(destination);
  const sourceAfter = await hashFile(source);
  if (copied.sha256 !== before.sha256 || sourceAfter.sha256 !== before.sha256)
    throw new Error("A file changed during the backup copy.");
  return copied;
}

export async function assertAppStopped(port = 5173) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error("Choose a valid local port.");
  const open = await new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", (error) => finish(error.code !== "ECONNREFUSED"));
    socket.setTimeout(750, () => finish(true));
  });
  if (open)
    throw new Error(
      `Stop ProjectAnvil before creating or restoring a full backup. Local port ${port} is open or unavailable to check.`,
    );
}

async function maintenance(root, command, work) {
  const filename = inside(root, lockName);
  await noLinks(filename);
  const token = randomUUID();
  let handle;
  try {
    handle = await fs.open(filename, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(
        "A ProjectAnvil backup or restore lock already exists. Finish that operation before trying again.",
      );
    throw error;
  }
  try {
    await handle.writeFile(
      JSON.stringify({
        pid: process.pid,
        token,
        command,
        startedAt: new Date().toISOString(),
      }),
    );
    await handle.close();
    handle = undefined;
    return await work();
  } finally {
    await handle?.close();
    const current = await fs.readFile(filename, "utf8").catch(() => "");
    if (current.includes(token)) await fs.unlink(filename);
  }
}

async function sqliteFiles(payload, files) {
  const databases = [];
  for (const entry of files) {
    if (entry.bytes < 16 || entry.path === secretName) continue;
    const handle = await fs.open(inside(payload, entry.path), "r");
    const header = Buffer.alloc(16);
    try {
      await handle.read(header, 0, 16, 0);
    } finally {
      await handle.close();
    }
    if (header.toString("binary") === "SQLite format 3\0")
      databases.push(entry.path);
  }
  if (!databases.length) return [];
  // SQLite may need sidecar files even for a read-only WAL database. Run its
  // checks against an isolated copy so verification never changes the backup.
  const temporaryRoot = path.resolve(os.tmpdir());
  const scratch = await fs.mkdtemp(
    path.join(temporaryRoot, "projectanvil-backup-verify-"),
  );
  try {
    for (let index = 0; index < databases.length; index++) {
      const relative = databases[index];
      const destination = inside(scratch, `database-${index}.sqlite`);
      await copyFileChecked(inside(payload, relative), destination);
      for (const suffix of ["-wal", "-shm", "-journal"]) {
        const sidecar = files.find((entry) => entry.path === relative + suffix);
        if (sidecar)
          await copyFileChecked(
            inside(payload, sidecar.path),
            destination + suffix,
            sidecar,
          );
      }
      const database = new DatabaseSync(destination, { readOnly: true });
      try {
        const results = database.prepare("PRAGMA integrity_check").all();
        if (results.length !== 1 || Object.values(results[0])[0] !== "ok")
          throw new Error(`SQLite integrity check failed: ${relative}`);
      } finally {
        database.close();
      }
    }
    return databases;
  } finally {
    const difference = path.relative(temporaryRoot, path.resolve(scratch));
    if (
      !difference ||
      difference.startsWith("..") ||
      path.isAbsolute(difference) ||
      !path.basename(scratch).startsWith("projectanvil-backup-verify-")
    )
      throw new Error("Refusing to clean an unexpected verification folder.");
    await noLinks(scratch);
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

async function buildManifest(payload, projectRoot) {
  const tree = await walk(payload);
  const files = [];
  for (const relative of tree.files.sort())
    files.push({
      path: relative,
      ...(await hashFile(inside(payload, relative))),
    });
  let appVersion = "unknown";
  try {
    appVersion =
      JSON.parse(await fs.readFile(inside(projectRoot, "package.json"), "utf8"))
        .version || appVersion;
  } catch {}
  return {
    format: "projectanvil-backup",
    version: 1,
    createdAt: new Date().toISOString(),
    appVersion,
    directories: tree.directories.sort(),
    files,
  };
}

function validateManifest(manifest) {
  if (
    manifest?.format !== "projectanvil-backup" ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.files) ||
    !Array.isArray(manifest.directories)
  )
    throw new Error("This is not a supported ProjectAnvil full backup.");
  if (manifest.files.length + manifest.directories.length > 100_000)
    throw new Error("The backup manifest contains too many paths.");
  const seen = new Set();
  for (const entry of manifest.files) {
    if (
      !entry ||
      !validRelative(entry.path) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    )
      throw new Error(
        "The backup manifest contains an unsafe or invalid file path.",
      );
    const key = entry.path.normalize("NFC").toLowerCase();
    if (seen.has(key))
      throw new Error(
        "The backup manifest contains duplicate or conflicting paths.",
      );
    seen.add(key);
  }
  if (!seen.has(secretName))
    throw new Error("The backup does not include its private signing secret.");
  const directories = new Set();
  for (const relative of manifest.directories) {
    if (relative !== ".wrangler" && !validRelative(relative, true))
      throw new Error("The backup manifest contains an unsafe directory path.");
    const key = relative.normalize("NFC").toLowerCase();
    if (directories.has(key) || seen.has(key))
      throw new Error(
        "The backup manifest contains conflicting directory paths.",
      );
    directories.add(key);
  }
  if (!directories.has(stateName))
    throw new Error("The backup does not include its local state folder.");
}

async function verifyPayload(payload, manifest) {
  validateManifest(manifest);
  const tree = await walk(payload);
  const listedFiles = new Set(manifest.files.map((entry) => entry.path));
  const listedDirectories = new Set(manifest.directories);
  if (
    tree.files.length !== listedFiles.size ||
    tree.files.some((relative) => !listedFiles.has(relative)) ||
    tree.directories.length !== listedDirectories.size ||
    tree.directories.some((relative) => !listedDirectories.has(relative))
  )
    throw new Error("The backup payload differs from its manifest.");
  for (const entry of manifest.files) {
    const result = await hashFile(inside(payload, entry.path));
    if (result.bytes !== entry.bytes || result.sha256 !== entry.sha256)
      throw new Error(`Backup verification failed: ${entry.path}`);
  }
  const secret = await fs.readFile(inside(payload, secretName), "utf8");
  const setting =
    /^\s*BETTER_AUTH_SECRET\s*=\s*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s#]+))\s*$/mu.exec(
      secret,
    );
  if (!setting || (setting[1] || setting[2] || setting[3]).length < 32)
    throw new Error("The backup signing secret is missing or invalid.");
  return sqliteFiles(payload, manifest.files);
}

export async function verifyBackup({ backupPath }) {
  const backup = path.resolve(backupPath || "");
  if (!backupPath)
    throw new Error("Supply the full backup directory with --backup.");
  await noLinks(backup);
  const entries = await fs.readdir(backup);
  if (entries.some((name) => ![manifestName, "payload"].includes(name)))
    throw new Error("The backup directory contains unexpected files.");
  const filename = inside(backup, manifestName);
  const stat = await fs.lstat(filename);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size > maximumManifestBytes
  )
    throw new Error("The backup manifest is not a safe ordinary file.");
  const manifest = JSON.parse(await fs.readFile(filename, "utf8"));
  const sqlite = await verifyPayload(inside(backup, "payload"), manifest);
  return { backupPath: backup, manifest, sqlite };
}

async function copyPayload(source, destination, manifest) {
  await fs.mkdir(destination, { recursive: false, mode: 0o700 });
  for (const directory of [...manifest.directories].sort(
    (left, right) => left.length - right.length,
  ))
    await fs.mkdir(inside(destination, directory), {
      recursive: true,
      mode: 0o700,
    });
  for (const entry of manifest.files)
    await copyFileChecked(
      inside(source, entry.path),
      inside(destination, entry.path),
      entry,
    );
}

function stamp() {
  return (
    new Date().toISOString().replace(/[:.]/g, "-") +
    "-" +
    randomUUID().slice(0, 8)
  );
}

export async function createBackup({
  projectRoot = defaultProject,
  outputRoot,
  port = 5173,
} = {}) {
  const root = await projectFolder(projectRoot);
  return maintenance(root, "create", async () => {
    await assertAppStopped(port);
    const state = inside(root, stateName);
    const secret = inside(root, secretName);
    await noLinks(state);
    await noLinks(secret);
    if (
      !(await fs.stat(state)).isDirectory() ||
      !(await fs.stat(secret)).isFile()
    )
      throw new Error(
        "The project must have a state folder and private .dev.vars file.",
      );
    const output = path.resolve(outputRoot || inside(root, "backups"));
    if (
      output === state ||
      (!path.relative(state, output).startsWith("..") &&
        !path.isAbsolute(path.relative(state, output)))
    )
      throw new Error("A backup cannot be created inside live state.");
    await noLinks(output);
    await fs.mkdir(output, { recursive: true, mode: 0o700 });
    const staging = inside(output, `.partial-${stamp()}`);
    const final = inside(output, `projectanvil-${stamp()}`);
    await fs.mkdir(staging, { mode: 0o700 });
    const payload = inside(staging, "payload");
    await fs.mkdir(inside(payload, stateName), {
      recursive: true,
      mode: 0o700,
    });
    const tree = await walk(state);
    for (const directory of tree.directories)
      await fs.mkdir(inside(payload, `${stateName}/${directory}`), {
        recursive: true,
        mode: 0o700,
      });
    for (const relative of tree.files)
      await copyFileChecked(
        inside(state, relative),
        inside(payload, `${stateName}/${relative}`),
      );
    await copyFileChecked(secret, inside(payload, secretName));
    const manifest = await buildManifest(payload, root);
    await verifyPayload(payload, manifest);
    await assertAppStopped(port);
    await fs.writeFile(
      inside(staging, manifestName),
      JSON.stringify(manifest, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    await renameWithRetry(staging, final);
    return { backupPath: final, files: manifest.files.length };
  });
}

export async function restoreBackup({
  projectRoot = defaultProject,
  backupPath,
  port = 5173,
}) {
  const root = await projectFolder(projectRoot);
  return maintenance(root, "restore", async () => {
    await assertAppStopped(port);
    const verified = await verifyBackup({ backupPath });
    const backups = inside(root, "backups");
    await noLinks(backups);
    await fs.mkdir(backups, { recursive: true, mode: 0o700 });
    const staging = inside(backups, `.restore-stage-${stamp()}`);
    const rollback = inside(backups, `rollback-${stamp()}`);
    await fs.mkdir(staging, { mode: 0o700 });
    const candidate = inside(staging, "payload");
    await copyPayload(
      inside(verified.backupPath, "payload"),
      candidate,
      verified.manifest,
    );
    await verifyPayload(candidate, verified.manifest);
    const liveState = inside(root, stateName);
    const liveSecret = inside(root, secretName);
    await noLinks(liveState);
    await noLinks(liveSecret);
    const hadState = !!(await exists(liveState));
    const hadSecret = !!(await exists(liveSecret));
    if (hadState) await walk(liveState);
    if (hadSecret && !(await fs.lstat(liveSecret)).isFile())
      throw new Error("The existing signing secret is not a regular file.");
    await fs.mkdir(rollback, { recursive: false, mode: 0o700 });
    await fs.mkdir(inside(rollback, "payload/.wrangler"), {
      recursive: true,
      mode: 0o700,
    });
    await fs.mkdir(inside(root, ".wrangler"), { recursive: true, mode: 0o700 });
    await assertAppStopped(port);
    let stateMoved = false,
      secretMoved = false,
      stateInstalled = false,
      secretInstalled = false;
    try {
      if (hadState) {
        await renameWithRetry(
          liveState,
          inside(rollback, `payload/${stateName}`),
        );
        stateMoved = true;
      }
      if (hadSecret) {
        await renameWithRetry(
          liveSecret,
          inside(rollback, `payload/${secretName}`),
        );
        secretMoved = true;
      }
      if (hadState && hadSecret) {
        const previous = await buildManifest(inside(rollback, "payload"), root);
        await fs.writeFile(
          inside(rollback, manifestName),
          JSON.stringify(previous, null, 2) + "\n",
          { flag: "wx", mode: 0o600 },
        );
      }
      await renameWithRetry(inside(candidate, stateName), liveState);
      stateInstalled = true;
      await renameWithRetry(inside(candidate, secretName), liveSecret);
      secretInstalled = true;
    } catch (error) {
      try {
        if (secretInstalled)
          await renameWithRetry(liveSecret, inside(candidate, secretName));
        if (stateInstalled)
          await renameWithRetry(liveState, inside(candidate, stateName));
        if (secretMoved)
          await renameWithRetry(
            inside(rollback, `payload/${secretName}`),
            liveSecret,
          );
        if (stateMoved)
          await renameWithRetry(
            inside(rollback, `payload/${stateName}`),
            liveState,
          );
      } catch (rollbackError) {
        throw new Error(
          `Restore and automatic rollback both failed. Preserve ${rollback} and ${staging} before further work.`,
          { cause: rollbackError },
        );
      }
      throw new Error(
        `Restore did not finish; the previous local state was restored. The candidate remains at ${staging}. ${error.message}`,
        { cause: error },
      );
    }
    return {
      restoredFrom: verified.backupPath,
      rollbackPath: rollback,
      stagingPath: staging,
    };
  });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const options = {};
  const keys = {
    "--project": "projectRoot",
    "--output": "outputRoot",
    "--backup": "backupPath",
    "--port": "port",
  };
  for (let index = 0; index < args.length; index += 2) {
    if (
      !keys[args[index]] ||
      !args[index + 1] ||
      args[index + 1].startsWith("--")
    )
      throw new Error(
        "Use create [--output DIRECTORY], verify --backup DIRECTORY, or restore --backup DIRECTORY. Optional: --project DIRECTORY --port 5173.",
      );
    options[keys[args[index]]] =
      args[index] === "--port" ? Number(args[index + 1]) : args[index + 1];
  }
  if (command === "create")
    console.log(
      `Full backup verified: ${(await createBackup(options)).backupPath}`,
    );
  else if (command === "verify") {
    const result = await verifyBackup(options);
    console.log(
      `Backup verified: ${result.manifest.files.length} files; ${result.sqlite.length} SQLite databases passed integrity checks.`,
    );
  } else if (command === "restore") {
    const result = await restoreBackup(options);
    console.log(
      `Local state restored. Previous state retained at: ${result.rollbackPath}`,
    );
  } else throw new Error("Choose create, verify, or restore.");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`Backup operation stopped: ${error.message}`);
    process.exitCode = 1;
  });
}
