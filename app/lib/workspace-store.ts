import { createSeedWorkspace } from "./seed";
import {
  applyMutation,
  validateMutation,
  WorkspaceError,
} from "./workspace-model";
import {
  accountPersonId,
  assertSameOrigin,
  database,
  resolveWorkspace,
  type ResolvedWorkspace,
} from "./access-store";
import type { Entity, Mutation, Person, Task, Workspace } from "./types";
import {
  activeWorkspace,
  assertNotDeleted,
  commitWorkspace,
  hasReceipt,
  latestSnapshot,
  payloadHash,
  savedSnapshot,
} from "./workspace-journal";
import { readBoundedBody } from "./request-body";
import {
  assertTrashIdAvailable,
  captureDeletion,
  prepareTrashRestore,
  restoreWarnings,
} from "./workspace-trash";
import type { TrashCommit, WorkspaceMutationResult } from "./trash-types";
import { emptyDecision } from "./connected-thinking-model";

interface WorkspaceRow {
  data: string;
  revision: number;
}
type MemberRow = { id: string; username: string; role: "owner" | "member" };

async function rawWorkspace(access: ResolvedWorkspace): Promise<Workspace> {
  const db = database();
  let row = await db
    .prepare("SELECT data, revision FROM workspaces WHERE id = ?")
    .bind(access.id)
    .first<WorkspaceRow>();
  if (!row && access.kind === "guest") {
    await db
      .prepare(
        "INSERT OR IGNORE INTO workspaces (id, data, revision, updated_at) VALUES (?, ?, 0, ?)",
      )
      .bind(
        "main",
        JSON.stringify(createSeedWorkspace()),
        new Date().toISOString(),
      )
      .run();
    row = await db
      .prepare("SELECT data, revision FROM workspaces WHERE id = ?")
      .bind("main")
      .first<WorkspaceRow>();
  }
  if (!row) throw new WorkspaceError("The workspace could not be opened.", 404);
  const workspace = JSON.parse(row.data) as Workspace;
  workspace.relationships ??= [];
  workspace.noteTypes ??= [];
  workspace.relationshipPresets ??= [];
  workspace.brainstorms ??= [];
  for (const note of workspace.notes) {
    note.customTypeId ??= "";
    note.propertyValues ??= {};
    note.decision ??= null;
    if (note.kind === "decision" && !note.decision)
      note.decision = emptyDecision();
  }
  // Normalize optional scheduling fields from workspaces saved before scheduling
  // was introduced. Reading a workspace never rewrites its stored records.
  for (const task of workspace.tasks) {
    task.startDate ??= "";
    task.parentId ??= "";
    task.milestoneId ??= "";
    task.recurrence ??= null;
    task.reminder ??= null;
    if (task.recurrence) task.recurrence.untilDate ??= "";
  }
  for (const project of workspace.projects) {
    project.milestones ??= [];
    for (const milestone of project.milestones) milestone.archived ??= false;
  }
  for (const canvas of workspace.canvases) canvas.projectId ??= "";
  for (const view of workspace.savedViews) {
    view.dateFilter ??= "all";
    view.sort ??= "priority";
    view.layout ??= "board";
  }
  workspace.revision = row.revision;
  return workspace;
}

async function verifiedMembers(
  access: ResolvedWorkspace,
): Promise<MemberRow[]> {
  if (!access.user) return [];
  const result = await database()
    .prepare(
      "SELECT u.id, u.username, m.role FROM appmembers m JOIN user u ON u.id = m.user_id WHERE m.workspace_id = ?",
    )
    .bind(access.id)
    .all<MemberRow>();
  return result.results;
}

function withAccountPeople(
  workspace: Workspace,
  access: ResolvedWorkspace,
  members: MemberRow[],
): Workspace {
  if (!access.user) return workspace;
  const verified = new Map(
    members.map((member) => [accountPersonId(member.id), member]),
  );
  const people: Person[] = workspace.people.map((person) => {
    const member = verified.get(person.id);
    if (member) {
      verified.delete(person.id);
      return {
        id: person.id,
        name: member.username,
        role:
          access.kind === "personal"
            ? "You"
            : member.role === "owner"
              ? "Workspace owner"
              : "Team member",
        color: person.color,
        userId: member.id,
        inactive: false,
      };
    }
    return person.userId ? { ...person, inactive: true } : person;
  });
  for (const member of verified.values())
    people.push({
      id: accountPersonId(member.id),
      name: member.username,
      role:
        access.kind === "personal"
          ? "You"
          : member.role === "owner"
            ? "Workspace owner"
            : "Team member",
      color: "#8a78fa",
      userId: member.id,
      inactive: false,
    });
  return { ...workspace, people };
}

