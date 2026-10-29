/** Browser drafts are isolated by account, workspace, entity and record. */
export interface DraftScope {
  accountId: string;
  workspaceId: string;
}

export interface DraftRecord<T, B = T> {
  value: T;
  baseline: B | null;
  token: string;
  updatedAt: string;
  owner?: string;
}

export interface DraftRecoveryCopy {
  entity: string;
  id: string;
  record: DraftRecord<unknown, unknown>;
}

export interface DraftWriteResult<T, B = T> {
  record: DraftRecord<T, B>;
  persisted: boolean;
  error: string | null;
}

export interface DraftGuard {
  hasUnsaved: () => boolean;
  hasUnpersisted?: () => boolean;
  flush?: () => Promise<boolean>;
}

const prefix = "projectanvil-draft-v1:";
const memory = new Map<string, DraftRecord<unknown, unknown>>();
const knownReads = new Map<string, string>();
const failedWrites = new Set<string>();
const listeners = new Set<() => void>();
const guards = new Map<string, DraftGuard>();
let warningInstalled = false;
let writerId: string | undefined;

function scopePrefix(scope: DraftScope, entity?: string): string {
  const parts = [
    scope.accountId,
    scope.workspaceId,
    ...(entity ? [entity] : []),
  ];
  return prefix + parts.map(encodeURIComponent).join(":") + ":";
}

function keyFor(scope: DraftScope, entity: string, id: string): string {
  return scopePrefix(scope, entity) + encodeURIComponent(id);
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function validRecord(value: unknown): value is DraftRecord<unknown, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    "value" in value &&
    "baseline" in value &&
    "token" in value &&
    typeof value.token === "string" &&
    "updatedAt" in value &&
    typeof value.updatedAt === "string"
  );
}

function storedDraft(key: string): DraftRecord<unknown, unknown> | null {
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return validRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function changed(): void {
  for (const listener of listeners) listener();
}

function installWarning(): void {
  if (warningInstalled || typeof window === "undefined") return;
  warningInstalled = true;
  window.addEventListener("beforeunload", (event) => {
    if (
      !failedWrites.size &&
      ![...guards.values()].some((guard) => guard.hasUnsaved())
    )
      return;
    event.preventDefault();
    event.returnValue = "";
  });
}

export function readDraft<T, B = T>(
  scope: DraftScope,
  entity: string,
  id: string,
): DraftRecord<T, B> | null {
  const key = keyFor(scope, entity, id);
  // An unavailable/quota-limited storage write must not hide this session's edits.
  if (failedWrites.has(key))
    return (memory.get(key) as DraftRecord<T, B> | undefined) || null;
  const record = storedDraft(key) as DraftRecord<T, B> | null;
  if (record && !knownReads.has(key)) knownReads.set(key, record.token);
  return record;
}

/** Memory recovery is not a durable acknowledgement when browser storage failed. */
export function isDraftPersisted(
  scope: DraftScope,
  entity: string,
  id: string,
  token: string,
): boolean {
  const key = keyFor(scope, entity, id);
  return !failedWrites.has(key) && storedDraft(key)?.token === token;
}

export function writeDraft<T, B = T>(
  scope: DraftScope,
  entity: string,
  id: string,
  value: T,
  baseline: B | null,
): DraftWriteResult<T, B> {
  const key = keyFor(scope, entity, id);
  const previousOwnedToken = memory.get(key)?.token || knownReads.get(key);
  writerId ||= crypto.randomUUID();
  const record: DraftRecord<T, B> = {
    value: structuredClone(value),
    baseline: structuredClone(baseline),
    token: crypto.randomUUID(),
    updatedAt: new Date().toISOString(),
    owner: writerId,
  };
  memory.set(key, record);
  installWarning();
  try {
    const target = storage();
    if (!target) throw new Error("Draft storage is unavailable.");
    const displaced = storedDraft(key);
    if (
      entity !== "recovery-copies" &&
      displaced &&
      displaced.token !== previousOwnedToken &&
      displaced.token !== knownReads.get(key) &&
      JSON.stringify({
        value: displaced.value,
        baseline: displaced.baseline,
      }) !== JSON.stringify({ value, baseline })
    ) {
      // Keep one latest displaced copy per originating window, rather than an
      // archive entry for every keystroke. Never overwrite it unless that copy saves.
      const copyId = `${entity}:${id}:${displaced.owner || displaced.token}`;
      const copy: DraftRecord<DraftRecoveryCopy, null> = {
        value: { entity, id, record: displaced },
        baseline: null,
        token: crypto.randomUUID(),
        updatedAt: new Date().toISOString(),
        owner: writerId,
      };
      target.setItem(
        keyFor(scope, "recovery-copies", copyId),
        JSON.stringify(copy),
      );
    }
    target.setItem(key, JSON.stringify(record));
    failedWrites.delete(key);
    changed();
    return { record, persisted: true, error: null };
  } catch {
    failedWrites.add(key);
    changed();
    return {
      record,
      persisted: false,
      error:
        "This browser could not keep a recovery copy. Keep this page open until your changes save, or copy your text before leaving.",
    };
  }
}

/** A late save can only clear the exact draft version it sent. */
export function removeDraft(
  scope: DraftScope,
  entity: string,
  id: string,
  expectedToken?: string,
): boolean {
  const key = keyFor(scope, entity, id);
  const current = readDraft(scope, entity, id);
  if (expectedToken && current?.token !== expectedToken) return false;
  const persisted = storedDraft(key);
  if (expectedToken && persisted && persisted.token !== expectedToken) {
    if (memory.get(key)?.token === expectedToken) {
      memory.delete(key);
      failedWrites.delete(key);
      changed();
    }
    return false;
  }
  try {
    storage()?.removeItem(key);
  } catch {
    return false;
  }
  memory.delete(key);
  knownReads.delete(key);
  failedWrites.delete(key);
  changed();
  return true;
}

export function listDrafts<T, B = T>(
  scope: DraftScope,
  entity: string,
): { id: string; record: DraftRecord<T, B> }[] {
  const start = scopePrefix(scope, entity);
  const keys = new Set(
    [...memory.keys()].filter((key) => key.startsWith(start)),
  );
  try {
    const target = storage();
    for (let index = 0; target && index < target.length; index++) {
      const key = target.key(index);
      if (key?.startsWith(start)) keys.add(key);
    }
  } catch {
    /* In-memory drafts remain recoverable while this page is open. */
  }
  return [...keys]
    .flatMap((key) => {
      let id: string;
      try {
        id = decodeURIComponent(key.slice(start.length));
      } catch {
        return [];
      }
      const record = readDraft<T, B>(scope, entity, id);
      return record ? [{ id, record }] : [];
    })
    .sort((a, b) => b.record.updatedAt.localeCompare(a.record.updatedAt));
}

export function subscribeDrafts(listener: () => void): () => void {
  listeners.add(listener);
  const receive = (event: StorageEvent) => {
    if (!event.key || event.key.startsWith(prefix)) listener();
  };
  if (typeof window !== "undefined")
    window.addEventListener("storage", receive);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined")
      window.removeEventListener("storage", receive);
  };
}

