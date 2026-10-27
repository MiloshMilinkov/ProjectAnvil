import { readFile } from "node:fs/promises";

/** Public build identifiers only; never include account or machine information. */
export async function readBuildInfo() {
  const assets = JSON.parse(
    await readFile(
      new URL("../../dist/client/app-assets.json", import.meta.url),
      "utf8",
    ),
  );
  const stamp = JSON.parse(
    await readFile(
      new URL("../../dist/.projectanvil-build.json", import.meta.url),
      "utf8",
    ),
  );
  return { version: assets.version, sourceFingerprint: stamp.fingerprint };
}
