import type { AccountUser, WorkspaceAccess } from "./access-types";
import type { DraftRecord } from "./draft-store";
import type { Mutation, Workspace } from "./types";
import {
  applyMutation,
  validateMutation,
  WorkspaceError,
} from "./workspace-model";
import { assertMutationAccess, assertMutationInputAccess } from "./permissions";
import {
  canonicalMediaMutation,
  canonicalMediaAddress,
  canonicalWorkspaceMedia,
  scopedWorkspaceMedia,
} from "./workspace-transport";

export interface OfflineQueueMetadata {
  offlineQueuedAt: string;
  offlineSequence: number;
}

export interface OfflineQueuedMutation {
  id: string;
  record: DraftRecord<Mutation, unknown>;
}

export interface OfflineConflict {
  id: string;
  reason: string;
  status: number;
}

export interface OfflineProjection {
  workspace: Workspace;
  applied: string[];
  conflicts: OfflineConflict[];
  warnings: string[];
}

const stamp = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

export function offlineQueueMetadata(
  entry: OfflineQueuedMutation,
): OfflineQueueMetadata {
  const base = entry.record.baseline as Partial<OfflineQueueMetadata> | null;
  return {
    offlineQueuedAt:
      base && stamp(base.offlineQueuedAt)
        ? base.offlineQueuedAt
        : entry.record.updatedAt,
    offlineSequence:
      base &&
      Number.isSafeInteger(base.offlineSequence) &&
      (base.offlineSequence || 0) > 0
        ? base.offlineSequence!
        : 0,
  };
}

/** Retry preserves queue position; a fresh edit follows every known queued edit. */
export function nextOfflineQueueMetadata(
  entries: OfflineQueuedMutation[],
  operationId: string,
  now = new Date().toISOString(),
): OfflineQueueMetadata {
  const existing = entries.find((entry) => entry.id === operationId);
  if (existing) return offlineQueueMetadata(existing);
  const metadata = entries.map(offlineQueueMetadata);
  const lastTime = Math.max(
    0,
    ...metadata.map((item) => Date.parse(item.offlineQueuedAt) || 0),
  );
  const sequence = Math.max(0, ...metadata.map((item) => item.offlineSequence));
  if (sequence >= Number.MAX_SAFE_INTEGER)
    throw new WorkspaceError(
      "The offline queue is full. Synchronize it first.",
    );
  return {
    offlineQueuedAt: new Date(
      Math.max(Date.parse(now) || Date.now(), lastTime + 1),
    ).toISOString(),
    offlineSequence: sequence + 1,
  };
}

/** The original outbox API lists newest first; dependencies need oldest first. */
export function orderedOfflineMutations(
  entries: OfflineQueuedMutation[],
): OfflineQueuedMutation[] {
  return [...entries].sort(compareQueueOrder);
}

function compareQueueOrder(
  left: OfflineQueuedMutation,
  right: OfflineQueuedMutation,
): number {
  const a = offlineQueueMetadata(left),
    b = offlineQueueMetadata(right);
  return (
    a.offlineQueuedAt.localeCompare(b.offlineQueuedAt) ||
    a.offlineSequence - b.offlineSequence ||
    left.id.localeCompare(right.id)
  );
}

/** A replay snapshot cannot revive a discarded intent or replace a newer version. */
export function queuedMutationSnapshotMatches(
  captured: OfflineQueuedMutation,
  current: DraftRecord<Mutation, unknown> | null,
): current is DraftRecord<Mutation, unknown> {
  return (
    !!current &&
    current.token === captured.record.token &&
    current.value?.operationId === captured.id
  );
}

/** Only an earlier intent covered by a newer confirmed save can be superseded. */
export function canSupersedeQueuedMutation(
  earlier: OfflineQueuedMutation,
  acknowledged: OfflineQueuedMutation,
  saved: Workspace,
): boolean {
  const previous = earlier.record.value,
    mutation = acknowledged.record.value;
  if (
    earlier.id === acknowledged.id ||
    compareQueueOrder(earlier, acknowledged) > 0 ||
    previous.action !== "upsert" ||
    mutation.action !== "upsert" ||
    !mutation.item ||
    !mutation.entity ||
    previous.entity !== mutation.entity ||
    previous.item?.id !== mutation.item.id
  )
    return false;
  const fields = (item: Mutation["item"]) =>
    Object.keys(item || {}).filter(
      (key) => !["id", "createdAt", "updatedAt"].includes(key),
    );
  const submitted = new Set(fields(mutation.item));
  if (!fields(previous.item).every((key) => submitted.has(key))) return false;
  const earlierComments =
    previous.item && "comments" in previous.item
      ? previous.item.comments
      : undefined;
  const confirmedComments =
    saved.tasks.find((task) => task.id === mutation.item?.id)?.comments || [];
  return (
    !Array.isArray(earlierComments) ||
    earlierComments.every(
      (comment) =>
        comment &&
        typeof comment === "object" &&
        "id" in comment &&
        "body" in comment &&
        confirmedComments.some(
          (savedComment) =>
            savedComment.id === comment.id &&
            savedComment.body === comment.body,
        ),
    )
  );
}

