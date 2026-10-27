import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

export const performanceProfiles = [
  {
    name: "small",
    projects: 5,
    tasks: 100,
    notes: 25,
    relationships: 100,
    canvases: 3,
    canvasCards: 24,
    targetBytes: 180_000,
  },
  {
    name: "medium",
    projects: 20,
    tasks: 500,
    notes: 100,
    relationships: 400,
    canvases: 6,
    canvasCards: 80,
    targetBytes: 760_000,
  },
  {
    name: "large",
    projects: 40,
    tasks: 1000,
    notes: 200,
    relationships: 800,
    canvases: 10,
    canvasCards: 200,
    targetBytes: 1_330_000,
  },
];

const stamp = "2026-10-20T12:00:00.000Z";
const colors = ["#92b9ec", "#b19aff", "#e9ae85", "#91c9ae"];
const statuses = ["backlog", "todo", "in-progress", "review", "done"];
const priorities = ["medium", "high", "low", "urgent"];
const serial = (index) => String(index + 1).padStart(4, "0");
export const encodedBytes = (value) => Buffer.byteLength(JSON.stringify(value));
export const activeBytes = (workspace) =>
  encodedBytes({
    ...workspace,
    notes: workspace.notes.map((note) => ({ ...note, snapshots: [] })),
  });

/** Deterministic populated records; only account names and API receipts are random. */
export function createSyntheticWorkspace(
  profile,
  namespace = "team",
  revision = 0,
) {
  const id = (kind, index) => `${namespace}_${kind}_${serial(index)}`;
  const workspace = {
    name: `Synthetic ${profile.name} planning workspace`,
    revision,
    people: [
      {
        id: `${namespace}_person_1`,
        name: "Planning lead",
        role: "Planning",
        color: colors[0],
      },
      {
        id: `${namespace}_person_2`,
        name: "Research partner",
        role: "Research",
        color: colors[1],
      },
    ],
    projects: Array.from({ length: profile.projects }, (_, index) => ({
      id: id("project", index),
      name: `${namespace} Project ${serial(index)}`,
      key: `P${index + 1}`,
      description:
        "A synthetic project for repeatable local performance measurements.",
      color: colors[index % colors.length],
      status: index % 3 ? "Active" : "Planning",
      goal: "Keep decisions, evidence, and the next action connected.",
      targetDate: "2026-12-15",
      milestones: [0, 1].map((number) => ({
        id: `milestone_${number}`,
        title: number ? "Review" : "First draft",
        description: "Synthetic planning milestone",
        targetDate: number ? "2026-12-15" : "2026-11-15",
        archived: false,
      })),
    })),
    tasks: [],
    notes: [],
    media: [],
    canvases: [],
    savedViews: [],
    relationships: [],
    noteTypes: [],
    relationshipPresets: [],
    brainstorms: [],
  };
  workspace.notes = Array.from({ length: profile.notes }, (_, index) => ({
    id: id("note", index),
    title: `${namespace} Note ${serial(index)}`,
    content: `# ${namespace} Note ${serial(index)}\n\nEvidence and decisions for project ${(index % profile.projects) + 1}.\nReference: ${namespace}_reference_${serial(index)}\n\n- [ ] Review the next step\n\nSee [[${namespace} Note ${serial((index + 1) % profile.notes)}]] for context.\n`,
    folder: index % 2 ? "Research" : "Planning",
    tags: ["synthetic", index % 2 ? "research" : "planning"],
    projectId: id("project", index % profile.projects),
    kind: index % 5 ? "note" : "research",
    customTypeId: "",
    propertyValues: {},
    decision: null,
    bookmarked: index % 7 === 0,
    properties: { Stage: index % 2 ? "Draft" : "Reviewed" },
    snapshots: [],
    createdAt: stamp,
    updatedAt: stamp,
  }));
  workspace.tasks = Array.from({ length: profile.tasks }, (_, index) => {
    const projectIndex = index % profile.projects;
    return {
      id: id("task", index),
      key: `P${projectIndex + 1}-${Math.floor(index / profile.projects) + 1}`,
      title: `${namespace} Task ${serial(index)}`,
      description:
        "Review evidence, record the decision, and make the next action clear. This record is synthetic test data.",
      status: statuses[index % statuses.length],
      priority: priorities[index % priorities.length],
      type: "task",
      projectId: id("project", projectIndex),
      assigneeId: `${namespace}_person_${(index % 2) + 1}`,
      startDate: "2026-11-01",
      dueDate: `2026-11-${String((index % 20) + 2).padStart(2, "0")}`,
      estimate: (index % 8) + 1,
      tags: ["synthetic", index % 2 ? "review" : "planning"],
      noteIds: [id("note", index % profile.notes)],
      blockedBy: [],
      subtasks: [
        {
          id: `check_${index}`,
          title: "Verify the result",
          done: index % statuses.length === 4,
        },
      ],
      comments: [],
      createdAt: stamp,
      updatedAt: stamp,
      parentId: "",
      milestoneId: "milestone_0",
      recurrence: null,
      reminder: null,
    };
  });
  workspace.relationships = Array.from(
    { length: profile.relationships },
    (_, index) => ({
      id: id("relation", index),
      from: { type: "note", id: id("note", index % profile.notes) },
      to: { type: "task", id: id("task", index % profile.tasks) },
      kind: "supports",
      label: "Planning evidence",
      createdAt: stamp,
      reviewedAt: stamp,
      fromSignature: "",
      toSignature: "",
    }),
  );
  workspace.canvases = Array.from({ length: profile.canvases }, (_, index) => {
    const count = index === 0 ? profile.canvasCards : 8;
    const cards = Array.from({ length: count }, (_, cardIndex) => {
      const note = cardIndex % 2 === 0;
      return {
        id: `card_${cardIndex}`,
        type: note ? "note" : "task",
        entityId: id(
          note ? "note" : "task",
          cardIndex % (note ? profile.notes : profile.tasks),
        ),
        text: "",
        x: (cardIndex % 10) * 320,
        y: Math.floor(cardIndex / 10) * 240,
        width: 280,
        height: 200,
        color: colors[cardIndex % colors.length],
      };
    });
    return {
      id: id("canvas", index),
      title: `${namespace} Canvas ${serial(index)}`,
      projectId: id("project", index % profile.projects),
      cards,
      edges: cards
        .slice(1)
        .map((card, edgeIndex) => ({
          id: `edge_${edgeIndex}`,
          from: cards[edgeIndex].id,
          to: card.id,
          label: "Next step",
        })),
    };
  });
  const remaining = Math.max(0, profile.targetBytes - activeBytes(workspace));
  const filler =
    "Planning evidence and useful context remain readable and connected. ";
  workspace.notes.forEach((note, index) => {
    const length =
      Math.floor(remaining / profile.notes) +
      (index < remaining % profile.notes ? 1 : 0);
    note.content += filler
      .repeat(Math.ceil(length / filler.length))
      .slice(0, length);
  });
  assert(
    activeBytes(workspace) < 1_420_000,
    "Synthetic records must leave room for server-owned metadata.",
  );
  assert(workspace.notes.every((note) => note.content.length < 100_000));
  return workspace;
}

