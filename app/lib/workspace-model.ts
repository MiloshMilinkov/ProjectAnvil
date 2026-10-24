import { z } from "zod";
import {
  taskDateFilters,
  taskSorts,
  taskLayouts,
  type Entity,
  type Mutation,
  type Workspace,
  type BrainstormBoard,
} from "./types";
import { createSignatureReader, entityKey } from "./relationships";
import { normalizeSourceExcerpt } from "./source-excerpts";
import { planningError } from "./planning-model";
import {
  isCalendarDate,
  validTimeZone,
  wallTimeToInstant,
} from "./reminder-time";
import {
  addCalendarDays,
  calendarDayDifference,
  nextRecurrenceDate,
} from "./recurrence";
import {
  brainstormsSchema,
  connectedThinkingError,
  decisionSchema,
  emptyDecision,
  noteTypesSchema,
  relationshipPresetsSchema,
} from "./connected-thinking-model";

export class WorkspaceError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const id = z
  .string()
  .min(1)
  .max(120)
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    "Use letters, numbers, dashes, or underscores for IDs.",
  );
const reference = z.union([id, z.literal("")]);
const short = z.string().max(300);
const title = short.refine(
  (value) => value.trim().length > 0,
  "A name or title is required.",
);
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Choose a six-digit hex color.");
const date = z.union([
  z.literal(""),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
      const parsed = new Date(`${value}T00:00:00Z`);
      return (
        Number.isFinite(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value
      );
    }, "Choose a valid date."),
]);
const timestamp = z.string().datetime({ offset: true });
const content = z
  .string()
  .max(100_000, "Keep a single note or description under 100,000 characters.");
const tags = z.array(z.string().min(1).max(80)).max(40);
const references = z
  .array(id)
  .max(500)
  .refine(
    (values) => new Set(values).size === values.length,
    "Remove duplicate links.",
  );
const uniqueIds = <T extends { id: string }>(values: T[]) =>
  new Set(values.map((value) => value.id)).size === values.length;
const timeZone = z
  .string()
  .max(100)
  .refine(validTimeZone, "Choose a valid time zone.");
const recurrence = z
  .object({
    frequency: z.enum(["daily", "weekly", "monthly"]),
    interval: z.number().int().min(1).max(365),
    anchorDate: date.refine(
      isCalendarDate,
      "Choose the first occurrence date.",
    ),
    timeZone,
    untilDate: date
      .refine(
        (value) => !value || isCalendarDate(value),
        "Choose a valid recurrence end date.",
      )
      .default(""),
  })
  .strict()
  .refine(
    (rule) => !rule.untilDate || rule.untilDate >= rule.anchorDate,
    "The recurrence end must be on or after its first occurrence.",
  );
const reminder = z
  .object({
    date: date.refine(Boolean, "Choose a reminder date."),
    time: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Choose a valid reminder time."),
    timeZone,
  })
  .strict()
  .refine(
    (value) =>
      validTimeZone(value.timeZone) && wallTimeToInstant(value) !== null,
    "This reminder time does not exist because the clocks change. Choose another time.",
  );
const milestones = z
  .array(
    z
      .object({
        id,
        title,
        description: z.string().max(10_000).default(""),
        targetDate: date.default(""),
        archived: z.boolean().default(false),
      })
      .strict(),
  )
  .max(100)
  .refine(uniqueIds, "Milestone IDs must be unique.");
const people = z
  .object({
    id,
    name: title,
    role: short,
    color,
    userId: id.optional(),
    inactive: z.boolean().optional(),
  })
  .strict();
const projects = z
  .object({
    id,
    name: title,
    key: z
      .string()
      .min(1)
      .max(15)
      .regex(/^[A-Za-z0-9_-]+$/),
    description: z.string().max(10_000),
    color,
    status: short,
    goal: z.string().max(10_000),
    targetDate: date,
    milestones: milestones.default([]),
  })
  .strict();
const tasks = z
  .object({
    id,
    key: z.string().min(1).max(50),
    title,
    description: content,
    status: z.enum(["backlog", "todo", "in-progress", "review", "done"]),
    priority: z.enum(["urgent", "high", "medium", "low"]),
    type: z.enum(["task", "bug", "story", "epic"]),
    projectId: reference,
    assigneeId: reference,
    startDate: date.default(""),
    dueDate: date,
    parentId: reference.default(""),
    milestoneId: reference.default(""),
    recurrence: recurrence.nullable().default(null),
    reminder: reminder.nullable().default(null),
    recurrenceNextId: id.optional(),
    recurringFromId: id.optional(),
    estimate: z.number().finite().min(0).max(100_000),
    tags,
    noteIds: references,
    blockedBy: references,
    subtasks: z
      .array(z.object({ id, title, done: z.boolean() }).strict())
      .max(200)
      .refine(uniqueIds, "Subtask IDs must be unique."),
    comments: z
      .array(
        z
          .object({
            id,
            personId: reference,
            body: z.string().min(1).max(10_000),
            createdAt: timestamp,
          })
          .strict(),
      )
      .max(500)
      .refine(uniqueIds, "Comment IDs must be unique."),
    createdAt: timestamp,
    updatedAt: timestamp,
    source: z
      .object({ noteId: id, excerpt: z.string().trim().min(1).max(8000) })
      .strict()
      .optional(),
  })
  .strict();
