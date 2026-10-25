import type { ResolvedWorkspace } from "./access-store";
import type { Entity, EntityRef, Mutation, Workspace } from "./types";
import { WorkspaceError } from "./workspace-model";

export type PermissionEntityRef =
  | EntityRef
  | {
      type:
        | "canvas"
        | "brainstorm"
        | "media"
        | "person"
        | "savedView"
        | "noteType"
        | "relationshipPreset"
        | "relationship";
      id: string;
    };

export function canManageWorkspace(access: ResolvedWorkspace): boolean {
  return access.role === "owner" || access.role === "admin";
}

export function canEditWorkspace(access: ResolvedWorkspace): boolean {
  return access.role !== "viewer";
}

export function canReadProject(
  access: ResolvedWorkspace,
  projectId: string,
): boolean {
  if (!projectId || canManageWorkspace(access)) return true;
  const policy = access.permissions?.find(
    (item) => item.projectId === projectId,
  );
  return (
    !policy?.restricted ||
    !!policy.members.some((member) => member.userId === access.user?.id)
  );
}

export function canEditProject(
  access: ResolvedWorkspace,
  projectId: string,
): boolean {
  if (!canEditWorkspace(access) || !canReadProject(access, projectId))
    return false;
  if (canManageWorkspace(access) || !projectId) return true;
  const grant = access.permissions
    ?.find((item) => item.projectId === projectId)
    ?.members.find((member) => member.userId === access.user?.id);
  return !grant || grant.role === "editor";
}

export function assertWorkspaceWritable(access: ResolvedWorkspace): void {
  if (!canEditWorkspace(access))
    throw new WorkspaceError(
      "This workspace is view only. Ask an administrator for editing access.",
      403,
    );
}

export function assertProjectWritable(
  access: ResolvedWorkspace,
  projectId: string,
): void {
  assertWorkspaceWritable(access);
  if (!canEditProject(access, projectId))
    throw new WorkspaceError(
      "You do not have editing access to this project.",
      403,
    );
}

/** Include this predicate in the same transaction that writes the records. */
export function permissionsSnapshotSQL(access: ResolvedWorkspace): {
  sql: string;
  bindings: (string | number)[];
} {
  if (!access.user) return { sql: "1 = 1", bindings: [] };
  return {
    sql: `EXISTS (SELECT 1 FROM workspace_access permission_access
      JOIN appmembers permission_member ON permission_member.workspace_id = permission_access.id
      LEFT JOIN appmember_roles permission_role ON permission_role.workspace_id = permission_member.workspace_id AND permission_role.user_id = permission_member.user_id
      WHERE permission_access.id = ? AND permission_member.user_id = ?
      AND (permission_access.kind = 'team' OR permission_access.owner_user_id = ?)
      AND CASE WHEN permission_member.role = 'owner' THEN 'owner' ELSE COALESCE(permission_role.role, 'editor') END = ?)
      AND COALESCE((SELECT revision FROM workspace_security WHERE workspace_id = ?), 0) = ?`,
    bindings: [
      access.id,
      access.user.id,
      access.user.id,
      access.role,
      access.id,
      access.securityRevision || 0,
    ],
  };
}

const mediaIds = (text: string) =>
  [...text.matchAll(/\/api\/media\/([A-Za-z0-9_-]{1,120})/g)].map(
    (match) => match[1],
  );
const mediaIndexes = new WeakMap<Workspace, Map<string, Set<string>>>();

