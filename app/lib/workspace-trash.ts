import { database } from "./access-store";
import { validateWorkspace, WorkspaceError } from "./workspace-model";
import { normalizeSourceExcerpt } from "./source-excerpts";
import { canRestoreTaskLinks } from "./planning-model";
import type {
  Canvas,
  Entity,
  EntityRef,
  Relationship,
  Task,
  Workspace,
} from "./types";
import type {
  TrashEntry,
  TrashPage,
  TrashRecord,
  TrashRestore,
  TrashSnapshot,
  TrashWrite,
} from "./trash-types";

const entities: Entity[] = [
  "people",
  "projects",
  "tasks",
  "notes",
  "media",
  "canvases",
  "savedViews",
  "relationships",
];
type Row = {
  trash_id: string;
  entity: Entity;
  entity_id: string;
  title: string;
  payload: string;
  deleted_at: string;
  restored_at: string | null;
  invalidated_at: string | null;
  restore_warnings: string;
};
type Item = TrashRecord["item"];
const records = (workspace: Workspace, entity: Entity) =>
  workspace[entity] as unknown as Item[];
const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
const validId = (value: string) => /^[a-zA-Z0-9_-]{1,120}$/.test(value);

/** Only records touched by this deletion are archived, never the entire workspace. */
export function captureDeletion(
  current: Workspace,
  updated: Workspace,
  entity: Entity,
  id: string,
  trashId: string,
): TrashWrite {
  const original = records(current, entity).find((item) => item.id === id);
  if (!original) {
    throw new WorkspaceError("This item is no longer available.", 404);
  }
  const snapshot: TrashSnapshot = {
    version: 1,
    primary: {
      entity,
      item: structuredClone(original),
    },
    removed: [],
    changed: [],
  };
  for (const collection of entities) {
    const next = new Map(
      records(updated, collection).map((item) => [item.id, item]),
    );
    for (const item of records(current, collection)) {
      const replacement = next.get(item.id);
      if (!replacement) {
        if (collection !== entity || item.id !== id) {
          snapshot.removed.push({
            entity: collection,
            item: structuredClone(item),
          });
        }
      } else if (!same(item, replacement)) {
        snapshot.changed.push({
          entity: collection,
          id: item.id,
          before: structuredClone(item),
          after: structuredClone(replacement),
        });
      }
    }
  }
  // Note history has its own durable journal and must not inflate Trash records.
  for (const record of [snapshot.primary, ...snapshot.removed]) {
    if (record.entity === "notes") {
      record.item.snapshots = [];
    }
  }
  return {
    id: trashId,
    entity,
    entityId: id,
    title: String(original.title || original.name || "Relationship"),
    snapshot,
  };
}

export async function assertTrashIdAvailable(
  workspaceId: string,
  id: string,
): Promise<void> {
  const existing = await database()
    .prepare(
      "SELECT trash_id FROM workspace_trash WHERE workspace_id = ? AND trash_id = ?",
    )
    .bind(workspaceId, id)
    .first();
  if (existing) {
    throw new WorkspaceError(
      "This deletion identifier was already used. Refresh before deleting again.",
      409,
    );
  }
}