const notes = z
  .object({
    id,
    title,
    content,
    folder: z.string().max(300),
    tags,
    projectId: reference,
    kind: z.enum([
      "note",
      "world",
      "character",
      "research",
      "daily",
      "meeting",
      "decision",
    ]),
    customTypeId: reference.default(""),
    propertyValues: z
      .record(id, z.string().max(2000))
      .refine(
        (values) => Object.keys(values).length <= 30,
        "Use at most 30 structured properties.",
      )
      .default({}),
    decision: decisionSchema.nullable().default(null),
    bookmarked: z.boolean(),
    properties: z
      .record(z.string().max(80), z.string().max(2000))
      .refine(
        (value) => Object.keys(value).length <= 50,
        "Use at most 50 properties.",
      ),
    snapshots: z
      .array(z.object({ id, content, savedAt: timestamp }).strict())
      .max(12),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();
const media = z
  .object({
    id,
    name: title,
    url: z
      .string()
      .max(500)
      .regex(
        /^\/api\/media\/[a-zA-Z0-9_-]+$/,
        "Media must use this workspace’s upload endpoint.",
      ),
    type: z.string().max(150),
    size: z
      .number()
      .int()
      .min(0)
      .max(20 * 1024 * 1024),
    createdAt: timestamp,
  })
  .strict();
const canvasCard = z
  .object({
    id,
    x: z.number().finite().min(-100_000).max(100_000),
    y: z.number().finite().min(-100_000).max(100_000),
    width: z.number().finite().min(80).max(4000),
    height: z.number().finite().min(60).max(4000),
    type: z.enum(["note", "task", "text", "media", "url"]),
    entityId: id.optional(),
    text: z.string().max(10_000),
    color,
  })
  .strict();
const canvases = z
  .object({
    id,
    title,
    projectId: reference.default(""),
    cards: z
      .array(canvasCard)
      .max(500)
      .refine(uniqueIds, "Canvas card IDs must be unique."),
    edges: z
      .array(
        z.object({ id, from: id, to: id, label: z.string().max(300) }).strict(),
      )
      .max(1500)
      .refine(uniqueIds, "Canvas connection IDs must be unique."),
  })
  .strict();
const savedViews = z
  .object({
    id,
    name: title,
    query: z.string().max(500),
    assignee: reference,
    priority: z.union([
      z.literal(""),
      z.enum(["urgent", "high", "medium", "low"]),
    ]),
    project: reference,
    status: z.union([
      z.literal(""),
      z.enum(["backlog", "todo", "in-progress", "review", "done"]),
    ]),
    dateFilter: z.enum(taskDateFilters).default("all"),
    sort: z.enum(taskSorts).default("priority"),
    layout: z.enum(taskLayouts).default("board"),
  })
  .strict();
const entityReference = z
  .object({ type: z.enum(["note", "task", "project"]), id })
  .strict();
const relationships = z
  .object({
    id,
    from: entityReference,
    to: entityReference,
    kind: z.enum(["depends-on", "supports", "contradicts", "decided-because"]),
    label: short,
    createdAt: timestamp,
    reviewedAt: timestamp,
    fromSignature: z.string().max(100),
    toSignature: z.string().max(100),
  })
  .strict();
const entitySchemas = {
  people,
  projects,
  tasks,
  notes,
  media,
  canvases,
  savedViews,
  relationships,
  noteTypes: noteTypesSchema,
  relationshipPresets: relationshipPresetsSchema,
  brainstorms: brainstormsSchema,
};
const workspaceSchema = z
  .object({
    name: title,
    revision: z.number().int().nonnegative(),
    people: z
      .array(people)
      .max(500)
      .refine(uniqueIds, "Person IDs must be unique."),
    projects: z
      .array(projects)
      .max(100)
      .refine(uniqueIds, "Project IDs must be unique."),
    tasks: z
      .array(tasks)
      .max(1500)
      .refine(uniqueIds, "Task IDs must be unique."),
    notes: z
      .array(notes)
      .max(1000)
      .refine(uniqueIds, "Note IDs must be unique."),
    media: z
      .array(media)
      .max(500)
      .refine(uniqueIds, "Media IDs must be unique."),
    canvases: z
      .array(canvases)
      .max(100)
      .refine(uniqueIds, "Canvas IDs must be unique."),
    savedViews: z
      .array(savedViews)
      .max(100)
      .refine(uniqueIds, "Saved view IDs must be unique."),
    relationships: z
      .array(relationships)
      .max(2000)
      .refine(uniqueIds, "Relationship IDs must be unique.")
      .default([]),
    noteTypes: z
      .array(noteTypesSchema)
      .max(100)
      .refine(uniqueIds, "Note type IDs must be unique.")
      .default([]),
    relationshipPresets: z
      .array(relationshipPresetsSchema)
      .max(100)
      .refine(uniqueIds, "Preset IDs must be unique.")
      .default([]),
    brainstorms: z
      .array(brainstormsSchema)
      .max(100)
      .refine(uniqueIds, "Brainstorm IDs must be unique.")
      .default([]),
  })
  .strict();
const mutationSchema = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("restore"), id, operationId: id.optional() })
    .strict(),
  z
    .object({
      action: z.literal("upsert"),
      entity: z.enum([
        "people",
        "projects",
        "tasks",
        "notes",
        "media",
        "canvases",
        "savedViews",
        "relationships",
        "noteTypes",
        "relationshipPresets",
        "brainstorms",
      ]),
      item: z.record(z.string(), z.unknown()),
      base: z.record(z.string(), z.unknown()).nullable(),
      operationId: id.optional(),
      restoreSnapshotId: id.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("delete"),
      entity: z.enum([
        "people",
        "projects",
        "tasks",
        "notes",
        "media",
        "canvases",
        "savedViews",
        "relationships",
        "noteTypes",
        "relationshipPresets",
        "brainstorms",
      ]),
      id,
      base: z.record(z.string(), z.unknown()),
      operationId: id.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("rename"),
      name: title,
      base: z.object({ name: title }).strict(),
      operationId: id.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("import"),
      workspace: workspaceSchema,
      operationId: id.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("vote-idea"),
      id,
      ideaId: id,
      vote: z.boolean(),
      operationId: id.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("review-relationship"),
      id,
      expectedFromSignature: z.string().max(100).optional(),
      expectedToSignature: z.string().max(100).optional(),
      operationId: id.optional(),
    })
    .strict(),
]);

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new WorkspaceError(
      `${issue.path.length ? `${issue.path.join(".")}: ` : ""}${issue.message}`,
    );
  }
  return result.data;
}

