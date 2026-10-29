import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { validateDisposableTarget } from "./test-runtime.mjs";
import {
  activeBytes,
  createApiClient,
  createSyntheticWorkspace,
  performanceProfiles,
} from "../tests/performance/fixtures.mjs";
import { measureBrowserProfile } from "../tests/performance/browser-metrics.mjs";
import { readBuildInfo } from "../tests/performance/build-info.mjs";

const round = (value) => Math.round(value * 100) / 100;
export function summarize(samples) {
  assert(samples.length, "A performance metric needs at least one sample.");
  const ordered = [...samples].sort((left, right) => left - right);
  return {
    samples: ordered.length,
    medianMs: round(ordered[Math.floor((ordered.length - 1) / 2)]),
    p95Ms: round(ordered[Math.ceil(ordered.length * 0.95) - 1]),
    minMs: round(ordered[0]),
    maxMs: round(ordered.at(-1)),
  };
}

async function measuredReads(
  client,
  session,
  workspaceId,
  conditional = false,
) {
  const warm = await client.request(session, "/api/state", { workspaceId });
  const samples = [];
  let bytes = 0;
  for (let index = 0; index < 8; index++) {
    const result = await client.request(session, "/api/state", {
      workspaceId,
      ...(conditional
        ? { headers: { "If-None-Match": warm.etag }, allowedStatuses: [304] }
        : {}),
    });
    assert.equal(result.status, conditional ? 304 : 200);
    samples.push(result.elapsedMs);
    bytes = result.bytes;
  }
  return { ...summarize(samples), responseBytes: bytes };
}

async function current(client, session, workspaceId) {
  return (await client.request(session, "/api/state", { workspaceId })).data
    .workspace;
}