export async function trashPage(
  workspaceId: string,
  cursor: string | null,
  requestedLimit: string | null,
): Promise<TrashPage> {
  if (cursor && !validId(cursor)) {
    throw new WorkspaceError("Choose a valid Trash page.");
  }
  const limit = requestedLimit === null ? 20 : Number(requestedLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new WorkspaceError("Choose a Trash page size between 1 and 50.");
  }
  const anchor = cursor
    ? await database()
        .prepare(
          "SELECT deleted_at FROM workspace_trash WHERE workspace_id = ? AND trash_id = ?",
        )
        .bind(workspaceId, cursor)
        .first<{ deleted_at: string }>()
    : null;
  if (cursor && !anchor) {
    throw new WorkspaceError(
      "This Trash page is unavailable. Reopen Trash.",
      409,
    );
  }
  const before = anchor
    ? " AND (deleted_at < ? OR (deleted_at = ? AND trash_id < ?))"
    : "";
  const values = anchor ? [anchor.deleted_at, anchor.deleted_at, cursor!] : [];
  // Deliberately exclude payload: the list must not disclose archived contents.
  const result = await database()
    .prepare(
      `SELECT trash_id, entity, entity_id, title, deleted_at, invalidated_at
      FROM workspace_trash WHERE workspace_id = ? AND restored_at IS NULL${before}
      ORDER BY deleted_at DESC, trash_id DESC LIMIT ?`,
    )
    .bind(workspaceId, ...values, limit + 1)
    .all<Omit<Row, "payload">>();
  const entries: TrashEntry[] = result.results.slice(0, limit).map((row) => ({
    id: row.trash_id,
    entity: row.entity,
    entityId: row.entity_id,
    title: row.title,
    deletedAt: row.deleted_at,
    restorable: !row.invalidated_at,
    ...(row.invalidated_at
      ? {
          unavailableReason:
            "A workspace import or a newer deletion superseded this item.",
        }
      : {}),
  }));
  return {
    entries,
    nextCursor: result.results.length > limit ? entries[limit - 1].id : null,
  };
}

export async function restoreWarnings(
  workspaceId: string,
  id: string,
): Promise<string[]> {
  const row = await database()
    .prepare(
      "SELECT restore_warnings FROM workspace_trash WHERE workspace_id = ? AND trash_id = ?",
    )
    .bind(workspaceId, id)
    .first<{ restore_warnings: string }>();
  return row ? (JSON.parse(row.restore_warnings) as string[]) : [];
}

function endpointExists(workspace: Workspace, endpoint: EntityRef): boolean {
  return records(
    workspace,
    endpoint.type === "task"
      ? "tasks"
      : endpoint.type === "note"
        ? "notes"
        : "projects",
  ).some((item) => item.id === endpoint.id);
}

function connectionKey(relationship: Relationship): string {
  const endpoints = [
    `${relationship.from.type}:${relationship.from.id}`,
    `${relationship.to.type}:${relationship.to.id}`,
  ];
  if (relationship.kind === "contradicts") {
    endpoints.sort();
  }
  return `${relationship.kind}:${endpoints.join(">")}`;
}