export function registerDraftGuard(
  scope: DraftScope,
  id: string,
  guard: DraftGuard,
): () => void {
  const key = scopePrefix(scope) + id;
  guards.set(key, guard);
  installWarning();
  return () => {
    if (guards.get(key) === guard) guards.delete(key);
  };
}

export async function flushDraftGuards(scope: DraftScope): Promise<boolean> {
  const scoped = [...guards.entries()].filter(([key]) =>
    key.startsWith(scopePrefix(scope)),
  );
  const results = await Promise.all(
    scoped.map(async ([, guard]) => {
      if (!guard.hasUnsaved()) return true;
      try {
        return guard.flush ? await guard.flush() : false;
      } catch {
        return false;
      }
    }),
  );
  return results.every(Boolean);
}

/** A failed browser-storage write needs an explicit decision before in-app navigation. */
export function hasUnpersistedDrafts(scope: DraftScope): boolean {
  const start = scopePrefix(scope);
  return (
    [...failedWrites].some((key) => key.startsWith(start)) ||
    [...guards].some(
      ([key, guard]) => key.startsWith(start) && guard.hasUnpersisted?.(),
    )
  );
}

/** Reload only after saves settle and no newer or queued work remains. */
export async function prepareWorkspaceReload(
  scope: DraftScope,
): Promise<boolean> {
  if (!(await flushDraftGuards(scope))) return false;
  const start = scopePrefix(scope);
  return (
    !hasUnpersistedDrafts(scope) &&
    ![...guards].some(
      ([key, guard]) => key.startsWith(start) && guard.hasUnsaved(),
    ) &&
    listDrafts(scope, "mutations").length === 0
  );
}

/** Only explicit user discard should remove failed writes for an editor record. */
export function discardDraftMutations(
  scope: DraftScope,
  entity: string,
  recordId: string,
  options: { preserveQueuedDeletion?: boolean } = {},
): void {
  const pending = listDrafts<{
    action?: string;
    entity?: string;
    id?: string;
    item?: { id?: string };
  }>(scope, "mutations");
  // A queued delete still needs the earlier create/edits in order to reach the
  // server. Its receipt also makes an offline Undo possible.
  if (
    options.preserveQueuedDeletion &&
    pending.some(
      ({ record }) =>
        record.value.action === "delete" &&
        record.value.entity === entity &&
        record.value.id === recordId,
    )
  )
    return;
  for (const { id, record } of pending) {
    const mutation = record.value;
    if (
      mutation.entity === entity &&
      (mutation.id === recordId || mutation.item?.id === recordId)
    ) {
      removeDraft(scope, "mutations", id, record.token);
    }
  }
}