function mediaProjects(workspace: Workspace, mediaId: string): string[] {
  let index = mediaIndexes.get(workspace);
  if (!index) {
    index = new Map();
    const add = (id: string, project: string) => {
      const values = index!.get(id) || new Set<string>();
      values.add(project);
      index!.set(id, values);
    };
    for (const note of workspace.notes)
      for (const id of mediaIds(
        [
          note.content,
          ...Object.values(note.properties),
          ...Object.values(note.propertyValues || {}),
          ...(note.decision
            ? [
                note.decision.context,
                note.decision.options,
                note.decision.outcome,
                note.decision.consequences,
              ]
            : []),
          ...note.snapshots.map((snapshot) => snapshot.content),
        ].join("\n"),
      ))
        add(id, note.projectId);
    for (const task of workspace.tasks)
      for (const id of mediaIds(
        [
          task.description,
          ...task.comments.map((comment) => comment.body),
        ].join("\n"),
      ))
        add(id, task.projectId);
    for (const board of workspace.brainstorms || [])
      for (const id of mediaIds(
        [
          board.description,
          ...board.ideas.map((idea) => idea.description),
        ].join("\n"),
      ))
        add(id, board.projectId);
    for (const project of workspace.projects)
      for (const id of mediaIds([project.description, project.goal].join("\n")))
        add(id, project.id);
    for (const canvas of workspace.canvases)
      for (const card of canvas.cards) {
        if (card.type === "media" && card.entityId)
          add(card.entityId, canvas.projectId || "");
        for (const id of mediaIds(card.text)) add(id, canvas.projectId || "");
      }
    mediaIndexes.set(workspace, index);
  }
  return [...(index.get(mediaId) || [])];
}

export function canReadMedia(
  access: ResolvedWorkspace,
  workspace: Workspace,
  mediaId: string,
): boolean {
  const item = workspace.media.find((media) => media.id === mediaId);
  if (!item) return false;
  const projectId = (item as typeof item & { projectId?: string }).projectId;
  if (projectId && !canReadProject(access, projectId)) return false;
  const references = mediaProjects(workspace, mediaId);
  return (
    !references.length ||
    references.some((project) => canReadProject(access, project))
  );
}

function entityProject(
  workspace: Workspace,
  ref: PermissionEntityRef,
): string | undefined {
  if (ref.type === "project")
    return workspace.projects.some((project) => project.id === ref.id)
      ? ref.id
      : undefined;
  if (ref.type === "note")
    return workspace.notes.find((note) => note.id === ref.id)?.projectId;
  if (ref.type === "task")
    return workspace.tasks.find((task) => task.id === ref.id)?.projectId;
  if (ref.type === "canvas")
    return (
      workspace.canvases.find((canvas) => canvas.id === ref.id)?.projectId ??
      (workspace.canvases.some((canvas) => canvas.id === ref.id)
        ? ""
        : undefined)
    );
  if (ref.type === "brainstorm")
    return workspace.brainstorms?.find((board) => board.id === ref.id)
      ?.projectId;
  return undefined;
}

export function canReadEntity(
  access: ResolvedWorkspace,
  workspace: Workspace,
  ref: PermissionEntityRef,
): boolean {
  if (ref.type === "media") return canReadMedia(access, workspace, ref.id);
  if (ref.type === "relationship") {
    const item = workspace.relationships.find(
      (relationship) => relationship.id === ref.id,
    );
    return (
      !!item &&
      canReadEntity(access, workspace, item.from) &&
      canReadEntity(access, workspace, item.to)
    );
  }
  if (ref.type === "savedView") {
    const item = workspace.savedViews.find((view) => view.id === ref.id);
    return (
      !!item &&
      canReadProject(access, item.project === "all" ? "" : item.project)
    );
  }
  const global =
    ref.type === "person"
      ? workspace.people
      : ref.type === "noteType"
        ? workspace.noteTypes
        : ref.type === "relationshipPreset"
          ? workspace.relationshipPresets
          : undefined;
  if (global) return global.some((item) => item.id === ref.id);
  const projectId = entityProject(workspace, ref);
  return projectId !== undefined && canReadProject(access, projectId);
}

