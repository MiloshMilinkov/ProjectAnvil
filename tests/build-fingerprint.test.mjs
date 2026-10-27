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

test("local launcher detects changed source and missing assets, ignoring private runtime data", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "projectanvil-build-"));
  try {
    for (const dir of ["app", "dist/server", "dist/client", ".wrangler/state"])
      await fs.mkdir(path.join(root, dir), { recursive: true });
    await fs.writeFile(path.join(root, "app/page.tsx"), "original");
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