/** A scoped URL keeps image/audio/PDF requests in the workspace that owns the file. */
export function workspaceForClient(
  workspace: Workspace,
  workspaceId: string,
): Workspace {
  return {
    ...workspace,
    media: workspace.media.map((file) => ({
      ...file,
      url: `/api/media/${file.id}?workspace=${encodeURIComponent(workspaceId)}`,
    })),
  };
}

function canonicalMediaUrl(
  item: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof item.id !== "string" || typeof item.url !== "string") return item;
  // URL scope is transport context, never transferable ownership from an import.
  if (
    item.url === `/api/media/${item.id}` ||
    new RegExp(
      `^/api/media/${item.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?workspace=[a-zA-Z0-9_-]+$`,
    ).test(item.url)
  )
    return { ...item, url: `/api/media/${item.id}` };
  return item;
}

function prepareMutation(
  input: unknown,
  current: Workspace,
  access: ResolvedWorkspace,
): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const mutation = structuredClone(input) as Mutation;
  const item = mutation.item as Record<string, unknown> | undefined;
  if (
    (mutation.action === "rename" || mutation.action === "import") &&
    access.role !== "owner"
  )
    throw new WorkspaceError(
      "Only the workspace owner can rename or replace the workspace.",
      403,
    );
  if (
    mutation.entity === "media" &&
    mutation.base &&
    typeof mutation.base === "object"
  )
    mutation.base = canonicalMediaUrl(mutation.base);
  if (
    mutation.action === "upsert" &&
    mutation.entity === "media" &&
    item &&
    typeof item === "object"
  )
    mutation.item = canonicalMediaUrl(item);
  if (
    mutation.action === "upsert" &&
    mutation.entity === "people" &&
    item &&
    typeof item === "object"
  ) {
    const person = current.people.find((person) => person.id === item?.id);
    if (
      person?.userId ||
      item.userId !== undefined ||
      item.inactive !== undefined ||
      String(item.id || "").startsWith("account_")
    )
      throw new WorkspaceError(
        "Account names and membership are managed through Team & accounts.",
        403,
      );
  }
  if (
    mutation.action === "delete" &&
    mutation.entity === "people" &&
    current.people.some((person) => person.id === mutation.id && person.userId)
  )
    throw new WorkspaceError(
      "Manage account access through Team & accounts.",
      403,
    );
  if (
    mutation.action === "upsert" &&
    mutation.entity === "notes" &&
    item &&
    typeof item === "object" &&
    item.decision &&
    typeof item.decision === "object"
  ) {
    const decision = item.decision as Record<string, unknown>;
    const previous = current.notes.find(
      (note) => note.id === item.id,
    )?.decision;
    const owner = current.people.find(
      (person) => person.id === decision.ownerId,
    );
    if (
      owner?.userId &&
      owner.inactive &&
      decision.ownerId !== previous?.ownerId
    )
      throw new WorkspaceError(
        "This account is no longer a member. Choose an active decision owner or leave it unassigned.",
      );
  }
  if (
    mutation.action === "upsert" &&
    mutation.entity === "tasks" &&
    item &&
    typeof item === "object"
  ) {
    const previous = current.tasks.find((task) => task.id === item?.id);
    const assignee = current.people.find(
      (person) => person.id === item?.assigneeId,
    );
    if (
      assignee?.userId &&
      assignee.inactive &&
      item.assigneeId !== previous?.assigneeId
    )
      throw new WorkspaceError(
        "This account is no longer a member. Choose an active member or another assignment label.",
      );
    if (Array.isArray(item.comments))
      item.comments = authenticatedComments(
        item.comments,
        previous?.comments || [],
        access,
      );
  }
  if (
    mutation.action === "import" &&
    mutation.workspace &&
    typeof mutation.workspace === "object"
  ) {
    const imported = mutation.workspace as Workspace;
    for (const key of [
      "people",
      "projects",
      "tasks",
      "notes",
      "media",
      "canvases",
      "savedViews",
    ] as const) {
      if (
        !Array.isArray(imported[key]) ||
        !imported[key].every(
          (item) =>
            item &&
            typeof item === "object" &&
            !Array.isArray(item) &&
            typeof item.id === "string",
        )
      )
        throw new WorkspaceError(
          "The imported workspace contains invalid records.",
        );
    }
    if (
      !imported.tasks.every(
        (task) =>
          Array.isArray(task.comments) &&
          task.comments.every(
            (comment) =>
              comment && typeof comment === "object" && !Array.isArray(comment),
          ),
      )
    )
      throw new WorkspaceError("The imported discussions are invalid.");
    if (Array.isArray(imported.media))
      imported.media = imported.media.map(
        (file) =>
          canonicalMediaUrl(
            file as unknown as Record<string, unknown>,
          ) as unknown as Workspace["media"][number],
      );
    if (Array.isArray(imported.people)) {
      const remap = new Map<string, string>();
      imported.people = imported.people.map((person) => {
        const verified = current.people.find(
          (existing) =>
            existing.id === person.id &&
            existing.userId &&
            existing.userId === person.userId,
        );
        if (verified) return verified;
        if (person.userId || person.id?.startsWith("account_")) {
          const id = `label_${crypto.randomUUID()}`;
          remap.set(person.id, id);
          return {
            id,
            name: person.name,
            role: person.role,
            color: person.color,
          };
        }
        return {
          id: person.id,
          name: person.name,
          role: person.role,
          color: person.color,
        };
      });
      for (const task of imported.tasks || []) {
        task.assigneeId = remap.get(task.assigneeId) || task.assigneeId;
        for (const comment of task.comments || [])
          comment.personId = remap.get(comment.personId) || comment.personId;
      }
      for (const view of imported.savedViews || [])
        view.assignee = remap.get(view.assignee) || view.assignee;
      for (const note of imported.notes || [])
        if (note.decision)
          note.decision.ownerId =
            remap.get(note.decision.ownerId) || note.decision.ownerId;
    }
    // Keep verified members present even if the imported backup predates them.
    const memberPeople = current.people.filter((person) => person.userId);
    if (Array.isArray(imported.people))
      for (const person of memberPeople)
        if (!imported.people.some((existing) => existing.id === person.id))
          imported.people.push(person);
    for (const task of imported.tasks || []) {
      const previous = current.tasks.find(
        (existing) => existing.id === task.id,
      );
      for (const comment of task.comments || []) {
        if (!comment.personId?.startsWith("account_")) continue;
        const existing = previous?.comments.find(
          (existing) => existing.id === comment.id,
        );
        if (
          existing &&
          existing.personId === comment.personId &&
          existing.body === comment.body &&
          existing.createdAt === comment.createdAt
        )
          continue;
        comment.personId = access.user ? accountPersonId(access.user.id) : "";
        comment.createdAt = new Date().toISOString();
      }
    }
  }
  return mutation;
}

