import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

/** Read-only local inspection; account links are never served by an HTTP route. */
export async function readLocalAccountMail({
  stateDirectory = path.join(root, ".wrangler/state"),
  email,
}) {
  if (
    typeof email !== "string" ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )
    throw new Error("Provide the account email address with --email.");
  const directory = path.resolve(stateDirectory);
  const files = await fs.readdir(directory, {
    withFileTypes: true,
    recursive: true,
  });
  const messages = [];
  for (const entry of files) {
    if (!entry.isFile() || !entry.name.endsWith(".sqlite")) continue;
    const location = path.resolve(entry.parentPath, entry.name);
    const relative = path.relative(directory, location);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error(
        "Refusing to inspect a database outside the local state folder.",
      );
    // Reject symlinked database files and parent folders before opening them.
    let ancestor = location;
    while (ancestor !== directory) {
      if ((await fs.lstat(ancestor)).isSymbolicLink())
        throw new Error("Account mail cannot be read through symbolic links.");
      ancestor = path.dirname(ancestor);
    }
    const database = new DatabaseSync(location, { readOnly: true });
    try {
      const table = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='account_mail_outbox'",
        )
        .get();
      if (!table) continue;
      messages.push(
        ...database
          .prepare(
            "SELECT kind,url,created_at,expires_at FROM account_mail_outbox WHERE email = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 20",
          )
          .all(email.toLowerCase(), Date.now()),
      );
    } finally {
      database.close();
    }
  }
  return messages.sort((a, b) => b.created_at - a.created_at).slice(0, 20);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "--email")
      throw new Error("Use npm run account-mail -- --email you@example.com");
    const messages = await readLocalAccountMail({ email: process.argv[3] });
    if (!messages.length)
      console.log(
        "No unexpired local account links. Request a new link in ProjectAnvil.",
      );
    else {
      console.log(
        "Private local account links. Do not share or commit this output.",
      );
      for (const message of messages)
        console.log(
          `${message.kind} · ${new Date(message.created_at).toLocaleString()}\n${message.url}\n`,
        );
    }
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Local account links could not be read.",
    );
    process.exitCode = 1;
  }
}
