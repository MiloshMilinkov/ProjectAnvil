import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
// A separate temporary directory keeps the test database and generated code away
// from the application's persisted local workspace and attachments.
const output = fs.mkdtempSync(
  path.join(os.tmpdir(), "projectanvil-backend-check-"),
);
const files = [
  "app/lib/types.ts",
  "app/lib/offline-store.ts",
  "app/lib/workspace-transport.ts",
  "app/lib/response-bytes.ts",
  "app/lib/account-refresh.ts",
  "app/lib/offline-projection.ts",
  "app/lib/portable-markdown.ts",
  "app/lib/portable-store.ts",
  "app/api/portable/route.ts",
  "app/lib/task-scheduling.ts",
  "app/lib/task-drafts.ts",
  "app/lib/planning-model.ts",
  "app/lib/planning-progress.ts",
  "app/lib/recurrence.ts",
  "app/lib/reminder-time.ts",
  "app/lib/reminder-state.ts",
  "app/lib/bulk-tasks.ts",
  "app/lib/bulk-drafts.ts",
  "app/lib/milestone-drafts.ts",
  "app/lib/task-copy.ts",
  "app/lib/trash-actions.ts",
  "app/lib/saved-view-config.ts",
  "app/lib/trash-types.ts",
  "app/lib/workspace-trash.ts",
  "app/lib/personal-templates.ts",
  "app/lib/personal-template-store.ts",
  "app/lib/seed.ts",
  "app/lib/workspace-model.ts",
  "app/lib/connected-thinking-model.ts",
  "app/lib/note-structures.ts",
  "app/lib/brainstorm-drafts.ts",
  "app/lib/collection-keys.ts",
  "app/lib/access-store.ts",
  "app/lib/access-types.ts",
  "app/lib/permissions.ts",
  "app/lib/collaboration-types.ts",
  "app/lib/collaboration-model.ts",
  "app/lib/collaboration-store.ts",
  "app/lib/note-collaboration.ts",
  "app/lib/note-collaboration-drafts.ts",
  "app/lib/note-collaboration-draft-keys.ts",
  "app/lib/note-collaboration-runtime.ts",
  "app/lib/note-collaboration-reset.ts",
  "app/lib/note-collaboration-store.ts",
  "app/lib/workspace-store.ts",
  "app/lib/relationships.ts",
  "app/lib/workrooms.ts",
  "app/lib/workroom-store.ts",
  "app/lib/source-excerpts.ts",
  "app/lib/workspace-journal.ts",
  "app/lib/media-store.ts",
  "app/lib/request-body.ts",
  "app/lib/draft-store.ts",
  "app/lib/queued-mutation-lock.ts",
  "app/lib/workspace-preferences.ts",
  "app/lib/editor-mutations.ts",
  "app/lib/note-drafts.ts",
  "app/api/state/route.ts",
  "app/api/media/route.ts",
  "app/api/media/[id]/route.ts",
  "app/api/export/route.ts",
  "app/api/account/route.ts",
  "app/api/teams/route.ts",
  "app/api/rooms/route.ts",
  "app/api/history/route.ts",
  "app/api/storage/route.ts",
  "app/api/trash/route.ts",
  "app/api/templates/route.ts",
  "app/api/live/route.ts",
  "app/api/coedit/route.ts",
  "app/api/activity/route.ts",
  "app/api/watch/route.ts",
  "app/api/notifications/route.ts",
];
try {
  fs.writeFileSync(
    path.join(output, "package.json"),
    JSON.stringify({ type: "commonjs" }),
  );
  for (const relative of files) {
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    });
    const destination = path.join(
      output,
      "compiled",
      relative.replace(/\.ts$/, ".js"),
    );
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, outputText);
  }
  fs.copyFileSync(
    path.join(root, "tests", "backend.cjs"),
    path.join(output, "check.cjs"),
  );
  fs.copyFileSync(
    path.join(root, "tests", "account-boundaries.cjs"),
    path.join(output, "account-boundaries.cjs"),
  );
  fs.copyFileSync(
    path.join(root, "tests", "connected-work.cjs"),
    path.join(output, "connected-work.cjs"),
  );
  fs.copyFileSync(
    path.join(root, "tests", "reliability.cjs"),
    path.join(output, "reliability.cjs"),
  );
  fs.copyFileSync(
    path.join(root, "tests", "drafts.cjs"),
    path.join(output, "drafts.cjs"),
  );
  fs.copyFileSync(
    path.join(root, "tests", "task-scheduling.cjs"),
    path.join(output, "task-scheduling.cjs"),
  );
  for (const name of [
    "phase1-trash.cjs",
    "offline.cjs",
    "queued-mutation-locks.cjs",
    "response-bytes.cjs",
    "portable-markdown.cjs",
    "phase5-portability.cjs",
    "phase2-planning.cjs",
    "phase3-connected.cjs",
    "brainstorm-drafts.cjs",
    "collection-keys.cjs",
    "phase4-permissions.cjs",
    "phase4-collaboration.cjs",
    "phase4-coedit.cjs",
    "phase4-boundaries.cjs",
    "note-collaboration.cjs",
    "note-structures.cjs",
    "personal-templates.cjs",
    "task-copy.cjs",
    "saved-views.cjs",
    "note-templates.cjs",
    "recurrence.cjs",
    "milestone-drafts.cjs",
    "planning-actions.cjs",
  ]) {
    fs.copyFileSync(path.join(root, "tests", name), path.join(output, name));
  }
  const result = spawnSync(process.execPath, [path.join(output, "check.cjs")], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      PROJECTANVIL_CHECK_ROOT: root,
      NODE_PATH: [path.join(root, "node_modules"), process.env.NODE_PATH]
        .filter(Boolean)
        .join(path.delimiter),
    },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
  for (const check of [
    { file: "drafts.cjs" },
    { file: "offline.cjs" },
    { file: "queued-mutation-locks.cjs" },
    { file: "response-bytes.cjs" },
    { file: "portable-markdown.cjs" },
    { file: "task-copy.cjs" },
    { file: "saved-views.cjs" },
    { file: "note-templates.cjs" },
    { file: "recurrence.cjs", timezone: "Europe/Belgrade" },
    { file: "recurrence.cjs", timezone: "America/New_York" },
    { file: "milestone-drafts.cjs" },
    { file: "planning-actions.cjs" },
    { file: "brainstorm-drafts.cjs" },
    { file: "collection-keys.cjs" },
    { file: "note-collaboration.cjs" },
    { file: "note-structures.cjs" },
    { file: "task-scheduling.cjs", timezone: "Europe/Belgrade" },
    { file: "task-scheduling.cjs", timezone: "America/New_York" },
  ]) {
    if (process.exitCode) break;
    const draftResult = spawnSync(
      process.execPath,
      [path.join(output, check.file)],
      {
        cwd: root,
        stdio: "inherit",
        env: {
          ...process.env,
          ...(check.timezone ? { TZ: check.timezone } : {}),
          NODE_PATH: [path.join(root, "node_modules"), process.env.NODE_PATH]
            .filter(Boolean)
            .join(path.delimiter),
        },
      },
    );
    if (draftResult.error) throw draftResult.error;
    process.exitCode = draftResult.status ?? 1;
  }
} finally {
  const relative = path.relative(
    path.resolve(os.tmpdir()),
    path.resolve(output),
  );
  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !path.basename(output).startsWith("projectanvil-backend-check-")
  )
    throw new Error("Refusing to clean an unexpected test output path.");
  fs.rmSync(output, { recursive: true, force: true });
}
