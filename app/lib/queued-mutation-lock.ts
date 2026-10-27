import {
  isDraftPersisted,
  readDraft,
  removeDraft,
  writeDraft,
  type DraftScope,
  type DraftWriteResult,
} from "./draft-store";
import type { Mutation } from "./types";

export interface MutationLockManager {
  request<T>(name: string, work: () => T | Promise<T>): Promise<T>;
}

function browserLocks(): MutationLockManager | null {
  try {
    return typeof navigator !== "undefined" ? navigator.locks || null : null;
  } catch {
    return null;
  }
}

export function queuedMutationLockName(
  scope: DraftScope,
  operationId: string,
): string {
  return (
    "projectanvil-queued-mutation:" +
    [scope.accountId, scope.workspaceId, operationId]
      .map(encodeURIComponent)
      .join(":")
  );
}

async function coordinated<T>(
  scope: DraftScope,
  operationId: string,
  work: () => T,
  locks: MutationLockManager | null,
  requireLock: boolean,
): Promise<T> {
  const unavailable = () =>
    new Error(
      "Reconnect and synchronize this deletion before restoring it. This browser cannot coordinate an offline Undo safely.",
    );
  if (!locks) {
    if (requireLock) throw unavailable();
    return work();
  }
  let started = false;
  try {
    return await locks.request(
      queuedMutationLockName(scope, operationId),
      () => {
        started = true;
        return work();
      },
    );
  } catch (cause) {
    if (started) throw cause;
    if (requireLock) throw unavailable();
    return work();
  }
}

export type QueuedMutationClaim =
  | { state: "missing" }
  | { state: "changed" }
  | { state: "ready"; draft: DraftWriteResult<Mutation, unknown> };

/** Claim only the durable send marker; HTTP must happen after releasing this lock. */
export function claimQueuedMutation(
  scope: DraftScope,
  operationId: string,
  expectedToken: string,
  locks: MutationLockManager | null = browserLocks(),
): Promise<QueuedMutationClaim> {
  return coordinated<QueuedMutationClaim>(
    scope,
    operationId,
    () => {
      const current = readDraft<Mutation, unknown>(
        scope,
        "mutations",
        operationId,
      );
      if (!current) return { state: "missing" };
      if (
        current.token !== expectedToken ||
        current.value.operationId !== operationId
      )
        return { state: "changed" };
      const metadata = current.baseline as Record<string, unknown> | null;
      return {
        state: "ready",
        draft: metadata?.offlineNeverSent
          ? writeDraft(scope, "mutations", operationId, current.value, {
              ...metadata,
              offlineNeverSent: false,
            })
          : {
              record: current,
              persisted: isDraftPersisted(
                scope,
                "mutations",
                operationId,
                current.token,
              ),
              error: null,
            },
      };
    },
    locks,
    false,
  );
}

export type QueuedDeletionCancellation =
  | "cancelled"
  | "missing"
  | "already-sent"
  | "changed";

/** Undo and sender arbitration share a lock across every tab of this origin. */
export function cancelUnsentQueuedDeletion(
  scope: DraftScope,
  operationId: string,
  expectedToken: string,
  locks: MutationLockManager | null = browserLocks(),
): Promise<QueuedDeletionCancellation> {
  return coordinated<QueuedDeletionCancellation>(
    scope,
    operationId,
    () => {
      const current = readDraft<Mutation, unknown>(
        scope,
        "mutations",
        operationId,
      );
      if (!current) return "missing";
      if (
        current.value.action !== "delete" ||
        current.value.operationId !== operationId
      )
        return "changed";
      const metadata = current.baseline as {
        offlineNeverSent?: boolean;
      } | null;
      if (!metadata?.offlineNeverSent) return "already-sent";
      if (current.token !== expectedToken) return "changed";
      if (!removeDraft(scope, "mutations", operationId, current.token))
        throw new Error(
          "This queued deletion could not be cancelled. Its recovery copy is kept.",
        );
      return "cancelled";
    },
    locks,
    true,
  );
}
