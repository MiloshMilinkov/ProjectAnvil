import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { getMigrations } from "better-auth/db/migration";
import { authOptions } from "../app/lib/auth-options.ts";

if (process.argv.length > 2)
  throw new Error(
    "This command only prints candidate SQL. Review changes and append a migration; existing migration files are immutable.",
  );

// Use a disposable database and ephemeral secret; never read local account state.
const database = new DatabaseSync(":memory:");
try {
  const migration = await getMigrations(
    authOptions(
      database,
      randomBytes(48).toString("base64url"),
      "http://127.0.0.1:5173",
    ),
  );
  const sql = (await migration.compileMigrations())
    .replaceAll("create table ", "create table if not exists ")
    .replaceAll("create index ", "create index if not exists ")
    .replaceAll("create unique index ", "create unique index if not exists ");
  process.stdout.write(
    "-- Candidate account schema for review; no database or source files were changed.\n" +
      "-- Compare with applied migration history and append a new migration for changes.\n" +
      sql +
      "\n",
  );
} finally {
  database.close();
}