/** Server history and automatic follow-up IDs do not exist until acknowledgement. */
function removeUnconfirmedGeneratedRecords(
  previous: Workspace,
  projected: Workspace,
  mutation: Mutation,
): { workspace: Workspace; recurrencePending: boolean } {
  const explicitTaskId =
    mutation.action === "upsert" && mutation.entity === "tasks"
      ? mutation.item?.id
      : "";
  const oldTasks = new Set(previous.tasks.map((task) => task.id));
  const generated = new Set(
    projected.tasks
      .filter((task) => !oldTasks.has(task.id) && task.id !== explicitTaskId)
      .map((task) => task.id),
  );
  projected.tasks = projected.tasks.filter((task) => !generated.has(task.id));
  for (const task of projected.tasks)
    if (task.recurrenceNextId && generated.has(task.recurrenceNextId))
      delete task.recurrenceNextId;
  const oldRelationships = new Set(
    previous.relationships.map((item) => item.id),
  );
  const explicitRelationshipId =
    mutation.action === "upsert" && mutation.entity === "relationships"
      ? mutation.item?.id
      : "";
  projected.relationships = projected.relationships.filter(
    (item) =>
      oldRelationships.has(item.id) || item.id === explicitRelationshipId,
  );
  const oldNotes = new Map(previous.notes.map((note) => [note.id, note]));
  for (const note of projected.notes)
    note.snapshots = structuredClone(oldNotes.get(note.id)?.snapshots || []);
  // This is still a projection of the last confirmed server revision.
  projected.revision = previous.revision;
  return { workspace: projected, recurrencePending: generated.size > 0 };
}

export function projectOfflineMutation(
  current: Workspace,
  input: Mutation,
  access: WorkspaceAccess,
  user: AccountUser | null,
  queuedAt = new Date().toISOString(),
): { workspace: Workspace; warnings: string[] } {
  if (["restore", "import"].includes(input.action))
    throw new WorkspaceError(
      "Connect to the local server before importing a backup or restoring Trash.",
      409,
    );
  const canonical = canonicalWorkspaceMedia(current, access.id);
  const mutation = validateMutation(canonicalMediaMutation(input, access.id));
  if (
    mutation.action === "upsert" &&
    (typeof mutation.item?.id !== "string" || !mutation.item.id)
  )
    throw new WorkspaceError("This offline change needs a stable record ID.");
  const authorization = {
    id: access.id,
    kind: access.kind,
    role: access.role,
    user,
    securityRevision: access.securityRevision || 0,
    permissions: Object.entries(access.projectRoles || {}).map(
      ([projectId, role]) => ({
        projectId,
        restricted: true,
        members: user ? [{ userId: user.id, role }] : [],
      }),
    ),
  };
  assertMutationInputAccess(authorization, canonical, mutation);
  const updated = applyMutation(
    canonical,
    mutation,
    stamp(queuedAt) ? queuedAt : new Date().toISOString(),
    user ? `account_${user.id}` : "guest",
  );
  assertMutationAccess(authorization, canonical, updated, mutation);
  const projected = removeUnconfirmedGeneratedRecords(
    canonical,
    updated,
    mutation,
  );
  return {
    workspace: scopedWorkspaceMedia(projected.workspace, access.id),
    warnings: projected.recurrencePending
      ? [
          "The next recurring task will be created when this change synchronizes.",
        ]
      : [],
  };
}

/** Each intent keeps its original comparison base; conflicts are never rebased away. */
export function projectOfflineMutations(
  confirmed: Workspace,
  entries: OfflineQueuedMutation[],
  access: WorkspaceAccess,
  user: AccountUser | null,
): OfflineProjection {
  // Server and verified device snapshots already carry scoped attachment URLs.
  // With no pending edits, reuse that immutable snapshot to avoid unnecessary
  // deep copies and downstream rendering. Canonical metadata still normalizes.
  if (!entries.length) {
    const suffix = `?workspace=${encodeURIComponent(access.id)}`;
    const alreadyScoped = confirmed.media.every(
      (file) =>
        file.url === `${canonicalMediaAddress(file, access.id)}${suffix}`,
    );
    return {
      workspace: alreadyScoped
        ? confirmed
        : scopedWorkspaceMedia(confirmed, access.id),
      applied: [],
      conflicts: [],
      warnings: [],
    };
  }
  let workspace = scopedWorkspaceMedia(structuredClone(confirmed), access.id);
  const applied: string[] = [],
    conflicts: OfflineConflict[] = [],
    warnings = new Set<string>();
  for (const entry of orderedOfflineMutations(entries)) {
    try {
      if (entry.record.value.operationId !== entry.id)
        throw new WorkspaceError(
          "This queued change has an invalid receipt ID.",
        );
      const result = projectOfflineMutation(
        workspace,
        entry.record.value,
        access,
        user,
        offlineQueueMetadata(entry).offlineQueuedAt,
      );
      workspace = result.workspace;
      applied.push(entry.id);
      for (const warning of result.warnings) warnings.add(warning);
    } catch (cause) {
      conflicts.push({
        id: entry.id,
        reason:
          cause instanceof Error
            ? cause.message
            : "This queued change needs review before it can synchronize.",
        status: cause instanceof WorkspaceError ? cause.status : 400,
      });
    }
  }
  return { workspace, applied, conflicts, warnings: [...warnings] };
}
