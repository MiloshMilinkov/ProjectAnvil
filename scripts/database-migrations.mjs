import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  databaseMigrationPlan,
  migrationSources,
} from "../app/lib/database-migrations.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
let from = 0,
  output;
const used = new Set();
for (let index = 0; index < args.length; index += 2) {
  const option = args[index],
    value = args[index + 1];
  if (!["--from", "--out"].includes(option) || !value || used.has(option))
    throw new Error(
      "Use --from VERSION and optionally --out outputs/migrations/NAME.json. This command only prepares a plan.",
    );
  used.add(option);
  if (option === "--from") {
    if (!/^\d+$/.test(value))
      throw new Error("Choose a nonnegative migration version.");
    from = Number(value);
  } else output = value;
}
const sources = await Promise.all(
  migrationSources.map(({ file }) => fs.readFile(path.join(root, file), "utf8")),
);
const plan = await databaseMigrationPlan(sources, from);
const result =
  JSON.stringify(
    {
      ...plan,
      instructions:
        "Review expectedHistory against the target ledger before applying each migration and its ledger entry in one atomic batch. Back up database, uploads, and secrets first. This plan never connects to a database or applies SQL.",
    },
    null,
    2,
  ) + "\n";
if (output) {
  const allowed = path.join(root, "outputs", "migrations");
  const target = path.resolve(root, output);
  const relative = path.relative(allowed, target);
  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    path.extname(target).toLowerCase() !== ".json"
  )
    throw new Error(
      "Save migration plans inside outputs/migrations with a .json filename.",
    );
  // Reject existing symlink/junction ancestors before creating or writing output.
  const segments = path.relative(root, target).split(path.sep);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (stat?.isSymbolicLink())
      throw new Error(
        "Migration plans cannot be written through symlinks or junctions.",
      );
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, result, { flag: "wx" });
  console.log(
    `Prepared migration plan ${from} → ${plan.toVersion}. No database was opened or changed.`,
  );
} else process.stdout.write(result);
