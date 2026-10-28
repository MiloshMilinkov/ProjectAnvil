/** Immutable migration history. Append sources; never rewrite an applied migration. */
export const migrationSources = [
  { name: "workspace", file: "drizzle/0000_dear_mimic.sql" },
  { name: "accounts", file: "db/auth.sql" },
  { name: "workspace-access", file: "db/access.sql" },
  { name: "work-rooms", file: "db/workrooms.sql" },
  { name: "recovery", file: "db/reliability.sql" },
  { name: "activity", file: "db/collaboration.sql" },
  { name: "shared-notes", file: "db/note-collaboration.sql" },
  { name: "account-recovery", file: "db/release.sql" },
] as const;

type MigrationDatabase = Pick<D1Database, "prepare" | "batch">;
export interface DatabaseMigration {
  version: number;
  name: string;
  checksum: string;
  statements: string[];
}
interface AppliedMigration {
  version: number;
  name: string;
  checksum: string;
}

const ledgerSQL = `CREATE TABLE IF NOT EXISTS app_migrations (
  version INTEGER PRIMARY KEY NOT NULL CHECK(version > 0),
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`;
const recordMigrationSQL =
  "INSERT INTO app_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

function additiveStatement(sql: string) {
  return sql.replace(
    /^CREATE TABLE (?!IF NOT EXISTS)/i,
    "CREATE TABLE IF NOT EXISTS ",
  );
}

/** Split ordinary SQL without treating quoted semicolons or comments as separators. */
export function splitMigrationSQL(source: string): string[] {
  const statements: string[] = [];
  let current = "",
    quote = "",
    blockComment = false,
    lineComment = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index],
      next = source[index + 1];
    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
        current += "\n";
      }
    } else if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index++;
        current += " ";
      }
    } else if (quote) {
      current += char;
      if (char === quote) {
        if (next === quote && quote !== "]") {
          current += next;
          index++;
        } else quote = "";
      }
    } else if (char === "-" && next === "-") {
      lineComment = true;
      index++;
      current += " ";
    } else if (char === "/" && next === "*") {
      blockComment = true;
      index++;
      current += " ";
    } else if (["'", '"', "`", "["].includes(char)) {
      quote = char === "[" ? "]" : char;
      current += char;
    } else if (char === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
    } else current += char;
  }
  if (quote || blockComment)
    throw new Error("Migration SQL has an unfinished quote or comment.");
  if (current.trim()) statements.push(current.trim());
  if (
    statements.some((sql) =>
      /^(?:BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|CREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER)\b/i.test(sql),
    )
  )
    throw new Error(
      "Migrations use atomic database batches; transaction commands and triggers need a dedicated migration implementation.",
    );
  return statements;
}

export async function createDatabaseMigrations(
  sources: readonly string[],
): Promise<DatabaseMigration[]> {
  if (sources.length !== migrationSources.length)
    throw new Error("The database migration source list is incomplete.");
  return await Promise.all(
    migrationSources.map(async (migration, index) => {
      const source = sources[index].replace(/\r\n?/g, "\n").trim();
      const statements = splitMigrationSQL(source);
      if (!statements.length) throw new Error(`Migration ${index + 1} is empty.`);
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(source),
      );
      return {
        version: index + 1,
        name: migration.name,
        checksum: Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join(""),
        statements,
      };
    }),
  );
}

async function readLedger(
  database: MigrationDatabase,
): Promise<AppliedMigration[] | null> {
  const exists = await database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_migrations'",
    )
    .first();
  if (!exists) return null;
  return (
    await database
      .prepare("SELECT version, name, checksum FROM app_migrations ORDER BY version")
      .all<AppliedMigration>()
  ).results;
}

function validateLedger(
  applied: AppliedMigration[],
  migrations: DatabaseMigration[],
) {
  for (let index = 0; index < applied.length; index++) {
    const current = applied[index],
      expected = migrations[index];
    if (
      !expected ||
      current.version !== expected.version ||
      current.name !== expected.name ||
      current.checksum !== expected.checksum
    )
      throw new Error(
        "Database migration history does not match this application. Restore the matching source/backup; do not edit migration history.",
      );
  }
}

