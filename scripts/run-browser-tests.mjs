import path from "node:path";
import {
  ensureTestBuild,
  startDisposableServer,
  disposableEnvironment,
  projectRoot,
  runNode,
  installTestCancellationHandlers,
} from "./test-runtime.mjs";

const cancellation = installTestCancellationHandlers();
let server;
try {
  await ensureTestBuild({ signal: cancellation.signal });
  server = await startDisposableServer({
    kind: "browser",
    signal: cancellation.signal,
  });
  console.log(
    "Running browser checks against a fresh disposable local installation.",
  );
  process.exitCode = await runNode(
    path.join(projectRoot, "node_modules", "@playwright", "test", "cli.js"),
    ["test", ...process.argv.slice(2)],
    {
      cwd: projectRoot,
      env: disposableEnvironment(server),
      signal: cancellation.signal,
    },
  );
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
