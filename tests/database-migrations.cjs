const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  migrationSources,
  splitMigrationSQL,
  createDatabaseMigrations,
  ensureDatabaseSchema,
  databaseMigrationPlan,
} = require("./compiled/app/lib/database-migrations");

const root = process.env.PROJECTANVIL_CHECK_ROOT || process.cwd();
const sources = migrationSources.map(({ file }) => fs.readFileSync(path.join(root, file), "utf8"));

function database(sql = new DatabaseSync(":memory:"), fail = () => false) {
  sql.exec("PRAGMA foreign_keys = ON");
  const statement = (query, values = []) => ({
    query,
    values,
    bind(...bindings) { return statement(query, bindings); },
    async first(column) {
      const result = sql.prepare(query).get(...values);
      return column ? result?.[column] ?? null : result || null;
    },
    async all() { return { success: true, results: sql.prepare(query).all(...values), meta: {} }; },
    async run() {
      const result = sql.prepare(query).run(...values);
      return { success: true, results: [], meta: { changes: Number(result.changes) } };
    },
  });
  return {
    sql,
    prepare: statement,
    async batch(statements) {
      sql.exec("BEGIN TRANSACTION");
      try {
        const results = [];
        for (const entry of statements) {
          if (fail(entry.query)) throw new Error("Injected migration failure");
          const command = sql.prepare(entry.query);
          const read = /^(?:SELECT|PRAGMA)\b/i.test(entry.query);
          const result = read ? command.all(...entry.values) : command.run(...entry.values);
          results.push({ success: true, results: read ? result : [], meta: {} });
        }
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

const history = (db) => db.sql.prepare("SELECT version, name, checksum FROM app_migrations ORDER BY version").all();
const exists = (db, name) => !!db.sql.prepare("SELECT name FROM sqlite_master WHERE name=?").get(name);
const payload = JSON.stringify({ name: "Private fixture", tasks: [{ id: "task", title: "Preserve exact data" }] });
function seedLegacy(db) {
  sources.slice(0, 7).forEach((source) => db.sql.exec(source));
  db.sql.prepare("INSERT INTO workspaces(id,data,revision,updated_at) VALUES (?,?,?,?)").run("main", payload, 12, "2026-10-28T00:00:00Z");
  db.sql.prepare('INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt,username) VALUES(?,?,?,?,?,?,?)').run("owner", "Owner", "owner@example.test", 0, 1, 1, "owner");
  db.sql.prepare("INSERT INTO workrooms(workspace_id,user_key,id,data,updated_at) VALUES(?,?,?,?,?)").run("main", "owner", "room", '{"title":"Resume this"}', "2026-10-28T00:00:00Z");
  db.sql.prepare("INSERT INTO media_objects(workspace_id,media_id,object_key,state,created_at) VALUES(?,?,?,?,?)").run("main", "file", "private/file", "active", "2026-10-28T00:00:00Z");
}
function confirmLegacy(db) {
  assert.deepEqual({ ...db.sql.prepare("SELECT data,revision FROM workspaces WHERE id='main'").get() }, { data: payload, revision: 12 });
  assert.equal(db.sql.prepare('SELECT username FROM "user" WHERE id=?').get("owner").username, "owner");
  assert.equal(db.sql.prepare("SELECT data FROM workrooms WHERE id='room'").get().data, '{"title":"Resume this"}');
  assert.equal(db.sql.prepare("SELECT object_key FROM media_objects WHERE media_id='file'").get().object_key, "private/file");
}

async function run() {
  assert.deepEqual(splitMigrationSQL("-- ignore;\nSELECT 'a;b', 'it''s'; /* block; */ SELECT 2;"), ["SELECT 'a;b', 'it''s'", "SELECT 2"]);
  assert.throws(() => splitMigrationSQL("SELECT 'unterminated"), /unfinished/);
  assert.throws(() => splitMigrationSQL("/* unfinished"), /unfinished/);
  assert.throws(() => splitMigrationSQL("BEGIN; SELECT 1; COMMIT;"), /atomic/);
  assert.throws(() => splitMigrationSQL("CREATE TRIGGER test BEGIN SELECT 1; END;"), /dedicated/);
  await assert.rejects(() => createDatabaseMigrations(sources.slice(1)), /incomplete/);
  const migrations = await createDatabaseMigrations(sources);
  const windowsSources = sources.map((source) => source.replace(/\r?\n/g, "\r\n"));
  assert.deepEqual((await createDatabaseMigrations(windowsSources)).map((item) => item.checksum), migrations.map((item) => item.checksum));

  const fresh = database();
  await assert.rejects(() => ensureDatabaseSchema(fresh, "online", sources), /not been applied/);
  assert.equal(exists(fresh, "app_migrations"), false, "Online verification must not bootstrap or create a ledger");
  await Promise.all([ensureDatabaseSchema(fresh, "local", sources), ensureDatabaseSchema(fresh, "local", sources)]);
  assert.equal(history(fresh).length, migrationSources.length);
  assert.equal(fresh.sql.prepare("SELECT COUNT(*) AS count FROM workspaces").get().count, 0);
  const before = history(fresh);
  await ensureDatabaseSchema(fresh, "local", sources);
  await ensureDatabaseSchema(fresh, "online", sources);
  assert.deepEqual(history(fresh), before, "Repeated startup must not rewrite ledger history");
  assert.equal(exists(fresh, "account_mail_outbox"), true);
  fresh.sql.close();

  const legacy = database();
  seedLegacy(legacy);
  await ensureDatabaseSchema(legacy, "local", sources);
  confirmLegacy(legacy);
  const changed = [...sources];
  changed[1] += "\n-- A historical migration was rewritten.";
  await assert.rejects(() => ensureDatabaseSchema(legacy, "local", changed), /history does not match/);
  confirmLegacy(legacy);
  legacy.sql.prepare("DELETE FROM app_migrations WHERE version=4").run();
  await assert.rejects(() => ensureDatabaseSchema(legacy, "local", sources), /history does not match/);
  legacy.sql.close();

  const pending = database();
  await ensureDatabaseSchema(pending, "local", sources);
  pending.sql.prepare("DELETE FROM app_migrations WHERE version=?").run(migrationSources.length);
  await assert.rejects(() => ensureDatabaseSchema(pending, "online", sources), /pending/);
  pending.sql.prepare("INSERT INTO app_migrations VALUES(999,'future','unknown','now')").run();
  await assert.rejects(() => ensureDatabaseSchema(pending, "local", sources), /history does not match/);
  pending.sql.close();

  const damaged = database();
  await ensureDatabaseSchema(damaged, "local", sources);
  damaged.sql.exec("DROP TABLE note_presence");
  await assert.rejects(() => ensureDatabaseSchema(damaged, "local", sources), /schema is missing/);
  assert.equal(exists(damaged, "note_presence"), false, "Recorded schema damage must not be silently recreated");
  damaged.sql.close();

  const malformed = database();
  malformed.sql.exec("CREATE TABLE workspaces (id TEXT PRIMARY KEY, data TEXT)");
  await assert.rejects(() => ensureDatabaseSchema(malformed, "local", sources), /does not match its migration/);
  assert.equal(history(malformed).length, 0, "Malformed legacy schema must not receive a migration baseline");
  malformed.sql.close();

  let injected = false;
  const interrupted = database(undefined, (query) => {
    if (!injected && query.startsWith("CREATE INDEX IF NOT EXISTS account_mail_outbox_email_idx")) { injected = true; return true; }
    return false;
  });
  seedLegacy(interrupted);
  await assert.rejects(() => ensureDatabaseSchema(interrupted, "local", sources), /migration 8 failed/);
  assert.equal(history(interrupted).length, 7);
  assert.equal(exists(interrupted, "account_mail_outbox"), false, "DDL and ledger entry must roll back together");
  confirmLegacy(interrupted);
  await ensureDatabaseSchema(interrupted, "local", sources);
  assert.equal(history(interrupted).length, migrationSources.length);
  confirmLegacy(interrupted);
  interrupted.sql.close();

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "projectanvil-migration-rehearsal-"));
  const filename = path.join(directory, "fixture.sqlite"), backup = path.join(directory, "before-upgrade.sqlite");
  let rehearsal;
  try {
    rehearsal = database(new DatabaseSync(filename));
    seedLegacy(rehearsal);
    rehearsal.sql.close();
    rehearsal = null;
    fs.copyFileSync(filename, backup);
    rehearsal = database(new DatabaseSync(filename));
    await ensureDatabaseSchema(rehearsal, "local", sources);
    confirmLegacy(rehearsal);
    rehearsal.sql.prepare("UPDATE workspaces SET data='changed after upgrade'").run();
    rehearsal.sql.close();
    rehearsal = null;
    fs.copyFileSync(backup, filename);
    rehearsal = database(new DatabaseSync(filename));
    assert.equal(exists(rehearsal, "app_migrations"), false);
    confirmLegacy(rehearsal);
    await ensureDatabaseSchema(rehearsal, "local", sources);
    confirmLegacy(rehearsal);
  } finally {
    rehearsal?.sql.close();
    assert(path.basename(directory).startsWith("projectanvil-migration-rehearsal-"));
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
  const plan = await databaseMigrationPlan(sources, 7);
  assert.equal(plan.expectedHistory.length, 7);
  assert.equal(plan.migrations.length, migrationSources.length - 7);
  assert.equal(plan.migrations[0].version, 8);
  assert.equal(plan.migrations[0].batch.at(-1).bindings[0], 8);
  assert.match(plan.migrations[0].batch.at(-1).sql, /^INSERT INTO app_migrations/);
  await assert.rejects(() => databaseMigrationPlan(sources, 999), /valid existing/);
  const artifact = await databaseMigrationPlan(sources);
  const reviewed = database();
  reviewed.sql.exec(artifact.ledgerSQL);
  for (const migration of artifact.migrations) {
    await reviewed.batch(migration.batch.map((entry) => reviewed.prepare(entry.sql).bind(...entry.bindings)));
  }
  await ensureDatabaseSchema(reviewed, "online", sources);
  assert.equal(history(reviewed).length, migrationSources.length, "Review artifacts must include executable ledger entries");
  reviewed.sql.close();
  const cli = (...args) => spawnSync(process.execPath, ["--experimental-strip-types", path.join(root, "scripts/database-migrations.mjs"), ...args], { encoding: "utf8", cwd: root });
  const command = cli("--from", "7");
  assert.equal(command.status, 0, command.stderr);
  assert.equal(JSON.parse(command.stdout).migrations[0].version, 8);
  assert.notEqual(cli("--from", "999").status, 0);
  assert.notEqual(cli("--from", "0", "--from", "1").status, 0);
  assert.notEqual(cli("--out", "../migration-test.json").status, 0);
  const authSchema = path.join(root, "db/auth.sql");
  const originalAuthSchema = fs.readFileSync(authSchema);
  const generateCandidate = (...args) => spawnSync(
    process.execPath,
    ["--experimental-strip-types", path.join(root, "scripts/generate-auth-schema.mjs"), ...args],
    { encoding: "utf8", cwd: root },
  );
  const candidate = generateCandidate();
  assert.equal(candidate.status, 0, candidate.stderr);
  assert.match(candidate.stdout, /Candidate account schema for review/);
  assert.match(candidate.stdout, /create table if not exists/i);
  assert.equal(fs.readFileSync(authSchema).compare(originalAuthSchema), 0, "Schema inspection must never rewrite historical migrations");
  const expectedAuth = new DatabaseSync(":memory:");
  const inspectedAuth = new DatabaseSync(":memory:");
  try {
    expectedAuth.exec(originalAuthSchema.toString("utf8"));
    inspectedAuth.exec(candidate.stdout);
    const names = (sql) => sql.prepare("SELECT type,name FROM sqlite_master WHERE type IN ('table','index') ORDER BY type,name").all();
    assert.deepEqual(names(inspectedAuth), names(expectedAuth), "Current auth configuration should match the recorded account objects");
    for (const name of ["user", "session", "account", "verification", "rateLimit"])
      assert.deepEqual(inspectedAuth.prepare(`PRAGMA table_info("${name}")`).all(), expectedAuth.prepare(`PRAGMA table_info("${name}")`).all(), `Current ${name} fields should match the applied schema`);
  } finally {
    expectedAuth.close();
    inspectedAuth.close();
  }
  assert.notEqual(generateCandidate("--out", "db/auth.sql").status, 0, "The generator must reject source-write arguments");
  assert.equal(fs.readFileSync(authSchema).compare(originalAuthSchema), 0);
  console.log("Database migrations: fresh/legacy upgrade, immutable history, online read-only verification, atomic failure/retry, parallel startup and backup restoration passed.");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
