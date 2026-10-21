import fs from "node:fs";

export function assertNoMaintenance() {
  if (
    fs.existsSync(new URL("../.projectanvil-maintenance.lock", import.meta.url))
  ) {
    throw new Error(
      "ProjectAnvil backup or restoration is in progress. Wait for it to finish before starting the app. If it was interrupted, read the local setup guide before removing the maintenance lock.",
    );
  }
}

assertNoMaintenance();