function authenticatedComments(
  incoming: unknown[],
  previous: Task["comments"],
  access: ResolvedWorkspace,
): unknown[] {
  const old = new Map(previous.map((comment) => [comment.id, comment]));
  const additions: unknown[] = [];
  const seen = new Set<string>();
  for (const value of incoming) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return incoming;
    const comment = value as Task["comments"][number],
      existing = old.get(comment.id);
    if (seen.has(comment.id))
      throw new WorkspaceError("Discussion message IDs must be unique.");
    seen.add(comment.id);
    if (existing) {
      if (existing.body !== comment.body)
        throw new WorkspaceError(
          "Existing discussion messages cannot be changed through the task editor.",
        );
      continue;
    }
    additions.push({
      ...comment,
      personId: access.user ? accountPersonId(access.user.id) : "",
      createdAt: new Date().toISOString(),
    });
  }
  return [...previous, ...additions];
}

export async function readWorkspace(request: Request): Promise<Workspace> {
  const access = await resolveWorkspace(request);
  const workspace = await rawWorkspace(access);
  return withAccountPeople(workspace, access, await verifiedMembers(access));
}

export async function mutateWorkspace(
  request: Request,
  mutation: unknown,
): Promise<Workspace> {
  return (await mutateWorkspaceResult(request, mutation)).workspace;
}