export function canEditEntity(
  access: ResolvedWorkspace,
  workspace: Workspace,
  ref: PermissionEntityRef,
): boolean {
  if (!canEditWorkspace(access) || !canReadEntity(access, workspace, ref))
    return false;
  if (ref.type === "relationship") {
    const item = workspace.relationships.find(
      (relationship) => relationship.id === ref.id,
    )!;
    return (
      canEditEntity(access, workspace, item.from) ||
      canEditEntity(access, workspace, item.to)
    );
  }
  if (ref.type === "media") {
    const item = workspace.media.find((media) => media.id === ref.id)!;
    return (
      canEditProject(
        access,
        (item as typeof item & { projectId?: string }).projectId || "",
      ) &&
      mediaProjects(workspace, ref.id).every((project) =>
        canEditProject(access, project),
      )
    );
  }
  if (ref.type === "savedView") {
    const item = workspace.savedViews.find((view) => view.id === ref.id)!;
    return canEditProject(access, item.project === "all" ? "" : item.project);
  }
  const projectId = entityProject(workspace, ref);
  return projectId === undefined || canEditProject(access, projectId);
}

export function filterWorkspaceForAccess(
  access: ResolvedWorkspace,
  workspace: Workspace,
): Workspace {
  if (canManageWorkspace(access)) return workspace;
  const next = structuredClone(workspace);
  next.projects = next.projects.filter((project) =>
    canReadProject(access, project.id),
  );
  next.tasks = next.tasks.filter((task) =>
    canReadProject(access, task.projectId),
  );
  next.notes = next.notes.filter((note) =>
    canReadProject(access, note.projectId),
  );
  next.canvases = next.canvases.filter((canvas) =>
    canReadProject(access, canvas.projectId || ""),
  );
  next.brainstorms = (next.brainstorms || []).filter((board) =>
    canReadProject(access, board.projectId),
  );
  next.media = next.media.filter((media) =>
    canReadMedia(access, workspace, media.id),
  );
  next.savedViews = next.savedViews.filter((view) =>
    canReadProject(access, view.project === "all" ? "" : view.project),
  );
  const noteIds = new Set(next.notes.map((note) => note.id));
  const taskIds = new Set(next.tasks.map((task) => task.id));
  const media = new Set(next.media.map((item) => item.id));
  for (const task of next.tasks) {
    task.noteIds = task.noteIds.filter((id) => noteIds.has(id));
    task.blockedBy = task.blockedBy.filter((id) => taskIds.has(id));
    if (task.parentId && !taskIds.has(task.parentId)) task.parentId = "";
    if (task.source && !noteIds.has(task.source.noteId)) delete task.source;
    if (task.recurrenceNextId && !taskIds.has(task.recurrenceNextId))
      delete task.recurrenceNextId;
    if (task.recurringFromId && !taskIds.has(task.recurringFromId))
      delete task.recurringFromId;
  }
  for (const note of next.notes)
    if (
      note.decision?.supersededById &&
      !noteIds.has(note.decision.supersededById)
    ) {
      note.decision.supersededById = "";
      note.decision.status = "proposed";
    }
  for (const canvas of next.canvases) {
    canvas.cards = canvas.cards.filter((card) =>
      card.type === "note"
        ? noteIds.has(card.entityId || "")
        : card.type === "task"
          ? taskIds.has(card.entityId || "")
          : card.type === "media"
            ? media.has(card.entityId || "")
            : true,
    );
    const cards = new Set(canvas.cards.map((card) => card.id));
    canvas.edges = canvas.edges.filter(
      (edge) => cards.has(edge.from) && cards.has(edge.to),
    );
  }
  for (const board of next.brainstorms)
    for (const idea of board.ideas) {
      if (!noteIds.has(idea.noteId)) idea.noteId = "";
      if (!taskIds.has(idea.taskId)) idea.taskId = "";
    }
  next.relationships = next.relationships.filter(
    (relationship) =>
      canReadEntity(access, workspace, relationship.from) &&
      canReadEntity(access, workspace, relationship.to),
  );
  return next;
}

const refs: Record<Entity, PermissionEntityRef["type"]> = {
  people: "person",
  projects: "project",
  tasks: "task",
  notes: "note",
  media: "media",
  canvases: "canvas",
  savedViews: "savedView",
  relationships: "relationship",
  noteTypes: "noteType",
  relationshipPresets: "relationshipPreset",
  brainstorms: "brainstorm",
};
const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