/** A stable workspace should hold one request, rather than repeatedly download records. */
async function liveUpdates(client, session, workspaceId) {
  const first = await client.request(session, "/api/live?wait=0", {
    workspaceId,
  });
  const idle = await client.request(
    session,
    `/api/live?since=${encodeURIComponent(first.data.cursor)}`,
    { workspaceId },
  );
  assert.equal(idle.data.cursor, first.data.cursor);
  assert(
    idle.elapsedMs >= 17_000 && idle.elapsedMs < 30_000,
    "Unchanged live markers should hold for the normal long-poll window",
  );
  const snapshot = await current(client, session, workspaceId);
  const task = snapshot.tasks[0];
  const waiting = client.request(
    session,
    `/api/live?since=${encodeURIComponent(idle.data.cursor)}`,
    { workspaceId },
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  const write = await client.request(session, "/api/state", {
    workspaceId,
    body: {
      action: "upsert",
      entity: "tasks",
      item: { id: task.id, title: `${task.title} · live check` },
      base: task,
      operationId: randomUUID(),
    },
  });
  const changed = await waiting;
  assert.equal(changed.data.revision, write.data.workspace.revision);
  assert.notEqual(changed.data.cursor, first.data.cursor);
  assert(
    changed.elapsedMs < 5_000,
    "Live updates should notice an acknowledged write within five seconds locally",
  );
  return {
    idleRequests: 1,
    idleHoldMs: round(idle.elapsedMs),
    idleBytes: idle.bytes,
    changeObservedMs: round(changed.elapsedMs),
    changedBytes: changed.bytes,
    containsWorkspaceRecords: Object.hasOwn(changed.data, "workspace"),
  };
}

async function importProfile(client, session, workspaceId, profile, namespace) {
  const before = await current(client, session, workspaceId);
  const workspace = createSyntheticWorkspace(
    profile,
    namespace,
    before.revision,
  );
  const result = await client.request(session, "/api/state", {
    workspaceId,
    body: { action: "import", workspace, operationId: randomUUID() },
  });
  assert.equal(result.data.workspace.tasks.length, profile.tasks);
  assert.equal(result.data.workspace.notes.length, profile.notes);
  assert.equal(result.data.workspace.projects.length, profile.projects);
  return {
    workspace: result.data.workspace,
    importMs: round(result.elapsedMs),
    responseBytes: result.bytes,
    activeBytes: activeBytes(result.data.workspace),
  };
}

async function distinctTaskWrites(client, owner, editor, workspaceId, hidden) {
  const groups = [];
  for (const concurrency of [2, 5, 10]) {
    const snapshot = await current(client, owner, workspaceId);
    const candidates = snapshot.tasks
      .filter((task) => !hidden.has(task.projectId))
      .slice(0, concurrency);
    assert.equal(candidates.length, concurrency);
    const intended = candidates.map((task, index) => ({
      task,
      title: `${task.title.split(" · load ")[0]} · load ${concurrency}-${index}`,
    }));
    const started = performance.now();
    const results = await Promise.all(
      intended.map(({ task, title }, index) =>
        client.request(index % 2 ? editor : owner, "/api/state", {
          workspaceId,
          allowedStatuses: [409],
          body: {
            action: "upsert",
            entity: "tasks",
            item: { id: task.id, title },
            base: task,
            operationId: randomUUID(),
          },
        }),
      ),
    );
    const elapsed = performance.now() - started;
    const confirmed = await current(client, owner, workspaceId);
    results.forEach((result, index) => {
      if (result.status === 200)
        assert.equal(
          confirmed.tasks.find((task) => task.id === intended[index].task.id)
            ?.title,
          intended[index].title,
          "A successful concurrent save must survive subsequent commits.",
        );
      else
        assert.equal(
          result.status,
          409,
          "Contention must fail explicitly without a server error.",
        );
    });
    groups.push({
      concurrency,
      ...summarize(results.map((result) => result.elapsedMs)),
      wallMs: round(elapsed),
      succeeded: results.filter((result) => result.status === 200).length,
      conflicts: results.filter((result) => result.status === 409).length,
    });
  }
  return groups;
}

async function conflictAndRetry(client, owner, editor, workspaceId, hidden) {
  const before = await current(client, owner, workspaceId);
  const task = before.tasks.find((item) => !hidden.has(item.projectId));
  const firstId = randomUUID(),
    secondId = randomUUID();
  const first = {
    action: "upsert",
    entity: "tasks",
    item: { id: task.id, title: "Concurrent review A" },
    base: task,
    operationId: firstId,
  };
  const second = {
    action: "upsert",
    entity: "tasks",
    item: { id: task.id, title: "Concurrent review B" },
    base: task,
    operationId: secondId,
  };
  const result = await Promise.all(
    [owner, editor].map((session, index) =>
      client.request(session, "/api/state", {
        workspaceId,
        body: index ? second : first,
        allowedStatuses: [409],
      }),
    ),
  );
  assert.deepEqual(
    result.map((item) => item.status).sort(),
    [200, 409],
    "A conflicting same-field race must retain one winner and reject the stale replacement.",
  );
  const winner = result[0].status === 200 ? 0 : 1;
  const replay = await client.request(winner ? editor : owner, "/api/state", {
    workspaceId,
    body: winner ? second : first,
  });
  assert.equal(
    replay.status,
    200,
    "An acknowledged receipt must be retry-safe.",
  );
  const after = await current(client, owner, workspaceId);
  assert.equal(
    after.revision,
    before.revision + 1,
    "A replay must not create a second revision.",
  );
  assert.equal(
    after.tasks.find((item) => item.id === task.id)?.title,
    winner ? second.item.title : first.item.title,
  );
  return {
    sameField: result.map((item) => ({
      status: item.status,
      elapsedMs: round(item.elapsedMs),
    })),
    retryMs: round(replay.elapsedMs),
    duplicateRevision: false,
  };
}

async function independentAccountWrites(client, accounts) {
  const inputs = await Promise.all(
    accounts.map(async (session) => {
      const snapshot = await current(client, session, session.personalId);
      const task = snapshot.tasks[0];
      return {
        session,
        task,
        body: {
          action: "upsert",
          entity: "tasks",
          item: { id: task.id, title: `${task.title} · personal update` },
          base: task,
          operationId: randomUUID(),
        },
      };
    }),
  );
  const result = await Promise.all(
    inputs.map((input) =>
      client.request(input.session, "/api/state", {
        workspaceId: input.session.personalId,
        body: input.body,
      }),
    ),
  );
  const saved = await Promise.all(
    accounts.map((session) => current(client, session, session.personalId)),
  );
  inputs.forEach((input, index) => {
    assert.equal(saved[index].tasks[0].title, input.body.item.title);
    assert(
      !saved[1 - index].tasks.some((task) => task.id === input.task.id),
      "Personal account records must remain separate under parallel writes.",
    );
  });
  return summarize(result.map((item) => item.elapsedMs));
}

async function quotaBoundary(client, owner, workspaceId) {
  const before = await current(client, owner, workspaceId);
  const oversized = structuredClone(before);
  oversized.notes.forEach((note) => {
    note.snapshots = [];
    note.content += "quota ".repeat(160);
  });
  assert(
    activeBytes(oversized) > 1_500_000 && activeBytes(oversized) < 2_000_000,
  );
  const response = await client.request(owner, "/api/state", {
    workspaceId,
    body: { action: "import", workspace: oversized, operationId: randomUUID() },
    allowedStatuses: [400, 413],
  });
  assert(
    [400, 413].includes(response.status),
    "Oversized imports must be rejected.",
  );
  const after = await current(client, owner, workspaceId);
  assert.deepEqual(
    after,
    before,
    "Rejected capacity changes must not alter confirmed records.",
  );
  return {
    rejectedStatus: response.status,
    elapsedMs: round(response.elapsedMs),
    unchanged: true,
  };
}

/** Always needs the root runner's verified disposable installation manifest. */
export async function runPerformanceBenchmark({
  baseURL,
  manifestPath,
  outputPath,
  mode = "baseline",
  browser = true,
  onProgress = (message) => console.log(message),
}) {
  await validateDisposableTarget(baseURL, manifestPath);
  const client = createApiClient(baseURL);
  const suffix = randomBytes(5).toString("hex");
  const owner = await client.register("owner", suffix);
  const editor = await client.register("editor", suffix);
  for (const session of [owner, editor]) {
    const account = (await client.request(session, "/api/account")).data;
    session.personalId = (account.account || account).workspaces.find(
      (item) => item.kind === "personal",
    ).id;
  }
  const teamResponse = await client.request(owner, "/api/teams", {
    body: { action: "create", name: `Synthetic performance team ${suffix}` },
  });
  const teamAccount = teamResponse.data.account || teamResponse.data;
  const teamId = teamAccount.workspaces.find(
    (item) => item.kind === "team" && item.name.endsWith(suffix),
  ).id;
  await client.request(owner, "/api/teams", {
    body: {
      action: "invite",
      workspaceId: teamId,
      username: editor.username,
      role: "editor",
    },
  });
  const editorAccount = (await client.request(editor, "/api/account")).data;
  const invitation = (editorAccount.account || editorAccount).invitations.find(
    (item) => item.workspaceId === teamId,
  );
  assert(
    invitation,
    "Synthetic collaboration requires a real accepted invitation.",
  );
  await client.request(editor, "/api/teams", {
    body: { action: "accept", invitationId: invitation.id },
  });

  const report = {
    schemaVersion: 1,
    mode,
    build: await readBuildInfo(),
    generatedAt: new Date().toISOString(),
    environment: {
      server: "isolated local production build",
      timing:
        "end-to-end local HTTP; browser interaction-to-render includes automation overhead",
      samplesPerRead: 8,
      syntheticAccounts: 2,
    },
    profiles: [],
  };
  for (const profile of performanceProfiles) {
    onProgress(
      `Measuring ${profile.name}: ${profile.projects} projects, ${profile.tasks} tasks, ${profile.notes} notes in each of three workspaces.`,
    );
    const personal = [];
    for (const [session, namespace] of [
      [owner, "alpha"],
      [editor, "beta"],
    ])
      personal.push(
        await importProfile(
          client,
          session,
          session.personalId,
          profile,
          namespace,
        ),
      );
    const team = await importProfile(client, owner, teamId, profile, "team");
    const hidden = new Set(
      team.workspace.projects
        .filter((_, index) => index % 10 === 0)
        .map((project) => project.id),
    );
    for (const projectId of hidden) {
      const details = (
        await client.request(owner, `/api/teams?workspaceId=${teamId}`)
      ).data;
      await client.request(owner, "/api/teams", {
        body: {
          action: "project-access",
          workspaceId: teamId,
          projectId,
          restricted: true,
          members: [],
          expectedRevision: details.securityRevision,
        },
      });
    }
    const visible = await current(client, editor, teamId);
    assert.equal(visible.projects.length, profile.projects - hidden.size);
    assert(visible.tasks.every((task) => !hidden.has(task.projectId)));
    assert(visible.notes.every((note) => !hidden.has(note.projectId)));
    const entry = {
      name: profile.name,
      counts: {
        projects: profile.projects,
        tasks: profile.tasks,
        notes: profile.notes,
        canvases: profile.canvases,
        relationships: profile.relationships,
        hiddenProjects: hidden.size,
      },
      import: {
        personal: personal.map((item) => ({
          elapsedMs: item.importMs,
          activeBytes: item.activeBytes,
          responseBytes: item.responseBytes,
        })),
        team: {
          elapsedMs: team.importMs,
          activeBytes: team.activeBytes,
          responseBytes: team.responseBytes,
        },
      },
      reads: {
        owner: await measuredReads(client, owner, teamId),
        editor: await measuredReads(client, editor, teamId),
        conditionalOwner: await measuredReads(client, owner, teamId, true),
        conditionalEditor: await measuredReads(client, editor, teamId, true),
      },
      concurrentDistinctTasks: await distinctTaskWrites(
        client,
        owner,
        editor,
        teamId,
        hidden,
      ),
      conflict: await conflictAndRetry(client, owner, editor, teamId, hidden),
      independentAccountWrites: await independentAccountWrites(client, [
        owner,
        editor,
      ]),
    };
    if (browser)
      entry.browser = await measureBrowserProfile({
        baseURL,
        sessions: [owner, editor],
        profile,
        outputDirectory: path.dirname(outputPath),
      });
    report.profiles.push(entry);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n");
  }
  report.quotaBoundary = await quotaBoundary(client, owner, teamId);
  report.liveUpdates = await liveUpdates(client, owner, teamId);
  report.correctness = {
    personalIsolation: true,
    acceptedTeamAccess: true,
    restrictedProjectFiltering: true,
    concurrentAcknowledgementsRetained: true,
    sameFieldConflictRejected: true,
    idempotentRetry: true,
    quotaRollback: true,
  };
  assert.deepEqual(
    await readBuildInfo(),
    report.build,
    "The built app changed during measurement. Rerun without a concurrent build.",
  );
  report.completed = true;
  await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n");
  return report;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const baseURL = process.env.PROJECTANVIL_TEST_BASE_URL;
  const manifestPath = process.env.PROJECTANVIL_TEST_MANIFEST;
  if (
    process.env.PROJECTANVIL_TEST_DISPOSABLE !== "1" ||
    !baseURL ||
    !manifestPath
  )
    throw new Error(
      "Use the isolated performance-test runner; an explicit disposable installation is required.",
    );
  const outputPath =
    process.env.PROJECTANVIL_PERFORMANCE_OUTPUT ||
    path.join(path.dirname(manifestPath), "performance.json");
  await runPerformanceBenchmark({
    baseURL,
    manifestPath,
    outputPath,
    mode: process.env.PROJECTANVIL_PERFORMANCE_MODE || "baseline",
    browser: !process.argv.includes("--api-only"),
  });
  console.log("Performance report saved inside the disposable test run.");
}