/** Check known objects and columns as well as the ledger, including legacy adoption. */
async function verifySchema(
  database: MigrationDatabase,
  migrations: DatabaseMigration[],
  allowMissing = false,
) {
  const objects = (
    await database
      .prepare("SELECT type, name FROM sqlite_master WHERE type IN ('table', 'index')")
      .all<{ type: string; name: string }>()
  ).results;
  const available = new Set(objects.map((entry) => `${entry.type}:${entry.name}`));
  const tables: { name: string; columns: { name: string; type: string }[] }[] = [];
  for (const { statements } of migrations) {
    for (const sql of statements) {
      const match =
        /^CREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX)\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?([\w]+)["`\]]?/i.exec(sql);
      if (!match) continue;
      const [, type, name] = match;
      if (!available.has(`${type.toLowerCase()}:${name}`)) {
        if (allowMissing) continue;
        throw new Error(
          `Database schema is missing ${type.toLowerCase()} ${name}. Restore a verified backup before continuing.`,
        );
      }
      if (type.toUpperCase() !== "TABLE") continue;
      const definition = sql.slice(sql.indexOf("(") + 1);
      const columns = [
        ...definition.matchAll(
          /(?:^|,)\s*["`[]?([\w]+)["`\]]?\s+(TEXT|INTEGER|BIGINT|DATE)\b/gi,
        ),
      ].map((column) => ({ name: column[1], type: column[2].toUpperCase() }));
      tables.push({ name, columns });
    }
  }
  if (!tables.length) return;
  const results = await database.batch(
    tables.map((table) => database.prepare(`PRAGMA table_info("${table.name}")`)),
  );
  for (let index = 0; index < tables.length; index++) {
    const actual = new Map(
      (results[index].results as { name: string; type: string }[]).map((column) => [
        column.name,
        column.type.toUpperCase(),
      ]),
    );
    if (
      tables[index].columns.some((column) => actual.get(column.name) !== column.type)
    )
      throw new Error(
        `Database table ${tables[index].name} does not match its migration. Restore a verified backup before continuing.`,
      );
  }
}

/** Local startup adopts old additive schemas. Online startup only verifies a release. */
export async function ensureDatabaseSchema(
  database: MigrationDatabase,
  mode: "local" | "online",
  sources: readonly string[],
): Promise<void> {
  if (mode !== "local" && mode !== "online")
    throw new Error("Choose an explicit local or online database mode.");
  const migrations = await createDatabaseMigrations(sources);
  let applied = await readLedger(database);
  if (!applied && mode === "online")
    throw new Error(
      "Database migrations have not been applied. Prepare the database through the reviewed release process.",
    );
  if (!applied) {
    await database.prepare(ledgerSQL).run();
    applied = [];
  }
  validateLedger(applied, migrations);
  if (mode === "online" && applied.length !== migrations.length)
    throw new Error(
      "Database migrations are pending. Apply the reviewed release before starting the online app.",
    );
  await verifySchema(database, migrations.slice(0, applied.length));
  // Refuse to adopt malformed legacy tables rather than recording a false baseline.
  if (mode === "local") await verifySchema(database, migrations, true);
  for (const migration of migrations.slice(applied.length)) {
    try {
      await database.batch([
        ...migration.statements.map((sql) =>
          database.prepare(additiveStatement(sql)),
        ),
        database
          .prepare(recordMigrationSQL)
          .bind(migration.version, migration.name, migration.checksum),
      ]);
    } catch (cause) {
      // A second local startup may have completed the same atomic batch first.
      const current = await readLedger(database);
      if (!current) throw cause;
      validateLedger(current, migrations);
      if (current.length < migration.version)
        throw new Error(
          `Database migration ${migration.version} failed. Existing data was kept; restore a verified backup or retry after fixing the cause.`,
          { cause },
        );
    }
  }
  const final = await readLedger(database);
  if (!final || final.length !== migrations.length)
    throw new Error("Database migration history could not be confirmed.");
  validateLedger(final, migrations);
  await verifySchema(database, migrations);
}

/** Produces reviewable atomic batches; it does not open a database or apply SQL. */
export async function databaseMigrationPlan(
  sources: readonly string[],
  fromVersion = 0,
) {
  const migrations = await createDatabaseMigrations(sources);
  if (
    !Number.isInteger(fromVersion) ||
    fromVersion < 0 ||
    fromVersion > migrations.length
  )
    throw new Error("Choose a valid existing database migration version.");
  return {
    format: 1,
    fromVersion,
    toVersion: migrations.length,
    ledgerSQL,
    expectedHistory: migrations
      .slice(0, fromVersion)
      .map(({ version, name, checksum }) => ({ version, name, checksum })),
    migrations: migrations.slice(fromVersion).map(({ statements, ...metadata }) => ({
      ...metadata,
      batch: [
        ...statements.map((sql) => ({
          sql: additiveStatement(sql),
          bindings: [] as (string | number)[],
        })),
        {
          sql: recordMigrationSQL,
          bindings: [metadata.version, metadata.name, metadata.checksum],
        },
      ],
    })),
  };
}