export function validateWorkspace(value: unknown): Workspace {
  const workspace = parse(workspaceSchema, value) as Workspace;
  const known = {
    people: new Set(workspace.people.map((item) => item.id)),
    projects: new Set(workspace.projects.map((item) => item.id)),
    tasks: new Set(workspace.tasks.map((item) => item.id)),
    notes: new Set(workspace.notes.map((item) => item.id)),
    media: new Set(workspace.media.map((item) => item.id)),
  };
  function check(
    value: string,
    collection: keyof typeof known,
    context: string,
  ) {
    if (value && !known[collection].has(value))
      throw new WorkspaceError(
        `${context} refers to a missing ${collection === "people" ? "person" : collection.slice(0, -1)}. Refresh and try again.`,
      );
  }
  const taskKeys = new Set<string>();
  for (const task of workspace.tasks) {
    if (task.startDate && task.dueDate && task.startDate > task.dueDate)
      throw new WorkspaceError(
        "The planned start date must be on or before the due date.",
      );
    if (taskKeys.has(task.key))
      throw new WorkspaceError(`Task key ${task.key} is already in use.`);
    taskKeys.add(task.key);
    check(task.projectId, "projects", task.title);
    check(task.assigneeId, "people", task.title);
    task.noteIds.forEach((value) => check(value, "notes", task.title));
    if (task.source) {
      check(task.source.noteId, "notes", task.title);
      if (!task.noteIds.includes(task.source.noteId))
        throw new WorkspaceError(
          "A task’s source note must also be included in its linked notes.",
        );
    }
    task.blockedBy.forEach((value) => {
      check(value, "tasks", task.title);
      if (value === task.id)
        throw new WorkspaceError("A task cannot block itself.");
    });
    task.comments.forEach((comment) =>
      check(comment.personId, "people", "Comment"),
    );
  }
  // Cyclic dependencies make the board impossible to complete.
  const tasksById = new Map(workspace.tasks.map((task) => [task.id, task]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(taskId: string) {
    if (visiting.has(taskId))
      throw new WorkspaceError(
        "This dependency creates a cycle. Remove one of the blocking links.",
      );
    if (visited.has(taskId)) return;
    visiting.add(taskId);
    tasksById.get(taskId)?.blockedBy.forEach(visit);
    visiting.delete(taskId);
    visited.add(taskId);
  }
  workspace.tasks.forEach((task) => visit(task.id));
  const invalidPlan = planningError(workspace);
  if (invalidPlan) throw new WorkspaceError(invalidPlan);
  const titles = new Set<string>();
  for (const note of workspace.notes) {
    if (note.kind === "decision" && !note.decision)
      note.decision = emptyDecision();
    const normalized = note.title.trim().toLowerCase();
    if (titles.has(normalized))
      throw new WorkspaceError(
        `A note named “${note.title}” already exists. Give notes unique titles so wiki links resolve reliably.`,
      );
    titles.add(normalized);
    check(note.projectId, "projects", note.title);
    if (note.decision) check(note.decision.ownerId, "people", "Decision owner");
  }
  const connectedError = connectedThinkingError(workspace);
  if (connectedError) throw new WorkspaceError(connectedError);
  for (const board of workspace.brainstorms || []) {
    check(board.projectId, "projects", board.title);
    for (const idea of board.ideas) {
      check(idea.noteId, "notes", idea.title);
      check(idea.taskId, "tasks", idea.title);
    }
  }
  const projectKeys = new Set<string>();
  for (const project of workspace.projects) {
    if (projectKeys.has(project.key.toUpperCase()))
      throw new WorkspaceError(`Project key ${project.key} is already in use.`);
    projectKeys.add(project.key.toUpperCase());
  }
  for (const file of workspace.media) {
    if (file.url !== `/api/media/${file.id}`)
      throw new WorkspaceError("Attachment URLs must match their file IDs.");
  }
  for (const canvas of workspace.canvases) {
    check(canvas.projectId || "", "projects", canvas.title);
    const cards = new Set(canvas.cards.map((card) => card.id));
    for (const card of canvas.cards) {
      if (
        card.type === "note" ||
        card.type === "task" ||
        card.type === "media"
      ) {
        if (!card.entityId)
          throw new WorkspaceError(
            "Choose an item for each linked canvas card.",
          );
        check(
          card.entityId,
          card.type === "media"
            ? "media"
            : card.type === "note"
              ? "notes"
              : "tasks",
          canvas.title,
        );
      }
      if (card.type === "url") {
        try {
          const url = new URL(card.text);
          if (!["http:", "https:"].includes(url.protocol)) throw new Error();
        } catch {
          throw new WorkspaceError(
            "Web cards need a complete http:// or https:// address.",
          );
        }
      }
    }
    for (const edge of canvas.edges)
      if (!cards.has(edge.from) || !cards.has(edge.to))
        throw new WorkspaceError(
          "A canvas connection refers to a missing card.",
        );
  }
  for (const view of workspace.savedViews) {
    check(view.assignee, "people", view.name);
    check(view.project, "projects", view.name);
  }
  const connectionKeys = new Set<string>();
  for (const relationship of workspace.relationships) {
    for (const endpoint of [relationship.from, relationship.to]) {
      check(
        endpoint.id,
        endpoint.type === "note"
          ? "notes"
          : endpoint.type === "task"
            ? "tasks"
            : "projects",
        "Relationship",
      );
    }
    const from = entityKey(relationship.from);
    const to = entityKey(relationship.to);
    if (from === to) throw new WorkspaceError("Connect two different items.");
    const endpoints =
      relationship.kind === "contradicts" ? [from, to].sort() : [from, to];
    const key = `${relationship.kind}:${endpoints.join(">")}`;
    if (connectionKeys.has(key))
      throw new WorkspaceError("That relationship already exists.");
    connectionKeys.add(key);
  }
  const activeRecords = {
    ...workspace,
    notes: workspace.notes.map((note) => ({ ...note, snapshots: [] })),
  };
  if (
    new TextEncoder().encode(JSON.stringify(activeRecords)).byteLength >
    1_500_000
  ) {
    throw new WorkspaceError(
      "This workspace has reached its 1.5 MB active text limit. Export a backup and move or remove unused records. Note history and media files are stored separately.",
    );
  }
  return workspace;
}

function comparable(value: unknown): string {
  function ordered(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(ordered);
    if (input && typeof input === "object")
      return Object.fromEntries(
        Object.entries(input)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, child]) => [key, ordered(child)]),
      );
    return input;
  }
  return JSON.stringify(ordered(value));
}

