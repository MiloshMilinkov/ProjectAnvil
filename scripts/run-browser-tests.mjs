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
  const args = process.argv.slice(2);
  const selected = [];
  const forwarded = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--project" || argument.startsWith("--project=")) {
      const name =
        argument === "--project" ? args[++index] : argument.slice(10);
      if (!["chromium", "firefox", "webkit"].includes(name))
        throw new Error(
          "Choose a browser project: chromium, firefox, or webkit.",
        );
      if (!selected.includes(name)) selected.push(name);
    } else forwarded.push(argument);
  }
  await ensureTestBuild({ signal: cancellation.signal });
  // Separate databases and account rate limits keep engine runs independent.
  for (const engine of selected.length
    ? selected
    : ["chromium", "firefox", "webkit"]) {
    cancellation.signal.throwIfAborted();
    server = await startDisposableServer({
      kind: `browser-${engine}`,
      signal: cancellation.signal,
    });
    try {
      console.log(
        `Running ${engine} checks against a fresh disposable local installation.`,
      );
      const status = await runNode(
        path.join(projectRoot, "node_modules", "@playwright", "test", "cli.js"),
        ["test", `--project=${engine}`, ...forwarded],
        {
          cwd: projectRoot,
          env: {
            ...disposableEnvironment(server),
            PROJECTANVIL_TEST_BROWSER: engine,
          },
          signal: cancellation.signal,
        },
      );
      if (status !== 0) process.exitCode = status;
    } finally {
      await server.stop();
      server = undefined;
    }
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
