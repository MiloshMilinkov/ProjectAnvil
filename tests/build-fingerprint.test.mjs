import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  sourceFingerprint,
  recordBuild,
  isBuildCurrent,
} from "../scripts/build-fingerprint.mjs";

test("local launcher detects source and migration changes and missing assets, ignoring private runtime data", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "projectanvil-build-"));
  try {
    for (const dir of [
      "app",
      "db",
      "drizzle",
      "dist/server",
      "dist/client",
      ".wrangler/state",
    ])
      await fs.mkdir(path.join(root, dir), { recursive: true });
    await fs.writeFile(path.join(root, "app/page.tsx"), "original");
    await fs.writeFile(path.join(root, "db/auth.sql"), "-- original auth schema");
    await fs.writeFile(
      path.join(root, "drizzle/0000_workspace.sql"),
      "-- original workspace schema",
    );
    for (const file of [
      "dist/server/wrangler.json",
      "dist/client/service-worker.js",
      "dist/client/app-assets.json",
    ])
      await fs.writeFile(path.join(root, file), "{}");
    assert.equal(await isBuildCurrent(root), false);
    const fingerprint = await sourceFingerprint(root);
    await recordBuild(root, fingerprint);
    assert.equal(await isBuildCurrent(root), true);
    await fs.writeFile(
      path.join(root, ".wrangler/state/private-data"),
      "runtime",
    );
    await fs.writeFile(path.join(root, ".dev.vars"), "private");
    assert.equal(await isBuildCurrent(root), true);
    // These SQL files are bundled through raw imports. A migration-only edit
    // must invalidate the production build even when app source is unchanged.
    for (const migration of ["db/auth.sql", "drizzle/0000_workspace.sql"]) {
      await fs.appendFile(path.join(root, migration), "\n-- updated migration");
      assert.equal(await isBuildCurrent(root), false, migration);
      await recordBuild(root, await sourceFingerprint(root));
      assert.equal(await isBuildCurrent(root), true, migration);
    }
    await fs.writeFile(path.join(root, "app/page.tsx"), "changed");
    assert.equal(await isBuildCurrent(root), false);
    await assert.rejects(recordBuild(root, fingerprint), /Source changed/);
    await recordBuild(root, await sourceFingerprint(root));
    await fs.unlink(path.join(root, "dist/client/service-worker.js"));
    assert.equal(await isBuildCurrent(root), false);
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("projectanvil-build-"));
    await fs.rm(root, { recursive: true, force: true });
  }
});