function structuredReferences(
  entity: Entity,
  item: Record<string, unknown>,
): PermissionEntityRef[] {
  if (entity === "relationships")
    return [item.from, item.to].filter(Boolean) as EntityRef[];
  const references: PermissionEntityRef[] = [];
  const add = (type: PermissionEntityRef["type"], value: unknown) => {
    if (typeof value === "string" && value)
      references.push({ type, id: value } as PermissionEntityRef);
  };
  if (entity === "tasks") {
    for (const id of (item.noteIds || []) as string[]) add("note", id);
    for (const id of (item.blockedBy || []) as string[]) add("task", id);
    add("task", item.parentId);
    add("note", (item.source as { noteId?: string } | undefined)?.noteId);
  }
  if (entity === "notes")
    add(
      "note",
      (item.decision as { supersededById?: string } | undefined)
        ?.supersededById,
    );
  if (entity === "canvases")
    for (const card of (item.cards || []) as {
      type: string;
      entityId?: string;
    }[])
      if (["note", "task", "media"].includes(card.type))
        add(card.type as "note" | "task" | "media", card.entityId);
  if (entity === "brainstorms")
    for (const idea of (item.ideas || []) as {
      noteId?: string;
      taskId?: string;
    }[]) {
      add("note", idea.noteId);
      add("task", idea.taskId);
    }
  return references;
}

function inputObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Permission checks run before global validation can describe protected records. */
export function assertMutationInputAccess(
  access: ResolvedWorkspace,
  current: Workspace,
  mutation: unknown,
): void {
  assertWorkspaceWritable(access);
  if (!inputObject(mutation)) return;
  if (
    (mutation.action === "import" || mutation.action === "rename") &&
    access.role !== "owner"
  )
    throw new WorkspaceError(
      "Only the workspace owner can rename or replace the workspace.",
      403,
    );
  if (
    ["upsert", "delete"].includes(String(mutation.action)) &&
    typeof mutation.entity === "string" &&
    !Object.hasOwn(refs, mutation.entity)
  )
    throw new WorkspaceError("Choose a valid workspace collection.");
  if (canManageWorkspace(access)) return;
  if (
    mutation.action === "review-relationship" ||
    mutation.action === "vote-idea"
  ) {
    if (
      typeof mutation.id === "string" &&
      !canEditEntity(access, current, {
        type:
          mutation.action === "review-relationship"
            ? "relationship"
            : "brainstorm",
        id: mutation.id,
      })
    )
      throw new WorkspaceError(
        "You do not have editing access to this item.",
        403,
      );
    return;
  }
  if (
    !["upsert", "delete"].includes(String(mutation.action)) ||
    typeof mutation.entity !== "string"
  )
    return;
  if (!Object.hasOwn(refs, mutation.entity))
    throw new WorkspaceError("Choose a valid workspace collection.");
  const entity = mutation.entity as Entity;
  const item = inputObject(mutation.item) ? mutation.item : {};
  const id = mutation.action === "delete" ? mutation.id : item.id;
  if (typeof id !== "string") return;
  const existing = (current[entity] || []).find((record) => record.id === id);
  if (
    existing &&
    !canEditEntity(access, current, {
      type: refs[entity],
      id,
    } as PermissionEntityRef)
  )
    throw new WorkspaceError(
      "You do not have editing access to this item.",
      403,
    );
  if (
    entity === "noteTypes" &&
    current.notes.some(
      (note) =>
        note.customTypeId === id && !canReadProject(access, note.projectId),
    )
  )
    throw new WorkspaceError(
      "An administrator must update this shared note type.",
      403,
    );
  if (mutation.action !== "upsert") return;
  const projectId =
    entity === "projects"
      ? id
      : entity === "savedViews"
        ? item.project
        : item.projectId;
  if (
    typeof projectId === "string" &&
    projectId !== "all" &&
    !canEditProject(access, projectId)
  )
    throw new WorkspaceError(
      "You do not have editing access to this project.",
      403,
    );

  // Invalid input still belongs to the model validator. Only normalize enough
  // structure here to inspect references safely before its error messages run.
  const candidate = { ...item };
  for (const key of ["noteIds", "blockedBy"] as const)
    candidate[key] = Array.isArray(item[key]) ? item[key] : [];
  for (const key of ["cards", "ideas"] as const)
    candidate[key] = Array.isArray(item[key])
      ? item[key].filter(inputObject)
      : [];
  const validTypes = new Set(Object.values(refs));
  for (const reference of structuredReferences(entity, candidate)) {
    if (
      !inputObject(reference) ||
      typeof reference.id !== "string" ||
      !validTypes.has(reference.type)
    )
      continue;
    if (reference.id === id && reference.type === refs[entity] && !existing)
      continue;
    if (!canReadEntity(access, current, reference))
      throw new WorkspaceError(
        "A connection in this change is unavailable to your account.",
        403,
      );
  }
  const serialized = JSON.stringify(item);
  for (const mediaId of mediaIds(serialized))
    if (
      current.media.some((file) => file.id === mediaId) &&
      !canReadMedia(access, current, mediaId)
    )
      throw new WorkspaceError(
        "An attachment in this change is unavailable to your account.",
        403,
      );
}