/** Restore fields only while their post-delete value still matches. */
export async function prepareTrashRestore(
  workspaceId: string,
  current: Workspace,
  id: string,
): Promise<{
  workspace: Workspace;
  restore: TrashRestore;
}> {
  if (!validId(id)) {
    throw new WorkspaceError("Choose a valid Trash item.");
  }
  const row = await database()
    .prepare(
      "SELECT * FROM workspace_trash WHERE workspace_id = ? AND trash_id = ?",
    )
    .bind(workspaceId, id)
    .first<Row>();
  if (!row) {
    throw new WorkspaceError(
      "This item is not in this workspace’s Trash.",
      404,
    );
  }
  if (row.invalidated_at) {
    throw new WorkspaceError(
      "A workspace import or a newer deletion superseded this item. Restore a current Trash entry instead.",
      409,
    );
  }
  if (row.restored_at) {
    throw new WorkspaceError(
      "This Trash entry was already restored. Refresh to see the latest item.",
      409,
    );
  }
  const snapshot = JSON.parse(row.payload) as TrashSnapshot;
  if (
    snapshot.version !== 1 ||
    snapshot.primary.entity !== row.entity ||
    snapshot.primary.item.id !== row.entity_id
  ) {
    throw new WorkspaceError(
      "This Trash record could not be read safely.",
      409,
    );
  }
  const next = structuredClone(current);
  next.revision = current.revision + 1;
  const warnings: string[] = [];
  const warn = (message: string) => {
    if (!warnings.includes(message)) {
      warnings.push(message);
    }
  };
  const restored: TrashRestore["restored"] = [];
  const encoder = new TextEncoder();
  const size = (value: unknown) =>
    encoder.encode(JSON.stringify(value)).byteLength;
  const knownIds = new Map(
    entities.map((entity) => [
      entity,
      new Set(records(next, entity).map((item) => item.id)),
    ]),
  );
  const connectionKeys = new Set(next.relationships.map(connectionKey));
  let activeBytes = new TextEncoder().encode(
    JSON.stringify({
      ...next,
      notes: next.notes.map((note) => ({
        ...note,
        snapshots: [],
      })),
    }),
  ).byteLength;
  const tombstones = await database()
    .prepare(
      `SELECT t.entity, t.entity_id, t.deleted_at FROM json_each(?) archived
      JOIN entity_tombstones t ON t.workspace_id = ?
      AND t.entity = json_extract(archived.value, '$.entity')
      AND t.entity_id = json_extract(archived.value, '$.id')`,
    )
    .bind(
      JSON.stringify(
        [snapshot.primary, ...snapshot.removed].map((record) => ({
          entity: record.entity,
          id: record.item.id,
        })),
      ),
      workspaceId,
    )
    .all<{
      entity: Entity;
      entity_id: string;
      deleted_at: string;
    }>();
  const deletedAt = new Map(
    tombstones.results.map((item) => [
      `${item.entity}:${item.entity_id}`,
      item.deleted_at,
    ]),
  );
  const exists = (entity: Entity, value: unknown) =>
    typeof value === "string" && knownIds.get(entity)!.has(value);
  const activePerson = (value: unknown) =>
    typeof value === "string" &&
    next.people.some((person) => person.id === value && !person.inactive);
  const sourceInUse = (source: NonNullable<Task["source"]>, exceptId = "") =>
    next.tasks.some(
      (task) =>
        task.id !== exceptId &&
        task.source?.noteId === source.noteId &&
        normalizeSourceExcerpt(task.source.excerpt) ===
          normalizeSourceExcerpt(source.excerpt),
    );
  const cardAvailable = (card: Canvas["cards"][number]) =>
    !["note", "task", "media"].includes(card.type) ||
    exists(
      card.type === "note" ? "notes" : card.type === "task" ? "tasks" : "media",
      card.entityId,
    );
  const reference = (
    item: Item,
    field: string,
    entity: Entity,
    activeOnly = false,
  ) => {
    if (
      item[field] &&
      !(activeOnly ? activePerson(item[field]) : exists(entity, item[field]))
    ) {
      item[field] = "";
      warn(
        "Some references were cleared because their related items are unavailable.",
      );
    }
  };
  const cleanCanvas = (canvas: Canvas) => {
    const before = canvas.cards.length;
    canvas.cards = canvas.cards.filter(cardAvailable);
    const ids = new Set(canvas.cards.map((card) => card.id));
    const edgeCount = canvas.edges.length;
    canvas.edges = canvas.edges.filter(
      (edge) => ids.has(edge.from) && ids.has(edge.to),
    );
    if (before !== canvas.cards.length || edgeCount !== canvas.edges.length) {
      warn(
        "Some canvas cards or connections could not be restored because related items are unavailable.",
      );
    }
  };
  const sanitize = (record: TrashRecord): TrashRecord => {
    const result = structuredClone(record);
    const item = result.item;
    if (result.entity === "tasks") {
      const task = item as unknown as Task;
      task.startDate ??= "";
      reference(item, "projectId", "projects");
      reference(item, "assigneeId", "people", true);
      task.parentId ??= "";
      task.milestoneId ??= "";
      task.recurrence ??= null;
      task.reminder ??= null;
      if (task.parentId) {
        const parent = next.tasks.find((value) => value.id === task.parentId);
        if (
          !parent ||
          parent.projectId !== task.projectId ||
          parent.recurrence ||
          (parent.status === "done" && task.status !== "done")
        ) {
          task.parentId = "";
          warn(
            "The original parent link could not be restored because the parent is unavailable or its plan changed.",
          );
        }
      }
      if (
        task.milestoneId &&
        !next.projects
          .find((project) => project.id === task.projectId)
          ?.milestones?.some((milestone) => milestone.id === task.milestoneId)
      ) {
        task.milestoneId = "";
        warn(
          "The original milestone is unavailable; the task was restored without that assignment.",
        );
      }
      task.noteIds = task.noteIds.filter((value) => {
        const valid = exists("notes", value);
        if (!valid) {
          warn("Some linked notes are unavailable and were left unlinked.");
        }
        return valid;
      });
      task.blockedBy = task.blockedBy.filter((value) => {
        const valid = value !== task.id && exists("tasks", value);
        if (!valid) {
          warn("Some blocking tasks are unavailable and were left unlinked.");
        }
        return valid;
      });
      for (const comment of task.comments) {
        if (comment.personId && !exists("people", comment.personId)) {
          comment.personId = "";
          warn(
            "Some discussion authors are unavailable; their messages were preserved.",
          );
        }
      }
      if (
        task.source &&
        (!exists("notes", task.source.noteId) || sourceInUse(task.source))
      ) {
        delete task.source;
        warn(
          "The original note source could not be restored because it is missing or already has a linked task.",
        );
      }
      if (next.tasks.some((existing) => existing.key === task.key)) {
        const prefix =
          next.projects.find((project) => project.id === task.projectId)?.key ||
          "TASK";
        let number = 1;
        while (
          next.tasks.some((existing) => existing.key === `${prefix}-${number}`)
        ) {
          number++;
        }
        task.key = `${prefix}-${number}`;
        warn(
          `The task key was already in use. The restored task uses ${task.key}.`,
        );
      }
      task.updatedAt = new Date().toISOString();
    }
    if (result.entity === "notes") {
      reference(item, "projectId", "projects");
      const title = String(item.title);
      let number = 1;
      while (
        next.notes.some(
          (note) =>
            note.title.trim().toLowerCase() ===
            String(item.title).trim().toLowerCase(),
        )
      ) {
        item.title = `${title.slice(0, 275)} (restored ${number++})`;
      }
      if (item.title !== title) {
        warn(
          `A note with that title already exists. The restored note is named “${item.title}”.`,
        );
      }
      item.snapshots = [];
      item.updatedAt = new Date().toISOString();
    }
    if (result.entity === "projects") {
      item.milestones ??= [];
      const key = String(item.key);
      let number = 1;
      while (
        next.projects.some(
          (project) =>
            project.key.toUpperCase() === String(item.key).toUpperCase(),
        )
      ) {
        item.key = `${key.slice(0, 10)}_${number++}`;
      }
      if (item.key !== key) {
        warn(
          `The project key was already in use. The restored project uses ${item.key}.`,
        );
      }
    }
    if (result.entity === "savedViews") {
      reference(item, "assignee", "people");
      reference(item, "project", "projects");
      item.dateFilter ??= "all";
      item.sort ??= "priority";
      item.layout ??= "board";
    }
    if (result.entity === "canvases") {
      reference(item, "projectId", "projects");
      cleanCanvas(item as unknown as Canvas);
    }
    return result;
  };
  const add = (record: TrashRecord, primary: boolean): void => {
    if (exists(record.entity, record.item.id)) {
      if (primary) {
        throw new WorkspaceError(
          "An active item already uses this identifier. It was not overwritten.",
          409,
        );
      }
      warn(
        "Some relationships were not restored because their identifiers are already in use.",
      );
      return;
    }
    if (
      deletedAt.get(`${record.entity}:${record.item.id}`) !== row.deleted_at
    ) {
      if (primary) {
        throw new WorkspaceError(
          "A newer deletion or import superseded this Trash entry.",
          409,
        );
      }
      warn(
        "Some relationships were not restored because a newer change superseded them.",
      );
      return;
    }
    if (record.entity === "relationships") {
      const relationship = record.item as unknown as Relationship;
      if (
        !endpointExists(next, relationship.from) ||
        !endpointExists(next, relationship.to) ||
        connectionKeys.has(connectionKey(relationship))
      ) {
        if (primary) {
          throw new WorkspaceError(
            "This relationship needs both related items and a unique connection. Restore its related items first.",
            409,
          );
        }
        warn(
          "Some relationships could not be restored because their related items are missing or an equivalent connection already exists.",
        );
        return;
      }
    }
    const cleaned = sanitize(record);
    if (
      !primary &&
      record.entity === "relationships" &&
      next.relationships.length >= 2000
    ) {
      warn(
        "Some relationships were not restored because the workspace has reached its relationship limit.",
      );
      return;
    }
    const addedBytes =
      size(cleaned.item) + (records(next, record.entity).length ? 1 : 0);
    if (!primary && activeBytes + addedBytes > 1_500_000) {
      warn(
        "Some relationships were not restored because the workspace has reached its active text limit.",
      );
      return;
    }
    records(next, record.entity).push(cleaned.item);
    if (primary) {
      try {
        validateWorkspace(next);
      } catch (error) {
        records(next, record.entity).pop();
        throw error;
      }
    }
    knownIds.get(record.entity)!.add(record.item.id);
    if (record.entity === "relationships")
      connectionKeys.add(
        connectionKey(cleaned.item as unknown as Relationship),
      );
    activeBytes += addedBytes;
    restored.push({
      entity: record.entity,
      id: record.item.id,
    });
  };
  add(snapshot.primary, true);
  for (const removed of snapshot.removed) {
    if (
      removed.entity !== snapshot.primary.entity ||
      removed.item.id !== snapshot.primary.item.id
    ) {
      add(removed, false);
    }
  }
  for (const change of snapshot.changed) {
    const item = records(next, change.entity).find(
      (item) => item.id === change.id,
    );
    if (!item) {
      warn(
        "Some links could not be restored because their containing items are unavailable.",
      );
      continue;
    }
    const conflictingCards = new Set<string>();
    const attempt = (field: string, value: unknown) => {
      const old = item[field];
      const beforeBytes = size(item);
      const maximum = field === "cards" ? 500 : field === "edges" ? 1500 : 500;
      if (Array.isArray(value) && value.length > maximum) {
        warn(
          "Some links could not be restored because their containing item has reached its link limit.",
        );
        return;
      }
      if (value === undefined) {
        delete item[field];
      } else {
        item[field] = structuredClone(value);
      }
      const addedBytes = size(item) - beforeBytes;
      if (activeBytes + addedBytes > 1_500_000) {
        if (old === undefined) {
          delete item[field];
        } else {
          item[field] = old;
        }
        warn(
          "Some links could not be restored because the workspace has reached its active text limit.",
        );
      } else {
        activeBytes += addedBytes;
      }
    };
    for (const field of Object.keys(change.before)) {
      const before = change.before[field],
        after = change.after[field];
      if (same(before, after)) {
        continue;
      }
      if (
        change.entity === "canvases" &&
        (field === "cards" || field === "edges")
      ) {
        const previous = before as {
            id: string;
          }[],
          remaining = after as {
            id: string;
          }[],
          live = item[field] as {
            id: string;
          }[];
        const removed = previous.filter(
          (record) =>
            !remaining.some((candidate) => candidate.id === record.id),
        );
        const additions: {
          id: string;
        }[] = [];
        for (const record of removed) {
          const existing = live.find((candidate) => candidate.id === record.id);
          if (existing) {
            if (!same(existing, record)) {
              conflictingCards.add(record.id);
              warn(
                "Some canvas links were left unchanged because their identifiers are already in use.",
              );
            }
            continue;
          }
          const canvas = item as unknown as Canvas;
          if (field === "cards") {
            const card = record as Canvas["cards"][number];
            if (!cardAvailable(card)) {
              warn(
                "Some canvas cards could not be restored because related items are unavailable.",
              );
              continue;
            }
          } else {
            const edge = record as Canvas["edges"][number];
            if (
              conflictingCards.has(edge.from) ||
              conflictingCards.has(edge.to) ||
              !canvas.cards.some((card) => card.id === edge.from) ||
              !canvas.cards.some((card) => card.id === edge.to)
            ) {
              warn(
                "Some canvas connections could not be restored because related cards are unavailable.",
              );
              continue;
            }
          }
          additions.push(record);
        }
        if (additions.length) {
          attempt(field, [...live, ...additions]);
        }
      } else if (
        change.entity === "tasks" &&
        (field === "noteIds" || field === "blockedBy")
      ) {
        const removed = (before as string[]).filter(
          (value) => !(after as string[]).includes(value),
        );
        const additions = removed.filter((value) => {
          const present = exists(
            field === "noteIds" ? "notes" : "tasks",
            value,
          );
          if (!present) {
            warn(
              "Some links could not be restored because their related items are unavailable.",
            );
          }
          if (!present || (item[field] as string[]).includes(value)) {
            return false;
          }
          if (field === "blockedBy") {
            const visited = new Set<string>();
            const reachesTask = (id: string): boolean => {
              if (id === item.id) {
                return true;
              }
              if (visited.has(id)) {
                return false;
              }
              visited.add(id);
              return (
                next.tasks
                  .find((task) => task.id === id)
                  ?.blockedBy.some(reachesTask) || false
              );
            };
            if (
              reachesTask(value) ||
              !canRestoreTaskLinks(next, item as unknown as Task, {
                blockedBy: [...(item.blockedBy as string[]), value],
              })
            ) {
              warn(
                "Some blocking links could not be restored because newer dependencies would create a cycle.",
              );
              return false;
            }
          }
          return true;
        });
        if (additions.length) {
          attempt(field, [...(item[field] as string[]), ...additions]);
        }
      } else if (change.entity === "tasks" && field === "comments") {
        const comments = structuredClone(item.comments as Task["comments"]);
        for (const previous of before as Task["comments"]) {
          const deleted = (after as Task["comments"]).find(
            (comment) => comment.id === previous.id,
          );
          const live = comments.find((comment) => comment.id === previous.id);
          if (deleted && live && previous.personId !== deleted.personId) {
            if (live.personId === deleted.personId) {
              live.personId = previous.personId;
            } else {
              warn(
                "Some discussion authors were left unchanged because they changed after deletion.",
              );
            }
          }
        }
        attempt(field, comments);
      } else if (change.entity === "tasks" && field === "source" && before) {
        const source = before as Task["source"];
        if (!same(item[field], after)) {
          warn(
            "Some links were left unchanged because they changed after deletion.",
          );
        } else if (
          !source ||
          !exists("notes", source.noteId) ||
          !(item.noteIds as string[]).includes(source.noteId) ||
          sourceInUse(source, item.id)
        ) {
          warn(
            "The original note source could not be restored because it is missing or already has a linked task.",
          );
        } else {
          attempt(field, before);
        }
      } else if (change.entity === "tasks" && field === "parentId" && before) {
        const parent = next.tasks.find((task) => task.id === before);
        if (!same(item[field], after)) {
          warn(
            "Some parent links were left unchanged because they changed after deletion.",
          );
        } else if (
          !parent ||
          !canRestoreTaskLinks(next, item as unknown as Task, {
            parentId: String(before),
          })
        ) {
          warn(
            "Some parent links could not be restored because newer planning changes would make them invalid.",
          );
        } else {
          attempt(field, before);
        }
      } else if (same(item[field], after)) {
        attempt(field, before);
      } else {
        warn(
          "Some links were left unchanged because they changed after deletion.",
        );
      }
    }
  }
  return {
    workspace: validateWorkspace(next),
    restore: {
      id,
      deletedAt: row.deleted_at,
      restored,
      warnings,
    },
  };
}
