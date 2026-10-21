import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  createBackup,
  restoreBackup,
  verifyBackup,
  renameWithRetry,
} from "../scripts/local-backup.mjs";

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function fixture(t) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const directory = await fs.mkdtemp(
    path.join(temporaryRoot, "projectanvil-backup-test-"),
  );
  const project = path.join(directory, "project");
  const state = path.join(project, ".wrangler", "state");
  await fs.mkdir(path.join(state, "v3", "d1"), { recursive: true });
  await fs.mkdir(path.join(state, "v3", "r2"), { recursive: true });
  const sqlite = path.join(state, "v3", "d1", "local.sqlite");
  const database = new DatabaseSync(sqlite);
  database.exec(
    "CREATE TABLE records (id TEXT PRIMARY KEY, body TEXT NOT NULL)",
  );
  database
    .prepare("INSERT INTO records VALUES (?, ?)")
    .run("note", "original note, account and history fixture");
  database.close();
  await fs.writeFile(
    path.join(state, "v3", "r2", "attachment.bin"),
    "original media bytes",
  );
  await fs.writeFile(
    path.join(project, ".dev.vars"),
    "BETTER_AUTH_SECRET=" + "fixture-only-secret-".repeat(4) + "\n",
  );
  await fs.writeFile(
    path.join(project, "package.json"),
    JSON.stringify({ name: "fixture-only", version: "0.0.0-test" }),
  );
  t.after(async () => {
    const relative = path.relative(temporaryRoot, path.resolve(directory));
    assert(
      relative && !relative.startsWith("..") && !path.isAbsolute(relative),
    );
    assert(path.basename(directory).startsWith("projectanvil-backup-test-"));
    assert.equal((await fs.lstat(directory)).isSymbolicLink(), false);
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { project, state, sqlite, port: await unusedPort() };
}

async function rewriteManifest(backup, edit) {
  const filename = path.join(backup, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(filename, "utf8"));
  await edit(manifest);
  await fs.writeFile(filename, JSON.stringify(manifest));
}

test("full backups verify checksums, media, secret and SQLite without touching live state", async (t) => {
  const f = await fixture(t);
  const before = await fs.readFile(f.sqlite);
  const backup = await createBackup({ projectRoot: f.project, port: f.port });
  const verified = await verifyBackup(backup);
  assert.equal(verified.manifest.files.length, 3);
  assert.equal(verified.sqlite.length, 1);
  assert(verified.manifest.files.some((entry) => entry.path === ".dev.vars"));
  assert.equal((await fs.readFile(f.sqlite)).compare(before), 0);
  assert.equal(
    await fs.readFile(
      path.join(
        backup.backupPath,
        "payload",
        ".wrangler",
        "state",
        "v3",
        "r2",
        "attachment.bin",
      ),
      "utf8",
    ),
    "original media bytes",
  );
});

test("hash tampering and traversal or case-colliding manifests are rejected", async (t) => {
  const f = await fixture(t);
  const backup = await createBackup({ projectRoot: f.project, port: f.port });
  const media = path.join(
    backup.backupPath,
    "payload",
    ".wrangler",
    "state",
    "v3",
    "r2",
    "attachment.bin",
  );
  await fs.appendFile(media, " changed");
  await assert.rejects(() => verifyBackup(backup), /verification failed/);
  await rewriteManifest(backup.backupPath, (manifest) => {
    manifest.files[0].path = "../escape";
  });
  await assert.rejects(() => verifyBackup(backup), /unsafe|invalid/);
  const collision = await createBackup({
    projectRoot: f.project,
    port: f.port,
  });
  await rewriteManifest(collision.backupPath, (manifest) => {
    manifest.files.push({
      ...manifest.files[0],
      path: manifest.files[0].path.toUpperCase(),
    });
  });
  await assert.rejects(
    () => verifyBackup(collision),
    /unsafe|conflicting|duplicate/,
  );
  await assert.rejects(
    () =>
      createBackup({
        projectRoot: f.project,
        outputRoot: path.join(f.state, "unsafe-output"),
        port: f.port,
      }),
    /inside live state/,
  );
});

test("symlink or junction payloads cannot escape the verified backup", async (t) => {
  const f = await fixture(t);
  const backup = await createBackup({ projectRoot: f.project, port: f.port });
  const outside = path.join(path.dirname(f.project), "outside");
  await fs.mkdir(outside);
  const link = path.join(
    backup.backupPath,
    "payload",
    ".wrangler",
    "state",
    "escape-link",
  );
  try {
    await fs.symlink(
      outside,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (["EPERM", "EACCES"].includes(error.code)) {
      t.skip("This host cannot create links for the rejection fixture.");
      return;
    }
    throw error;
  }
  await assert.rejects(() => verifyBackup(backup), /Symbolic links|junctions/);
});

test("SQLite corruption is rejected even when file hashes were recomputed", async (t) => {
  const f = await fixture(t);
  const backup = await createBackup({ projectRoot: f.project, port: f.port });
  const relative = ".wrangler/state/v3/d1/local.sqlite";
  const target = path.join(
    backup.backupPath,
    "payload",
    ...relative.split("/"),
  );
  const bytes = await fs.readFile(target);
  bytes[100] = 255;
  await fs.writeFile(target, bytes);
  await rewriteManifest(backup.backupPath, (manifest) => {
    const entry = manifest.files.find((file) => file.path === relative);
    entry.sha256 = createHash("sha256").update(bytes).digest("hex");
  });
  await assert.rejects(() => verifyBackup(backup), /SQLite|database|malformed/);
});

test("an invalid signing secret cannot be mistaken for a complete account backup", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    path.join(f.project, ".dev.vars"),
    "UNRELATED_SETTING=fixture\n",
  );
  await assert.rejects(
    () => createBackup({ projectRoot: f.project, port: f.port }),
    /signing secret/,
  );
});