function serverOwnedField(entity: Entity, key: string): boolean {
  return (
    key === "createdAt" ||
    key === "updatedAt" ||
    (entity === "notes" && key === "snapshots") ||
    (entity === "tasks" &&
      ["recurrenceNextId", "recurringFromId"].includes(key)) ||
    (entity === "relationships" &&
      ["reviewedAt", "fromSignature", "toSignature"].includes(key))
  );
}

/** Old open tabs may hold baselines saved before optional scheduling existed. */
function comparableField(entity: Entity, key: string, value: unknown): string {
  if (value === undefined) {
    if (entity === "tasks" && key === "startDate") value = "";
    if (entity === "tasks" && ["parentId", "milestoneId"].includes(key))
      value = "";
    if (entity === "tasks" && ["recurrence", "reminder"].includes(key))
      value = null;
    if (entity === "projects" && key === "milestones") value = [];
    if (entity === "canvases" && key === "projectId") value = "";
    if (entity === "notes" && key === "customTypeId") value = "";
    if (entity === "notes" && key === "propertyValues") value = {};
    if (entity === "notes" && key === "decision") value = null;
    if (entity === "savedViews" && key === "dateFilter") value = "all";
    if (entity === "savedViews" && key === "sort") value = "priority";
    if (entity === "savedViews" && key === "layout") value = "board";
  }
  if (entity === "brainstorms" && key === "ideas" && Array.isArray(value))
    value = value.map((idea) => {
      if (!idea || typeof idea !== "object") return idea;
      return { ...idea, votes: [] };
    });
  return comparable(value);
}

