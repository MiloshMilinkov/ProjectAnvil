import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { releaseConfigurationReport } from "../app/lib/release-config.ts";
import {
  databaseMigrationPlan,
  ensureDatabaseSchema,
  migrationSources,
} from "../app/lib/database-migrations.ts";
import { createBackup, restoreBackup, verifyBackup } from "./local-backup.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

function fixtureDatabase(sql) {
  const prepare = (query, bindings = []) => ({
    bind(...values) {
      return prepare(query, values);
    },
    async first() {
      return sql.prepare(query).get(...bindings) || null;
    },
    async all() {
      return { results: sql.prepare(query).all(...bindings) };
    },
    async run() {
      return sql.prepare(query).run(...bindings);
    },
    query,
    bindings,
  });
  return {
    prepare,
    async batch(statements) {
      sql.exec("BEGIN");
      try {
        const result = statements.map(({ query, bindings }) => {
          const statement = sql.prepare(query);
          return /^(SELECT|PRAGMA)\b/i.test(query)
            ? { results: statement.all(...bindings) }
            : { results: [], meta: statement.run(...bindings) };
        });
        sql.exec("COMMIT");
        return result;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Own synthetic state only; there is deliberately no live database/path parameter. */
export async function runReleaseRehearsal() {
  const temporaryRoot = path.resolve(os.tmpdir());
  const directory = await fs.mkdtemp(
    path.join(temporaryRoot, "projectanvil-release-rehearsal-"),
  );
  const projectRoot = path.join(directory, "project");
  const state = path.join(projectRoot, ".wrangler", "state", "v3");
  const databasePath = path.join(state, "d1", "fixture.sqlite");
  const attachment = path.join(state, "r2", "fixture.bin");
  const secret = path.join(projectRoot, ".dev.vars");
  let sql;
  let primaryError;
  let report;
  const checks = {};
  try {
    await fs.mkdir(path.dirname(databasePath), { recursive: true });
    await fs.mkdir(path.dirname(attachment), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify({
        name: "release-rehearsal-fixture",
        version: "0.0.0-test",
      }),
    );
    const originalSecret = `BETTER_AUTH_SECRET=${"fixture-only-not-a-real-secret-".repeat(3)}\n`;
    await fs.writeFile(secret, originalSecret, { mode: 0o600 });
    await fs.writeFile(attachment, "fixture attachment before release");
    const sources = await Promise.all(
      migrationSources.map(({ file }) =>
        fs.readFile(path.join(root, file), "utf8"),
      ),
    );
    const plan = await databaseMigrationPlan(sources);
    sql = new DatabaseSync(databasePath);
    sql.exec("PRAGMA foreign_keys = ON");
    sql.exec(plan.ledgerSQL);
    const apply = async (migration) =>
      fixtureDatabase(sql).batch(
        migration.batch.map(({ sql: query, bindings }) =>
          fixtureDatabase(sql)
            .prepare(query)
            .bind(...bindings),
        ),
      );
    for (const migration of plan.migrations.slice(0, -1))
      await apply(migration);
    const payload = JSON.stringify({
      name: "Release rehearsal fixture",
      tasks: [{ id: "task-fixture", title: "Preserved task" }],
      notes: [{ id: "note-fixture", content: "Preserved note" }],
    });
    sql
      .prepare(
        "INSERT INTO workspaces (id,data,revision,updated_at) VALUES (?,?,?,?)",
      )
      .run("main", payload, 7, "2026-01-01T00:00:00Z");
    sql.close();
    sql = undefined;
    const port = await unusedPort();
    const baseline = await createBackup({ projectRoot, port });
    await verifyBackup(baseline);
    checks.backupVerified = true;
    sql = new DatabaseSync(databasePath);
    await apply(plan.migrations.at(-1));
    await ensureDatabaseSchema(fixtureDatabase(sql), "online", sources);
    if (
      sql.prepare("SELECT data FROM workspaces WHERE id='main'").get().data !==
      payload
    )
      throw new Error("Migration changed existing workspace data.");
    checks.migrationPreservedData = true;
    // A failing batch must leave neither its schema change nor ledger marker behind.
    try {
      await fixtureDatabase(sql).batch([
        fixtureDatabase(sql).prepare(
          "CREATE TABLE rehearsal_failed_migration (id TEXT)",
        ),
        fixtureDatabase(sql).prepare(
          "INSERT INTO table_that_does_not_exist VALUES (1)",
        ),
      ]);
      throw new Error("The failure fixture unexpectedly succeeded.");
    } catch (error) {
      if (!/table_that_does_not_exist/.test(error.message)) throw error;
    }
    if (
      sql
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='rehearsal_failed_migration'",
        )
        .get()
    )
      throw new Error("Failed migration was not rolled back atomically.");
    checks.failedMigrationRolledBack = true;
    sql
      .prepare("UPDATE workspaces SET data=?, revision=8 WHERE id='main'")
      .run('{"name":"After release fixture"}');
    sql.close();
    sql = undefined;
    await fs.writeFile(attachment, "fixture attachment after release");
    await fs.writeFile(
      secret,
      `BETTER_AUTH_SECRET=${"changed-fixture-secret-".repeat(3)}\n`,
      { mode: 0o600 },
    );
    const restored = await restoreBackup({
      projectRoot,
      backupPath: baseline.backupPath,
      port,
    });
    sql = new DatabaseSync(databasePath);
    if (
      sql.prepare("SELECT data FROM workspaces WHERE id='main'").get().data !==
        payload ||
      sql.prepare("SELECT COUNT(*) AS count FROM app_migrations").get()
        .count !==
        plan.toVersion - 1 ||
      (await fs.readFile(attachment, "utf8")) !==
        "fixture attachment before release" ||
      (await fs.readFile(secret, "utf8")) !== originalSecret
    )
      throw new Error(
        "Restore did not recover matching database, attachments, and secret.",
      );
    sql.close();
    sql = undefined;
    checks.releaseRollbackRestoredAllState = true;
    await verifyBackup({ backupPath: restored.rollbackPath });
    await restoreBackup({
      projectRoot,
      backupPath: restored.rollbackPath,
      port,
    });
    sql = new DatabaseSync(databasePath);
    await ensureDatabaseSchema(fixtureDatabase(sql), "online", sources);
    if (
      sql.prepare("SELECT revision FROM workspaces WHERE id='main'").get()
        .revision !== 8 ||
      (await fs.readFile(attachment, "utf8")) !==
        "fixture attachment after release" ||
      (await fs.readFile(secret, "utf8")) !==
        `BETTER_AUTH_SECRET=${"changed-fixture-secret-".repeat(3)}\n`
    )
      throw new Error(
        "The preserved previous-state recovery could not be restored.",
      );
    checks.previousStateRecoveryVerified = true;
    report = {
      format: 1,
      passed: true,
      migrationVersion: plan.toVersion,
      checks,
      scope:
        "Disposable local SQLite, file, and secret fixtures only; no hosted resources or real installation data were accessed.",
    };
  } catch (error) {
    primaryError = error;
  }
  const cleanupErrors = [];
  try {
    sql?.close();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    const relative = path.relative(temporaryRoot, path.resolve(directory));
    if (
      !relative ||
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      !path.basename(directory).startsWith("projectanvil-release-rehearsal-") ||
      (await fs.lstat(directory)).isSymbolicLink()
    )
      throw new Error("Refusing an unsafe rehearsal cleanup path.");
    await fs.rm(directory, { recursive: true, force: true });
  } catch (error) {
    cleanupErrors.push(error);
  }
  const errors = [primaryError, ...cleanupErrors].filter(Boolean);
  if (errors.length > 1)
    throw new AggregateError(
      errors,
      "Release rehearsal and owned fixture cleanup failed.",
    );
  if (errors.length === 1) throw errors[0];
  return report;
}

async function writeReport(output, report) {
  const target = path.resolve(root, output);
  const allowed = path.join(root, "outputs", "release");
  const relative = path.relative(allowed, target);
  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    path.extname(target) !== ".json"
  )
    throw new Error(
      "Save redacted release reports inside outputs/release with a .json filename.",
    );
  let current = root;
  for (const segment of path.relative(root, target).split(path.sep)) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (stat?.isSymbolicLink())
      throw new Error("Release reports cannot follow symlinks or junctions.");
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
}

async function main() {
  const args = process.argv.slice(2);
  let rehearse = false,
    output;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--rehearse" && !rehearse) rehearse = true;
    else if (args[index] === "--out" && !output && args[index + 1])
      output = args[++index];
    else
      throw new Error(
        "Use no arguments for configuration checks, --rehearse for disposable recovery fixtures, and optionally --out outputs/release/NAME.json.",
      );
  }
  const report = rehearse
    ? await runReleaseRehearsal()
    : releaseConfigurationReport(process.env);
  if (output) await writeReport(output, report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch(() => {
    console.error(
      "Release preparation stopped. Check configuration and owned fixture permissions; no hosting or external email was started.",
    );
    process.exitCode = 1;
  });