export class BenchmarkHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Real authentication and scoped requests; credentials never enter benchmark output. */
export function createApiClient(baseURL) {
  const origin = new URL(baseURL).origin;
  async function request(session, pathname, options = {}) {
    if (!pathname.startsWith("/api/"))
      throw new Error("Benchmarks may request only the local app API.");
    const started = performance.now();
    const response = await fetch(new URL(pathname, origin), {
      method: options.method || (options.body === undefined ? "GET" : "POST"),
      headers: {
        Origin: origin,
        ...(session
          ? { Cookie: session.cookie, "X-Account-Id": session.user.id }
          : {}),
        ...(options.workspaceId
          ? { "X-Workspace-Id": options.workspaceId }
          : {}),
        ...(options.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
        ...options.headers,
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(60_000),
      redirect: "error",
    });
    const text = await response.text();
    const elapsedMs = performance.now() - started;
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(
          `Unexpected non-JSON response from ${pathname.split("?")[0]}.`,
        );
      }
    }
    if (
      !response.ok &&
      !(options.allowedStatuses || []).includes(response.status)
    ) {
      const reason =
        typeof data?.error === "string"
          ? data.error
          : data?.message || "Request rejected";
      throw new BenchmarkHttpError(
        response.status,
        `${pathname.split("?")[0]} returned ${response.status}: ${reason}`,
      );
    }
    return {
      status: response.status,
      data,
      elapsedMs,
      bytes: Buffer.byteLength(text),
      etag: response.headers.get("etag"),
      cookies: response.headers.getSetCookie(),
    };
  }
  async function register(label, suffix) {
    const username = `perf_${label}_${suffix}`.slice(0, 30);
    const password = `Local-test-${randomBytes(20).toString("base64url")}!`;
    const result = await request(null, "/api/auth/sign-up/email", {
      body: {
        name: username,
        username,
        email: `${username}@example.test`,
        password,
      },
    });
    assert(
      result.data?.user?.id && result.cookies.length,
      "Synthetic registration must establish a real session.",
    );
    return {
      user: result.data.user,
      username,
      cookie: result.cookies.map((value) => value.split(";")[0]).join("; "),
      cookies: result.cookies,
    };
  }
  return { request, register };
}