function assertMutationBase(current: Workspace, mutation: Mutation): void {
  if (mutation.action === "rename") {
    if (
      current.name !== mutation.base?.name &&
      current.name !== mutation.name?.trim()
    )
      throw new WorkspaceError(
        "The workspace name changed in another tab. Review the latest name before renaming it.",
        409,
      );
    return;
  }
  if (mutation.action !== "upsert" && mutation.action !== "delete") return;
  const entity = mutation.entity!;
  const item = mutation.item as Record<string, unknown>;
  const itemId = mutation.action === "upsert" ? item.id : mutation.id;
  const existing = (
    current[entity] as unknown as Record<string, unknown>[]
  ).find((item) => item.id === itemId);
  if (mutation.base === null) {
    if (existing)
      throw new WorkspaceError(
        "This item already exists. Refresh before trying to create it again.",
        409,
      );
    return;
  }
  if (!existing)
    throw new WorkspaceError(
      "This item was removed while you were editing. Your draft was not saved over the deletion.",
      409,
    );
  const base = mutation.base;
  if (!base || base.id !== itemId)
    throw new WorkspaceError(
      "Refresh this item before saving. Its original version is missing.",
      409,
    );
  const keys =
    mutation.action === "delete" ? Object.keys(existing) : Object.keys(item);
  for (const key of keys) {
    if (
      key === "id" ||
      serverOwnedField(entity, key) ||
      (mutation.action === "upsert" && entity === "tasks" && key === "comments")
    )
      continue;
    const unchanged =
      comparableField(entity, key, existing[key]) ===
      comparableField(entity, key, base[key]);
    const alreadyApplied =
      mutation.action === "upsert" &&
      comparableField(entity, key, existing[key]) ===
        comparableField(entity, key, item[key]);
    if (!unchanged && !alreadyApplied)
      throw new WorkspaceError(
        `This item’s ${key} changed in another tab. Review the latest version before saving your draft.`,
        409,
      );
  }
  if (
    entity === "tasks" &&
    mutation.action === "upsert" &&
    (Object.hasOwn(item, "startDate") || Object.hasOwn(item, "dueDate"))
  ) {
    const start = Object.hasOwn(item, "startDate")
      ? item.startDate
      : existing.startDate;
    const due = Object.hasOwn(item, "dueDate")
      ? item.dueDate
      : existing.dueDate;
    const scheduleChanged = ["startDate", "dueDate"].some(
      (key) =>
        comparableField(entity, key, existing[key]) !==
        comparableField(entity, key, base[key]),
    );
    if (
      scheduleChanged &&
      typeof start === "string" &&
      typeof due === "string" &&
      start &&
      due &&
      start > due
    )
      throw new WorkspaceError(
        "This task’s schedule changed in another tab. Review the latest planned start and due date before saving.",
        409,
      );
  }
}

function defaults(entity: Entity, now: string): Record<string, unknown> {
  const base = { id: crypto.randomUUID() };
  switch (entity) {
    case "people":
      return { ...base, role: "", color: "#8a78fa" };
    case "projects":
      return {
        ...base,
        description: "",
        color: "#8a78fa",
        status: "Planning",
        goal: "",
        targetDate: "",
        milestones: [],
      };
    case "tasks":
      return {
        ...base,
        description: "",
        status: "todo",
        priority: "medium",
        type: "task",
        projectId: "",
        assigneeId: "",
        startDate: "",
        dueDate: "",
        parentId: "",
        milestoneId: "",
        recurrence: null,
        reminder: null,
        estimate: 0,
        tags: [],
        noteIds: [],
        blockedBy: [],
        subtasks: [],
        comments: [],
        createdAt: now,
        updatedAt: now,
      };
    case "notes":
      return {
        ...base,
        content: "",
        folder: "",
        tags: [],
        projectId: "",
        kind: "note",
        customTypeId: "",
        propertyValues: {},
        decision: null,
        bookmarked: false,
        properties: {},
        snapshots: [],
        createdAt: now,
        updatedAt: now,
      };
    case "canvases":
      return { ...base, projectId: "", cards: [], edges: [] };
    case "savedViews":
      return {
        ...base,
        query: "",
        assignee: "",
        priority: "",
        project: "",
        status: "",
        dateFilter: "all",
        sort: "priority",
        layout: "board",
      };
    case "media":
      return base;
    case "relationships":
      return {
        ...base,
        label: "",
        createdAt: now,
        reviewedAt: now,
        fromSignature: "",
        toSignature: "",
      };
    case "noteTypes":
      return { ...base, description: "", archived: false, fields: [] };
    case "relationshipPresets":
      return {
        ...base,
        description: "",
        label: "",
        kind: "depends-on",
        fromType: "any",
        toType: "any",
        archived: false,
      };
    case "brainstorms":
      return {
        ...base,
        description: "",
        projectId: "",
        groups: [],
        ideas: [],
        votingOpen: true,
        createdAt: now,
        updatedAt: now,
      };
  }
}

export function validateMutation(input: unknown): Mutation {
  return parse(mutationSchema, input) as Mutation;
}

