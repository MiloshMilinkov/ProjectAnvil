import path from "node:path";
import fs from "node:fs/promises";
import {
  ensureTestBuild,
  startDisposableServer,
  projectRoot,
  disposableEnvironment,
  installTestCancellationHandlers,
  runNode,
} from "./test-runtime.mjs";

const args = process.argv.slice(2);
const options = { mode: "baseline", study: "workspace" };
const seen = new Set();
for (let index = 0; index < args.length; index += 2) {
  const key = args[index]?.replace(/^--/, "");
  if (seen.has(key) || !["mode", "study"].includes(key) || !args[index + 1])
    throw new Error(
      "Use --mode baseline|optimized and optionally --study workspace|typing.",
    );
  options[key] = args[index + 1];
  seen.add(key);
}
const { mode, study } = options;
if (
  !["baseline", "optimized"].includes(mode) ||
  !["workspace", "typing"].includes(study)
)
  throw new Error(
    "Use --mode baseline|optimized and optionally --study workspace|typing.",
  );
const cancellation = installTestCancellationHandlers();
let server;
try {
  await ensureTestBuild({ signal: cancellation.signal });
  server = await startDisposableServer({
    kind: "performance",
    signal: cancellation.signal,
  });
  const outputPath = path.join(
    projectRoot,
    "outputs",
    "performance",
    `${study === "typing" ? "note-edit-" : ""}${mode}.json`,
  );
  const status = await runNode(
    study === "typing"
      ? path.join(projectRoot, "tests", "performance", "note-edit-metrics.mjs")
      : path.join(projectRoot, "scripts", "measure-performance.mjs"),
    [],
    {
      cwd: projectRoot,
      signal: cancellation.signal,
      env: {
        ...disposableEnvironment(server),
        PROJECTANVIL_PERFORMANCE_OUTPUT: outputPath,
        PROJECTANVIL_PERFORMANCE_MODE: mode,
      },
    },
  );
  if (status !== 0) {
    process.exitCode = status;
  } else {
    const report = JSON.parse(await fs.readFile(outputPath, "utf8"));
    if (study === "workspace")
      console.table(
        report.profiles.map((profile) => ({
          profile: profile.name,
          tasksPerWorkspace: profile.counts.tasks,
          ownerReadMedianMs: profile.reads.owner.medianMs,
          tenConcurrentSavesP95Ms: profile.concurrentDistinctTasks.find(
            (group) => group.concurrency === 10,
          )?.p95Ms,
          taskViewMs: profile.browser
            .map((account) => Math.round(account.taskOpenMs))
            .join(" / "),
          searchMs: profile.browser
            .map((account) => Math.round(account.globalSearchMs))
            .join(" / "),
        })),
      );
    else
      console.table(
        report.accounts.flatMap((account) =>
          account.modes.map((phase) => ({
            account: account.account,
            mode: phase.mode,
            inputPaintMedianMs: phase.inputToPaint.medianMs,
            inputSaveMedianMs: phase.inputToSave.medianMs,
          })),
        ),
      );
    console.log(
      `Performance results saved to outputs/performance/${path.basename(outputPath)}`,
    );
  }
} catch (error) {
  if (!cancellation.signal.aborted) throw error;
  process.exitCode = 130;
} finally {
  try {
    await server?.stop();
  } finally {
    cancellation.dispose();
  }
}