test("SQLite WAL sidecars are included and checked without modifying the saved payload", async (t) => {
  const f = await fixture(t);
  const database = new DatabaseSync(f.sqlite);
  database.exec("PRAGMA journal_mode = WAL");
  database
    .prepare("INSERT INTO records VALUES (?, ?)")
    .run("wal-row", "WAL-only fixture content");
  try {
    const backup = await createBackup({ projectRoot: f.project, port: f.port });
    const verified = await verifyBackup(backup);
    assert(
      verified.manifest.files.some((entry) => entry.path.endsWith("-wal")),
    );
    await verifyBackup(backup);
  } finally {
    database.close();
  }
});

test("create and restore refuse a running app or an existing maintenance operation", async (t) => {
  const f = await fixture(t);
  const backup = await createBackup({ projectRoot: f.project, port: f.port });
  const server = net.createServer();
  await new Promise((resolve) => server.listen(f.port, "127.0.0.1", resolve));
  try {
    await assert.rejects(
      () => createBackup({ projectRoot: f.project, port: f.port }),
      /Stop ProjectAnvil/,
    );
    await assert.rejects(
      () => restoreBackup({ ...backup, projectRoot: f.project, port: f.port }),
      /Stop ProjectAnvil/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  const lock = path.join(f.project, ".projectanvil-maintenance.lock");
  await fs.writeFile(lock, "fixture-existing-lock");
  await assert.rejects(
    () => createBackup({ projectRoot: f.project, port: f.port }),
    /lock already exists/,
  );
  assert.equal(await fs.readFile(lock, "utf8"), "fixture-existing-lock");
});

test("restore installs a verified pair and preserves the previous state as a verifiable rollback", async (t) => {
  const f = await fixture(t);
  const backup = await createBackup({ projectRoot: f.project, port: f.port });
  const originalSecret = await fs.readFile(
    path.join(f.project, ".dev.vars"),
    "utf8",
  );
  const database = new DatabaseSync(f.sqlite);
  database.prepare("UPDATE records SET body = ?").run("newer local data");
  database.close();
  await fs.writeFile(
    path.join(f.project, ".dev.vars"),
    "BETTER_AUTH_SECRET=" + "newer-fixture-secret-".repeat(4),
  );
  const restored = await restoreBackup({
    ...backup,
    projectRoot: f.project,
    port: f.port,
  });
  const after = new DatabaseSync(f.sqlite, { readOnly: true });
  try {
    assert.equal(
      after.prepare("SELECT body FROM records").get().body,
      "original note, account and history fixture",
    );
  } finally {
    after.close();
  }
  assert.equal(
    await fs.readFile(path.join(f.project, ".dev.vars"), "utf8"),
    originalSecret,
  );
  await verifyBackup({ backupPath: restored.rollbackPath });
  const previous = new DatabaseSync(
    path.join(
      restored.rollbackPath,
      "payload",
      ".wrangler",
      "state",
      "v3",
      "d1",
      "local.sqlite",
    ),
    { readOnly: true },
  );
  try {
    assert.equal(
      previous.prepare("SELECT body FROM records").get().body,
      "newer local data",
    );
  } finally {
    previous.close();
  }
});

test("a failed installation rolls back the previous state and never deletes either copy", async (t) => {
  const f = await fixture(t);
  const backup = await createBackup({ projectRoot: f.project, port: f.port });
  const database = new DatabaseSync(f.sqlite);
  database
    .prepare("UPDATE records SET body = ?")
    .run("must survive failed restore");
  database.close();
  const originalRename = fs.rename;
  fs.rename = async (source, destination) => {
    if (
      source.includes(".restore-stage-") &&
      path.basename(source) === ".dev.vars" &&
      destination === path.join(f.project, ".dev.vars")
    )
      throw new Error("Injected secret installation failure");
    return originalRename(source, destination);
  };
  try {
    await assert.rejects(
      () => restoreBackup({ ...backup, projectRoot: f.project, port: f.port }),
      /previous local state was restored/,
    );
  } finally {
    fs.rename = originalRename;
  }
  const after = new DatabaseSync(f.sqlite, { readOnly: true });
  try {
    assert.equal(
      after.prepare("SELECT body FROM records").get().body,
      "must survive failed restore",
    );
  } finally {
    after.close();
  }
  assert(
    (await fs.readdir(path.join(f.project, "backups"))).some((name) =>
      name.startsWith(".restore-stage-"),
    ),
  );
  await verifyBackup(backup);
});

test("rename retries only transient locks and preserves existing destinations", async (t) => {
  const f = await fixture(t);
  const source = path.join(f.project, "move-source.txt");
  const destination = path.join(f.project, "move-destination.txt");
  await fs.writeFile(source, "source fixture");
  let attempts = 0;
  await renameWithRetry(source, destination, {
    maxAttempts: 4,
    delayMs: 0,
    rename: async (from, to) => {
      attempts++;
      if (attempts < 3)
        throw Object.assign(new Error("Transient Windows lock"), {
          code: attempts === 1 ? "EPERM" : "EBUSY",
        });
      return fs.rename(from, to);
    },
  });
  assert.equal(attempts, 3);
  assert.equal(await fs.readFile(destination, "utf8"), "source fixture");
  await fs.writeFile(source, "must remain");
  attempts = 0;
  await assert.rejects(
    () =>
      renameWithRetry(source, destination, {
        delayMs: 0,
        rename: async () => {
          attempts++;
        },
      }),
    /Refusing to overwrite/,
  );
  assert.equal(attempts, 0);
  assert.equal(await fs.readFile(source, "utf8"), "must remain");
  assert.equal(await fs.readFile(destination, "utf8"), "source fixture");
});

test("permanent rename locks are bounded and retain the source path", async (t) => {
  const f = await fixture(t);
  const source = path.join(f.project, "locked-source.txt");
  const destination = path.join(f.project, "locked-destination.txt");
  await fs.writeFile(source, "retained source");
  let attempts = 0;
  await assert.rejects(
    () =>
      renameWithRetry(source, destination, {
        maxAttempts: 3,
        delayMs: 0,
        rename: async () => {
          attempts++;
          throw Object.assign(new Error("Persistent lock"), { code: "EACCES" });
        },
      }),
    (error) =>
      error.message.includes(source) && /after 3 attempts/.test(error.message),
  );
  assert.equal(attempts, 3);
  assert.equal(await fs.readFile(source, "utf8"), "retained source");
  await assert.rejects(
    () => fs.stat(destination),
    (error) => error.code === "ENOENT",
  );
  attempts = 0;
  await assert.rejects(
    () =>
      renameWithRetry(source, destination, {
        maxAttempts: 3,
        delayMs: 0,
        rename: async () => {
          attempts++;
          throw Object.assign(new Error("Storage error"), { code: "EIO" });
        },
      }),
    /Storage error/,
  );
  assert.equal(attempts, 1);
});

test("a permanently locked backup finalization retains a verified partial", async (t) => {
  const f = await fixture(t);
  const originalRename = fs.rename;
  let attempts = 0;
  fs.rename = async (source, destination) => {
    if (path.basename(source).startsWith(".partial-")) {
      attempts++;
      throw Object.assign(new Error("Persistent finalization lock"), {
        code: "EPERM",
      });
    }
    return originalRename(source, destination);
  };
  try {
    await assert.rejects(
      () => createBackup({ projectRoot: f.project, port: f.port }),
      (error) =>
        /source was retained/.test(error.message) &&
        error.message.includes(".partial-"),
    );
  } finally {
    fs.rename = originalRename;
  }
  assert.equal(attempts, 8);
  const output = path.join(f.project, "backups");
  const partial = (await fs.readdir(output)).find((name) =>
    name.startsWith(".partial-"),
  );
  assert(partial);
  await verifyBackup({ backupPath: path.join(output, partial) });
});
