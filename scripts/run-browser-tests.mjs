import path from "node:path";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
import {
  ensureTestBuild,
  startDisposableServer,
  disposableEnvironment,
  projectRoot,
  runNode,
  installTestCancellationHandlers,
} from "./test-runtime.mjs";

const maximumLogBytes = 64 * 1024;

/** Diagnostic artifacts contain only a bounded, sanitized tail of this run. */
export function sanitizeBrowserServerLog(log, secrets = []) {
  const sanitized = stripVTControlCharacters(log)
    .split(/\r?\n/)
    .slice(-500)
    .map((original) => {
      let line = original;
      for (const secret of secrets)
        if (secret) line = line.split(secret).join("[redacted]");
      // Omit sensitive context instead of guessing the format of a credential.
      if (
        /password|secret|token|cookie|authorization|outbox|verification|recovery|reset-password|verify-email/i.test(
          line,
        )
      )
        return "[Sensitive log line omitted]";
      return line
        .replace(/https?:\/\/[^\s<>"']+/g, (value) => {
          try {
            const url = new URL(value);
            return `${url.origin}${url.pathname}`;
          } catch {
            return "[URL omitted]";
          }
        })
        .replace(/([/?][^\s?]*?)\?[^\s]*/g, "$1?[query omitted]")
        .replace(/[A-Za-z0-9_-]{24,}/g, "[long identifier omitted]");
    })
    .join("\n");
  const bytes = Buffer.from(sanitized);
  let offset = Math.max(0, bytes.length - maximumLogBytes);
  // Preserve a UTF-8 boundary so replacement characters cannot exceed the cap.
  while (offset < bytes.length && (bytes[offset] & 0xc0) === 0x80) offset++;
  return bytes.subarray(offset).toString("utf8");
}

export async function captureBrowserFailureLog(
  server,
  engine,
  {
    reportDirectory = path.join(projectRoot, "outputs", "browser", engine),
  } = {},
) {
  if (!["chromium", "firefox", "webkit"].includes(engine))
    throw new Error("Unknown browser diagnostic target.");
  const runRoot = await fs.realpath(path.join(projectRoot, "work", "qa"));
  const directory = await fs.realpath(server.directory);
  if (path.dirname(directory) !== runRoot)
    throw new Error("Diagnostics require an owned disposable test directory.");
  for (const name of [".projectanvil-test-run.json", ".dev.vars"]) {
    const stat = await fs.lstat(path.join(directory, name));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192)
      throw new Error("Diagnostics require the run's ordinary private files.");
  }
  const marker = JSON.parse(
    await fs.readFile(
      path.join(directory, ".projectanvil-test-run.json"),
      "utf8",
    ),
  );
  if (
    marker.format !== 1 ||
    marker.kind !== "disposable-local-test" ||
    marker.baseURL !== server.baseURL ||
    marker.stateDirectory !== path.join(directory, "state") ||
    !/^[a-f0-9-]{36}$/.test(marker.runId)
  )
    throw new Error("The diagnostic marker does not match this test run.");
  const logPath = path.join(directory, "server.log");
  const stat = await fs.lstat(logPath);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(
      "Diagnostics require the disposable server's ordinary log.",
    );
  const handle = await fs.open(logPath, "r");
  let log;
  try {
    const offset = Math.max(0, stat.size - maximumLogBytes);
    const buffer = Buffer.alloc(Math.min(stat.size, maximumLogBytes));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    log = buffer.subarray(0, bytesRead).toString("utf8");
    if (offset) log = log.slice(log.indexOf("\n") + 1);
  } finally {
    await handle.close();
  }
  const variables = await fs.readFile(
    path.join(directory, ".dev.vars"),
    "utf8",
  );
  const secrets = variables
    .split(/\r?\n/)
    .filter((line) => line.includes("="))
    .map((line) => line.slice(line.indexOf("=") + 1).trim());
  const outputRoot = path.join(projectRoot, "outputs");
  const relative = path.relative(outputRoot, path.resolve(reportDirectory));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Browser diagnostics must stay inside outputs.");
  await fs.mkdir(reportDirectory, { recursive: true });
  const actualRoot = await fs.realpath(outputRoot);
  const actualDirectory = await fs.realpath(reportDirectory);
  const actualRelative = path.relative(actualRoot, actualDirectory);
  if (
    !actualRelative ||
    actualRelative.startsWith("..") ||
    path.isAbsolute(actualRelative)
  )
    throw new Error(
      "Browser diagnostics cannot follow a redirected directory.",
    );
  const output = path.join(actualDirectory, "server.log");
  const previous = await fs.lstat(output).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
  if (previous && (!previous.isFile() || previous.isSymbolicLink()))
    throw new Error("Browser diagnostics cannot replace a redirected log.");
  await fs.writeFile(
    output,
    sanitizeBrowserServerLog(log, [...secrets, marker.runId]),
    { mode: 0o600 },
  );
}

async function runBrowserTests() {
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
      let failed = true;
      try {
        console.log(
          `Running ${engine} checks against a fresh disposable local installation.`,
        );
        const status = await runNode(
          path.join(
            projectRoot,
            "node_modules",
            "@playwright",
            "test",
            "cli.js",
          ),
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
        failed = status !== 0;
        if (status !== 0) process.exitCode = status;
      } finally {
        if (failed && !cancellation.signal.aborted) {
          try {
            await captureBrowserFailureLog(server, engine);
          } catch {
            console.warn(
              "Could not capture the disposable server diagnostic log.",
            );
          }
        }
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
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  await runBrowserTests();