export function applyMutation(
  current: Workspace,
  input: unknown,
  now = new Date().toISOString(),
  actorId?: string,
): Workspace {
  const mutation = validateMutation(input);
  if (mutation.action === "restore")
    throw new WorkspaceError("Restore this item from its workspace Trash.");
  assertMutationBase(current, mutation);
  const next = structuredClone({
    ...current,
    relationships: current.relationships || [],
    noteTypes: current.noteTypes || [],
    relationshipPresets: current.relationshipPresets || [],
    brainstorms: current.brainstorms || [],
  });
  if (mutation.action === "rename") next.name = mutation.name!.trim();
  if (mutation.action === "import") {
    if (mutation.workspace!.revision !== current.revision)
      throw new WorkspaceError(
        "The workspace changed since this backup was opened. Refresh, export the current version, and retry the import with the latest revision.",
        409,
      );
    const imported = validateWorkspace({
      ...mutation.workspace!,
      revision: current.revision + 1,
    });
    // Backup text is portable, but it cannot cast votes on other members' behalf.
    for (const board of imported.brainstorms || []) {
      const previous = current.brainstorms?.find(
        (existing) => existing.id === board.id,
      );
      for (const idea of board.ideas)
        idea.votes = [
          ...(previous?.ideas.find((existing) => existing.id === idea.id)
            ?.votes || []),
        ];
    }
    // An import is an explicit replacement, so its relationships start reviewed
    // against the imported content rather than accepting supplied signatures.
    const readSignature = createSignatureReader(imported);
    imported.relationships = imported.relationships.map((relationship) => ({
      ...relationship,
      reviewedAt: now,
      fromSignature: readSignature(relationship.from),
      toSignature: readSignature(relationship.to),
    }));
    return imported;
  }
  if (mutation.action === "vote-idea") {
    if (!actorId)
      throw new WorkspaceError(
        "Voting requires a verified workspace identity.",
        403,
      );
    const board = next.brainstorms.find((board) => board.id === mutation.id);
    if (!board)
      throw new WorkspaceError(
        "This brainstorming board is no longer available.",
        404,
      );
    if (!board.votingOpen)
      throw new WorkspaceError("Voting is closed for this board.", 409);
    const idea = board.ideas.find((idea) => idea.id === mutation.ideaId);
    if (!idea)
      throw new WorkspaceError("This idea is no longer available.", 404);
    idea.votes = idea.votes.filter((id) => id !== actorId);
    if (mutation.vote) idea.votes.push(actorId);
    board.updatedAt = now;
  }
  if (mutation.action === "review-relationship") {
    const relationship = next.relationships.find(
      (item) => item.id === mutation.id,
    );
    if (!relationship)
      throw new WorkspaceError(
        "This relationship is no longer available.",
        404,
      );
    const readSignature = createSignatureReader(next);
    const fromSignature = readSignature(relationship.from);
    const toSignature = readSignature(relationship.to);
    if (
      (mutation.expectedFromSignature !== undefined &&
        mutation.expectedFromSignature !== fromSignature) ||
      (mutation.expectedToSignature !== undefined &&
        mutation.expectedToSignature !== toSignature)
    ) {
      throw new WorkspaceError(
        "This relationship changed after you opened it. Refresh and review the latest content before acknowledging it.",
        409,
      );
    }
    relationship.fromSignature = fromSignature;
    relationship.toSignature = toSignature;
    relationship.reviewedAt = now;
  }
  if (mutation.action === "upsert") {
    const entity = mutation.entity!;
    const item = mutation.item as Record<string, unknown>;
    const values = next[entity] as { id: string }[];
    const existing = values.find((value) => value.id === item.id);
    if (entity === "tasks") {
      const previous = existing as Workspace["tasks"][number] | undefined;
      for (const field of ["recurrenceNextId", "recurringFromId"] as const) {
        if (Object.hasOwn(item, field) && item[field] !== previous?.[field])
          throw new WorkspaceError(
            "Recurring task links are managed automatically.",
          );
      }
    }
    const merged: Record<string, unknown> = {
      ...defaults(entity, now),
      ...existing,
      ...item,
    };
    if (entity === "brainstorms") {
      const previous = existing as BrainstormBoard | undefined;
      if (Array.isArray(merged.ideas))
        merged.ideas = merged.ideas.map((idea) => {
          if (!idea || typeof idea !== "object") return idea;
          return {
            ...idea,
            votes: [
              ...(previous?.ideas.find((old) => old.id === idea.id)?.votes ||
                []),
            ],
          };
        });
      merged.createdAt = previous?.createdAt || now;
      merged.updatedAt = now;
    }
    if (entity === "notes") {
      const previous = existing as Workspace["notes"][number] | undefined;
      if (merged.kind === "decision" && !merged.decision)
        merged.decision = emptyDecision();
      const assignedType = next.noteTypes.find(
        (type) => type.id === merged.customTypeId,
      );
      if (
        assignedType?.archived &&
        merged.customTypeId !== previous?.customTypeId
      )
        throw new WorkspaceError(
          "This note type is archived. Restore it before assigning it to another note.",
        );
    }
    if (entity === "relationships") {
      const previous = existing as
        | Workspace["relationships"][number]
        | undefined;
      const from = parse(entityReference, merged.from);
      const to = parse(entityReference, merged.to);
      const changedEndpoints =
        !previous ||
        entityKey(previous.from) !== entityKey(from) ||
        entityKey(previous.to) !== entityKey(to) ||
        previous.kind !== merged.kind;
      const readSignature = createSignatureReader(next);
      merged.createdAt = previous?.createdAt || now;
      merged.reviewedAt = changedEndpoints ? now : previous.reviewedAt;
      merged.fromSignature = changedEndpoints
        ? readSignature(from)
        : previous.fromSignature;
      merged.toSignature = changedEndpoints
        ? readSignature(to)
        : previous.toSignature;
    }
    if (entity === "tasks" && merged.source) {
      const source = parse(tasks.shape.source.unwrap(), merged.source);
      merged.source = source;
      const linkedNotes = parse(references, merged.noteIds);
      merged.noteIds = [...new Set([...linkedNotes, source.noteId])];
      if (
        next.tasks.some(
          (task) =>
            task.id !== merged.id &&
            task.source?.noteId === source.noteId &&
            normalizeSourceExcerpt(task.source.excerpt) ===
              normalizeSourceExcerpt(source.excerpt),
        )
      ) {
        throw new WorkspaceError(
          "This note excerpt already has a linked task. Open the existing linked task instead.",
          409,
        );
      }
    }
    if (entity === "tasks" && !existing) {
      const requestedKey =
        typeof merged.key === "string" ? merged.key.trim() : "";
      if (
        !requestedKey ||
        next.tasks.some((task) => task.key === requestedKey)
      ) {
        const project = next.projects.find(
          (project) => project.id === merged.projectId,
        );
        const prefix = project?.key || "TASK";
        const suffixes = next.tasks
          .filter((task) => task.key.startsWith(`${prefix}-`))
          .map((task) => Number(task.key.slice(prefix.length + 1)))
          .filter(Number.isFinite);
        let number = Math.max(0, ...suffixes) + 1;
        while (next.tasks.some((task) => task.key === `${prefix}-${number}`))
          number++;
        merged.key = `${prefix}-${number}`;
      }
    }
    if (entity === "notes" || entity === "tasks") {
      merged.updatedAt = now;
      merged.createdAt = existing
        ? (existing as { id: string; createdAt: string }).createdAt
        : now;
      if (entity === "notes" && !existing) merged.snapshots = [];
    }
    if (entity === "notes" && existing) {
      const previous = existing as Workspace["notes"][number];
      // History belongs to the committed note, not an editor's stale local draft.
      merged.snapshots = previous.snapshots;
      if (merged.content !== previous.content) {
        const latest = previous.snapshots[previous.snapshots.length - 1];
        const restoring =
          !!mutation.restoreSnapshotId ||
          previous.snapshots.some(
            (snapshot) => snapshot.content === merged.content,
          );
        // Autosave can run on every pause. Keep useful intervals rather than 12 keystrokes.
        const elapsed = latest
          ? new Date(now).getTime() - new Date(latest.savedAt).getTime()
          : Infinity;
        if (!latest || restoring || elapsed < 0 || elapsed >= 30_000) {
          merged.snapshots = [
            ...previous.snapshots,
            {
              id: crypto.randomUUID(),
              content: previous.content,
              savedAt: now,
            },
          ].slice(-12);
        }
      }
    }
    const parsed = parse(
      entitySchemas[entity] as z.ZodType<{ id: string }>,
      merged,
    );
    if (entity === "projects" && existing) {
      const previous = existing as Workspace["projects"][number];
      const project = parsed as Workspace["projects"][number];
      if (
        previous.milestones?.some(
          (milestone) =>
            !project.milestones?.some(
              (candidate) => candidate.id === milestone.id,
            ),
        )
      )
        throw new WorkspaceError(
          "Archive a milestone instead of removing it so its plan remains recoverable.",
        );
    }
    if (existing) values[values.indexOf(existing)] = parsed;
    else values.push(parsed);
    if (entity === "tasks") {
      const task = parsed as Workspace["tasks"][number];
      const previous = existing as Workspace["tasks"][number] | undefined;
      if (
        task.milestoneId &&
        (task.milestoneId !== previous?.milestoneId ||
          task.projectId !== previous?.projectId) &&
        next.projects
          .find((project) => project.id === task.projectId)
          ?.milestones?.find((milestone) => milestone.id === task.milestoneId)
          ?.archived
      )
        throw new WorkspaceError(
          "Choose an active milestone. Archived milestones keep their existing tasks.",
        );
      if (
        previous?.status !== "done" &&
        task.status === "done" &&
        task.recurrence &&
        !task.recurrenceNextId
      ) {
        const occurrence =
          task.dueDate || task.startDate || task.recurrence.anchorDate;
        const following = nextRecurrenceDate(
          task.recurrence,
          occurrence,
          new Date(now),
        );
        if (following) {
          const offset = calendarDayDifference(following, occurrence);
          const nextTask = {
            ...structuredClone(task),
            id: crypto.randomUUID(),
            key: "",
            status: "todo" as const,
            startDate: task.startDate
              ? addCalendarDays(task.startDate, offset)
              : "",
            dueDate: task.dueDate
              ? addCalendarDays(task.dueDate, offset)
              : task.startDate
                ? ""
                : following,
            assigneeId: next.people.some(
              (person) => person.id === task.assigneeId && !person.inactive,
            )
              ? task.assigneeId
              : "",
            blockedBy: [],
            comments: [],
            subtasks: task.subtasks.map((subtask) => ({
              id: crypto.randomUUID(),
              title: subtask.title,
              done: false,
            })),
            reminder: task.reminder
              ? {
                  ...task.reminder,
                  date: addCalendarDays(task.reminder.date, offset),
                }
              : null,
            recurringFromId: task.id,
            createdAt: now,
            updatedAt: now,
          };
          delete nextTask.source;
          delete nextTask.recurrenceNextId;
          const prefix =
            next.projects.find((project) => project.id === task.projectId)
              ?.key || "TASK";
          const numbers = next.tasks
            .filter((value) => value.key.startsWith(`${prefix}-`))
            .map((value) => Number(value.key.slice(prefix.length + 1)))
            .filter(Number.isFinite);
          let number = Math.max(0, ...numbers) + 1;
          while (
            next.tasks.some((value) => value.key === `${prefix}-${number}`)
          )
            number++;
          nextTask.key = `${prefix}-${number}`;
          task.recurrenceNextId = nextTask.id;
          next.tasks.push(nextTask);
        }
      }
      if (task.source && task.source.noteId !== previous?.source?.noteId) {
        const from = { type: "task" as const, id: task.id };
        const to = { type: "note" as const, id: task.source.noteId };
        if (
          !next.relationships.some(
            (relationship) =>
              relationship.kind === "depends-on" &&
              entityKey(relationship.from) === entityKey(from) &&
              entityKey(relationship.to) === entityKey(to),
          )
        ) {
          const readSignature = createSignatureReader(next);
          next.relationships.push({
            id: crypto.randomUUID(),
            from,
            to,
            kind: "depends-on",
            label: "Created from note",
            createdAt: now,
            reviewedAt: now,
            fromSignature: readSignature(from),
            toSignature: readSignature(to),
          });
        }
      }
    }
  }
  if (mutation.action === "delete") {
    const entity = mutation.entity!;
    const deletedId = mutation.id!;
    const values = next[entity] as { id: string }[];
    if (!values.some((item) => item.id === deletedId))
      throw new WorkspaceError(
        "This item has already been removed. Refresh to see the latest workspace.",
        404,
      );
    if (
      entity === "projects" &&
      (next.tasks.some((item) => item.projectId === deletedId) ||
        next.notes.some((item) => item.projectId === deletedId) ||
        next.canvases.some((item) => item.projectId === deletedId) ||
        next.brainstorms.some((item) => item.projectId === deletedId))
    ) {
      throw new WorkspaceError(
        "Move or delete this project’s tasks, notes, canvases, and brainstorming boards before deleting the project.",
      );
    }
    if (
      entity === "noteTypes" &&
      next.notes.some((note) => note.customTypeId === deletedId)
    )
      throw new WorkspaceError(
        "This note type is still in use. Archive it or change its notes before deleting it.",
      );
    values.splice(
      values.findIndex((item) => item.id === deletedId),
      1,
    );
    if (entity === "people") {
      next.notes.forEach((note) => {
        if (note.decision?.ownerId === deletedId) note.decision.ownerId = "";
      });
      next.tasks.forEach((task) => {
        if (task.assigneeId === deletedId) task.assigneeId = "";
        task.comments.forEach((comment) => {
          if (comment.personId === deletedId) comment.personId = "";
        });
      });
      next.savedViews.forEach((view) => {
        if (view.assignee === deletedId) view.assignee = "";
      });
    }
    if (entity === "projects")
      next.savedViews.forEach((view) => {
        if (view.project === deletedId) view.project = "";
      });
    if (entity === "notes")
      next.tasks.forEach((task) => {
        task.noteIds = task.noteIds.filter((value) => value !== deletedId);
        if (task.source?.noteId === deletedId) delete task.source;
      });
    if (entity === "notes")
      next.notes.forEach((note) => {
        if (note.decision?.supersededById === deletedId) {
          note.decision.supersededById = "";
          note.decision.status =
            note.decision.outcome.trim() && note.decision.decidedOn
              ? "accepted"
              : "proposed";
        }
      });
    if (entity === "notes" || entity === "tasks")
      next.brainstorms.forEach((board) =>
        board.ideas.forEach((idea) => {
          if (entity === "notes" && idea.noteId === deletedId) idea.noteId = "";
          if (entity === "tasks" && idea.taskId === deletedId) idea.taskId = "";
        }),
      );
    if (entity === "tasks")
      next.tasks.forEach((task) => {
        task.blockedBy = task.blockedBy.filter((value) => value !== deletedId);
        if (task.parentId === deletedId) task.parentId = "";
      });
    const cardType =
      entity === "notes"
        ? "note"
        : entity === "tasks"
          ? "task"
          : entity === "media"
            ? "media"
            : "";
    if (cardType)
      next.canvases.forEach((canvas) => {
        canvas.cards = canvas.cards.filter(
          (card) => card.type !== cardType || card.entityId !== deletedId,
        );
        const remaining = new Set(canvas.cards.map((card) => card.id));
        canvas.edges = canvas.edges.filter(
          (edge) => remaining.has(edge.from) && remaining.has(edge.to),
        );
      });
    const relationshipType =
      entity === "notes"
        ? "note"
        : entity === "tasks"
          ? "task"
          : entity === "projects"
            ? "project"
            : "";
    if (relationshipType)
      next.relationships = next.relationships.filter(
        (relationship) =>
          !(
            relationship.from.type === relationshipType &&
            relationship.from.id === deletedId
          ) &&
          !(
            relationship.to.type === relationshipType &&
            relationship.to.id === deletedId
          ),
      );
  }
  next.revision = current.revision + 1;
  return validateWorkspace(next);
}