/** Check model side effects as well as the direct item; hidden links are never silently erased. */
export function assertMutationAccess(
  access: ResolvedWorkspace,
  current: Workspace,
  updated: Workspace,
  mutation: Mutation,
): void {
  assertWorkspaceWritable(access);
  if (
    (mutation.action === "import" || mutation.action === "rename") &&
    access.role !== "owner"
  )
    throw new WorkspaceError(
      "Only the workspace owner can rename or replace the workspace.",
      403,
    );
  if (canManageWorkspace(access)) return;
  for (const entity of Object.keys(refs) as Entity[]) {
    const before = (current[entity] || []) as unknown as (Record<
      string,
      unknown
    > & { id: string })[];
    const after = (updated[entity] || []) as unknown as (Record<
      string,
      unknown
    > & { id: string })[];
    const previous = new Map(before.map((item) => [item.id, item]));
    const next = new Map(after.map((item) => [item.id, item]));
    for (const id of new Set([...previous.keys(), ...next.keys()])) {
      const old = previous.get(id),
        item = next.get(id);
      if (same(old, item)) continue;
      if (
        (old &&
          !canEditEntity(access, current, {
            type: refs[entity],
            id,
          } as PermissionEntityRef)) ||
        (item &&
          !canEditEntity(access, updated, {
            type: refs[entity],
            id,
          } as PermissionEntityRef))
      )
        throw new WorkspaceError(
          "This change affects work you cannot edit. Ask an administrator to review the related project access.",
          403,
        );
      if (!item) continue;
      const relevant = new Set<string>();
      for (const value of [
        ...structuredReferences(entity, old || {}),
        ...structuredReferences(entity, item),
      ]) {
        const key = `${value.type}:${value.id}`;
        if (relevant.has(key)) continue;
        relevant.add(key);
        if (
          canReadEntity(access, current, value) ||
          canReadEntity(access, updated, value)
        )
          continue;
        // An unchanged hidden field stays server-side, while any edited nested
        // connection must be reviewed rather than deleting its hidden endpoint.
        const referenceFields =
          entity === "tasks"
            ? ["noteIds", "blockedBy", "parentId", "source"]
            : entity === "notes"
              ? ["decision"]
              : entity === "canvases"
                ? ["cards"]
                : entity === "brainstorms"
                  ? ["ideas"]
                  : ["from", "to"];
        if (referenceFields.some((field) => !same(old?.[field], item[field])))
          throw new WorkspaceError(
            "Some connections are outside your current access. Ask an administrator to update those connections; your other work is kept.",
            403,
          );
      }
      for (const field of ["content", "description"] as const)
        if (
          typeof item[field] === "string" &&
          !same(old?.[field], item[field])
        ) {
          for (const mediaId of mediaIds(item[field] as string))
            if (
              updated.media.some((file) => file.id === mediaId) &&
              !canReadMedia(access, updated, mediaId)
            )
              throw new WorkspaceError(
                "An attachment in this change belongs to a project you cannot access.",
                403,
              );
        }
    }
  }
}