export async function mutateWorkspaceResult(
  request: Request,
  mutation: unknown,
): Promise<WorkspaceMutationResult> {
  assertSameOrigin(request);
  const input =
    mutation && typeof mutation === "object" && !Array.isArray(mutation)
      ? (mutation as Record<string, unknown>)
      : {};
  const item =
    input.item && typeof input.item === "object" && !Array.isArray(input.item)
      ? (input.item as Record<string, unknown>)
      : {};
  const operationId =
    typeof input.operationId === "string" ? input.operationId : undefined;
  const hash = await payloadHash(mutation);
  const trashId = operationId || crypto.randomUUID();
  // Merge again against the latest committed data whenever another writer wins.
  for (let attempt = 0; attempt < 12; attempt++) {
    // Recheck membership on retries, including a removal during an edit.
    const access = await resolveWorkspace(request);
    const current = withAccountPeople(
      await rawWorkspace(access),
      access,
      await verifiedMembers(access),
    );
    if (await hasReceipt(access, operationId, hash)) {
      await resolveWorkspace(request);
      return {
        workspace: activeWorkspace(current),
        warnings:
          input.action === "restore" && typeof input.id === "string"
            ? await restoreWarnings(access.id, input.id)
            : [],
      };
    }
    if (
      input.action === "upsert" &&
      input.base === null &&
      typeof item.id === "string" &&
      typeof input.entity === "string"
    ) {
      await assertNotDeleted(access.id, input.entity as Entity, item.id);
    }
    if (
      input.action === "upsert" &&
      input.entity === "notes" &&
      typeof item.id === "string"
    ) {
      const note = current.notes.find((note) => note.id === item.id);
      if (note && !note.snapshots.length) {
        const latest = await latestSnapshot(access.id, note.id);
        if (latest) note.snapshots = [latest];
      }
      if (typeof input.restoreSnapshotId === "string") {
        const snapshot =
          note?.snapshots.find(
            (snapshot) => snapshot.id === input.restoreSnapshotId,
          ) ||
          (await savedSnapshot(access.id, item.id, input.restoreSnapshotId));
        if (!snapshot || snapshot.content !== item.content)
          throw new WorkspaceError(
            "This saved version is unavailable or its content changed. Reopen version history before restoring.",
            409,
          );
      }
    }
    const trash: TrashCommit = {};
    let updated: Workspace;
    if (input.action === "restore") {
      const restoreMutation = validateMutation(mutation);
      const result = await prepareTrashRestore(
        access.id,
        current,
        restoreMutation.id!,
      );
      updated = result.workspace;
      trash.restore = result.restore;
    } else {
      if (input.action === "delete")
        await assertTrashIdAvailable(access.id, trashId);
      updated = applyMutation(
        current,
        prepareMutation(mutation, current, access),
        new Date().toISOString(),
        access.user ? accountPersonId(access.user.id) : "guest",
      );
      if (input.action === "delete")
        trash.deleted = captureDeletion(
          current,
          updated,
          input.entity as Entity,
          input.id as string,
          trashId,
        );
    }
    for (const task of updated.tasks) {
      const assignee = updated.people.find(
        (person) => person.id === task.assigneeId,
      );
      if (
        assignee?.userId &&
        assignee.inactive &&
        current.tasks.find((existing) => existing.id === task.id)
          ?.assigneeId !== task.assigneeId
      )
        throw new WorkspaceError(
          "This account is no longer a member. Choose an active member or another assignment label.",
        );
    }
    for (const note of updated.notes) {
      const owner = updated.people.find(
        (person) => person.id === note.decision?.ownerId,
      );
      if (
        owner?.userId &&
        owner.inactive &&
        current.notes.find((existing) => existing.id === note.id)?.decision
          ?.ownerId !== note.decision?.ownerId
      )
        throw new WorkspaceError(
          "This account is no longer a member. Choose an active decision owner or leave it unassigned.",
        );
    }
    if (
      await commitWorkspace(
        access,
        current,
        updated,
        operationId,
        hash,
        input.action === "import",
        trash,
      )
    )
      return {
        workspace: activeWorkspace(updated),
        warnings: trash.restore?.warnings || [],
      };
    await new Promise((resolve) =>
      setTimeout(resolve, 15 + Math.floor(Math.random() * 35) * (attempt + 1)),
    );
  }
  throw new WorkspaceError(
    "Several changes are being saved at once. Your change was not saved; try again.",
    409,
  );
}

export function routeError(error: unknown): Response {
  if (error instanceof WorkspaceError)
    return Response.json(
      { error: error.message },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  if (error instanceof SyntaxError)
    return Response.json(
      { error: "The request must contain valid JSON." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  const message = error instanceof Error ? error.message : "";
  const cause =
    error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : "";
  if (`${message} ${cause}`.includes("no such table"))
    return Response.json(
      {
        error:
          "Local account storage needs its database setup. Run the ProjectAnvil launcher to apply the database migrations.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  console.error("Workspace request failed:", error);
  return Response.json(
    {
      error:
        "The server could not save or load the workspace. Please try again.",
    },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}

export async function readMutationRequest(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new WorkspaceError("Send this request as application/json.", 415);
  const bytes = await readBoundedBody(
    request,
    4_000_000,
    "This request is too large. Keep mutation bodies below 4 MB.",
  );
  const text = new TextDecoder().decode(bytes);
  const mutation = JSON.parse(text);
  if (mutation?.action === "import" && bytes.byteLength > 2_000_000)
    throw new WorkspaceError(
      "This import is too large. Keep workspace imports below 2 MB.",
      413,
    );
  return mutation;
}
