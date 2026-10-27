import type {
  AccountContext,
  AccountUser,
  WorkspaceAccess,
} from "./access-types";
import type { DraftScope } from "./draft-store";
import type { Media, Workspace } from "./types";
import { validateWorkspace } from "./workspace-model";
import {
  canonicalMediaAddress,
  canonicalWorkspaceMedia,
  scopedWorkspaceMedia,
} from "./workspace-transport";

export const OFFLINE_LIMITS = {
  workspaces: 8,
  workspaceBytes: 2_000_000,
  attachmentBytes: 25_000_000,
  attachmentsPerWorkspace: 100,
  totalAttachmentBytes: 100_000_000,
} as const;

export class OfflineStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfflineStorageError";
  }
}

export interface OfflineAttachment {
  id: string;
  fingerprint: string;
  size: number;
  type: string;
}

/** This is an explicit readable device copy, never an authentication session. */
export interface OfflineWorkspaceCopy {
  kind: "workspace";
  version: 1;
  scope: DraftScope;
  user: AccountUser | null;
  access: WorkspaceAccess;
  workspace: Workspace | null;
  token: string;
  enabledAt: string;
  savedAt: string;
  bytes: number;
  attachments: OfflineAttachment[];
}

interface ResumePointer {
  kind: "resume";
  accountId: string;
  workspaceId: string;
}

export type OfflineMetadata = OfflineWorkspaceCopy | ResumePointer;
export interface OfflineStorageChange {
  put?: { key: string; value: OfflineMetadata }[];
  remove?: string[];
  putMedia?: { key: string; value: Blob }[];
  removeMedia?: string[];
}

/** Metadata and attachment changes commit together, or none of them do. */
export interface OfflineStorageAdapter {
  read(key: string): Promise<OfflineMetadata | undefined>;
  readMedia(key: string): Promise<Blob | undefined>;
  mutate(
    update: (current: Map<string, OfflineMetadata>) => OfflineStorageChange,
  ): Promise<void>;
}

export interface OfflineResume {
  account: AccountContext;
  activeId: string;
  savedAt: string;
}

const resumeKey = "resume";
const identifier = /^[A-Za-z0-9_-]{1,120}$/;
const roles = new Set(["owner", "admin", "editor", "viewer"]);
const kinds = new Set(["guest", "personal", "team"]);
const listeners = new Set<() => void>();
let channel: BroadcastChannel | undefined;

function installChannel() {
  if (
    channel ||
    typeof window === "undefined" ||
    typeof BroadcastChannel === "undefined"
  )
    return;
  channel = new BroadcastChannel("projectanvil-offline-changed");
  channel.onmessage = () => {
    for (const listener of listeners) listener();
  };
}

function changed() {
  installChannel();
  for (const listener of listeners) listener();
  channel?.postMessage("changed");
}

export function subscribeOfflineStorage(listener: () => void): () => void {
  installChannel();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function scopeKey(scope: DraftScope): string {
  if (!identifier.test(scope.accountId) || !identifier.test(scope.workspaceId))
    throw new OfflineStorageError("Choose a valid offline workspace.");
  return `workspace:${scope.accountId}:${scope.workspaceId}`;
}

function mediaKey(scope: DraftScope, id: string): string {
  if (!identifier.test(id))
    throw new OfflineStorageError("Choose a valid offline attachment.");
  return `${scopeKey(scope)}:media:${id}`;
}

function userCopy(user: AccountUser | null): AccountUser | null {
  if (!user) return null;
  if (
    !identifier.test(user.id) ||
    typeof user.username !== "string" ||
    user.username.length > 30 ||
    typeof user.name !== "string" ||
    user.name.length > 300
  )
    throw new OfflineStorageError(
      "The account could not be kept for offline use.",
    );
  // Email, sessions, invitations, passwords, and tokens have no offline purpose.
  return { id: user.id, username: user.username, name: user.name, email: "" };
}

function accessCopy(access: WorkspaceAccess): WorkspaceAccess {
  if (
    !identifier.test(access.id) ||
    typeof access.name !== "string" ||
    access.name.length > 300 ||
    !roles.has(access.role) ||
    !kinds.has(access.kind)
  )
    throw new OfflineStorageError(
      "The workspace access record is unavailable.",
    );
  const projectRoles = Object.fromEntries(
    Object.entries(access.projectRoles || {}).filter(
      ([id, role]) =>
        identifier.test(id) && ["viewer", "editor"].includes(role),
    ),
  ) as WorkspaceAccess["projectRoles"];
  return {
    id: access.id,
    name: access.name,
    kind: access.kind,
    role: access.role,
    ...(access.ownerId && identifier.test(access.ownerId)
      ? { ownerId: access.ownerId }
      : {}),
    securityRevision:
      Number.isSafeInteger(access.securityRevision) &&
      (access.securityRevision || 0) >= 0
        ? access.securityRevision || 0
        : 0,
    projectRoles,
  };
}

function permissionKey(access: WorkspaceAccess): string {
  return JSON.stringify([
    access.kind,
    access.role,
    access.ownerId || "",
    access.securityRevision || 0,
    Object.entries(access.projectRoles || {}).sort(([a], [b]) =>
      a.localeCompare(b),
    ),
  ]);
}

function accountAccess(scope: DraftScope, account: AccountContext) {
  if ((account.user?.id || "guest") !== scope.accountId)
    throw new OfflineStorageError(
      "The offline copy belongs to another account.",
    );
  const access = account.workspaces.find(
    (item) => item.id === scope.workspaceId,
  );
  if (!access)
    throw new OfflineStorageError("This account no longer has this workspace.");
  return { access: accessCopy(access), user: userCopy(account.user) };
}

function snapshotCopy(
  workspace: Workspace,
  workspaceId: string,
): {
  workspace: Workspace;
  bytes: number;
} {
  let serialized: string;
  try {
    serialized = JSON.stringify(
      canonicalWorkspaceMedia(workspace, workspaceId),
    );
  } catch {
    throw new OfflineStorageError(
      "The workspace could not be copied for offline use.",
    );
  }
  const bytes = new TextEncoder().encode(serialized).byteLength;
  if (bytes > OFFLINE_LIMITS.workspaceBytes)
    throw new OfflineStorageError(
      "This workspace is too large for an offline copy. Export a backup before reducing its size.",
    );
  try {
    return { workspace: validateWorkspace(JSON.parse(serialized)), bytes };
  } catch {
    throw new OfflineStorageError(
      "The offline workspace copy could not be verified.",
    );
  }
}

function workspaceRecords(current: Map<string, OfflineMetadata>) {
  return [...current.entries()].filter(
    (entry): entry is [string, OfflineWorkspaceCopy] =>
      entry[1].kind === "workspace",
  );
}

/** Only local authorized download routes are eligible; remote URLs stay online. */
export function offlineMediaUrl(
  file: Media,
  workspaceId?: string,
): string | null {
  if (identifier.test(file.id) && file.url === `/api/media/${file.id}`)
    return file.url;
  if (!workspaceId) return null;
  try {
    canonicalMediaAddress(file, workspaceId);
    return file.url;
  } catch {
    return null;
  }
}

function fingerprint(file: Media, workspaceId: string): string {
  return JSON.stringify([
    file.id,
    canonicalMediaAddress(file, workspaceId),
    file.type,
    file.size,
    file.createdAt,
  ]);
}

function attachmentsToRemove(copy: OfflineWorkspaceCopy): string[] {
  return copy.attachments.map((item) => mediaKey(copy.scope, item.id));
}

/** Injectable persistence keeps failure and isolation tests independent of real state. */
export function createOfflineStore(adapter: OfflineStorageAdapter) {
  async function readWorkspace(
    scope: DraftScope,
  ): Promise<OfflineWorkspaceCopy | null> {
    const value = await adapter.read(scopeKey(scope));
    if (!value || value.kind !== "workspace") return null;
    if (
      value.version !== 1 ||
      value.scope.accountId !== scope.accountId ||
      value.scope.workspaceId !== scope.workspaceId
    )
      throw new OfflineStorageError(
        "This offline copy is invalid. Remove it and save a fresh copy.",
      );
    const copy = structuredClone(value);
    copy.user = userCopy(copy.user);
    copy.access = accessCopy(copy.access);
    if (copy.workspace)
      copy.workspace = scopedWorkspaceMedia(
        snapshotCopy(copy.workspace, scope.workspaceId).workspace,
        scope.workspaceId,
      );
    return copy;
  }

  async function saveWorkspace(
    scope: DraftScope,
    account: AccountContext,
    workspace: Workspace,
    enable: boolean,
    rollbackToken?: string,
  ): Promise<OfflineWorkspaceCopy | null> {
    const key = scopeKey(scope);
    const identity = accountAccess(scope, account);
    const snapshot = snapshotCopy(workspace, scope.workspaceId);
    let saved: OfflineWorkspaceCopy | null = null;
    await adapter.mutate((current) => {
      const previous = current.get(key);
      const copy = previous?.kind === "workspace" ? previous : undefined;
      if (!copy && !enable) return {};
      const rollback = rollbackToken !== undefined;
      if (
        rollback &&
        (!copy ||
          !rollbackToken ||
          copy.token !== rollbackToken ||
          permissionKey(copy.access) !== permissionKey(identity.access))
      )
        return {};
      if (
        !copy &&
        workspaceRecords(current).length >= OFFLINE_LIMITS.workspaces
      )
        throw new OfflineStorageError(
          `Keep up to ${OFFLINE_LIMITS.workspaces} workspaces offline. Remove an unused copy first.`,
        );
      if (
        copy &&
        ((copy.access.securityRevision || 0) >
          (identity.access.securityRevision || 0) ||
          (!rollback &&
            permissionKey(copy.access) === permissionKey(identity.access) &&
            copy.workspace &&
            copy.workspace.revision > snapshot.workspace.revision))
      ) {
        saved = structuredClone(copy);
        return {};
      }
      const sameAccess =
        !!copy && permissionKey(copy.access) === permissionKey(identity.access);
      const media = new Map(
        snapshot.workspace.media.map((file) => [file.id, file]),
      );
      const retained =
        sameAccess && !rollback
          ? copy.attachments.filter((item) => {
              const file = media.get(item.id);
              return (
                !!file &&
                offlineMediaUrl(file, scope.workspaceId) &&
                fingerprint(file, scope.workspaceId) === item.fingerprint
              );
            })
          : [];
      const retainedIds = new Set(retained.map((item) => item.id));
      const removed = (copy?.attachments || [])
        .filter((item) => !retainedIds.has(item.id))
        .map((item) => mediaKey(scope, item.id));
      const now = new Date().toISOString();
      saved = {
        kind: "workspace",
        version: 1,
        scope: structuredClone(scope),
        ...identity,
        workspace: snapshot.workspace,
        token: sameAccess && !rollback ? copy.token : crypto.randomUUID(),
        enabledAt: copy?.enabledAt || now,
        savedAt: now,
        bytes: snapshot.bytes,
        attachments: retained,
      };
      return {
        put: [
          { key, value: saved },
          { key: resumeKey, value: { kind: "resume", ...scope } },
        ],
        removeMedia: removed,
      };
    });
    changed();
    if (saved) {
      const result = structuredClone(saved) as OfflineWorkspaceCopy;
      if (result.workspace)
        result.workspace = scopedWorkspaceMedia(
          result.workspace,
          scope.workspaceId,
        );
      return result;
    }
    return null;
  }

  async function clearResume() {
    await adapter.mutate(() => ({ remove: [resumeKey] }));
    changed();
  }

  async function forgetWorkspace(scope: DraftScope) {
    const key = scopeKey(scope);
    await adapter.mutate((current) => {
      const value = current.get(key);
      const resume = current.get(resumeKey);
      return {
        remove: [
          key,
          ...(resume?.kind === "resume" &&
          resume.accountId === scope.accountId &&
          resume.workspaceId === scope.workspaceId
            ? [resumeKey]
            : []),
        ],
        removeMedia:
          value?.kind === "workspace" ? attachmentsToRemove(value) : [],
      };
    });
    changed();
  }

  async function forgetAccount(accountId: string) {
    if (!identifier.test(accountId))
      throw new OfflineStorageError("Choose a valid offline account.");
    await adapter.mutate((current) => {
      const copies = workspaceRecords(current).filter(
        ([, copy]) => copy.scope.accountId === accountId,
      );
      const resume = current.get(resumeKey);
      return {
        remove: [
          ...copies.map(([key]) => key),
          ...(resume?.kind === "resume" && resume.accountId === accountId
            ? [resumeKey]
            : []),
        ],
        removeMedia: copies.flatMap(([, copy]) => attachmentsToRemove(copy)),
      };
    });
    changed();
  }

  async function reconcileAccount(account: AccountContext) {
    const accountId = account.user?.id || "guest";
    const user = userCopy(account.user);
    await adapter.mutate((current) => {
      const put: NonNullable<OfflineStorageChange["put"]> = [];
      const remove: string[] = [];
      const removeMedia: string[] = [];
      const resume = current.get(resumeKey);
      if (resume?.kind === "resume" && resume.accountId !== accountId)
        remove.push(resumeKey);
      for (const [key, copy] of workspaceRecords(current)) {
        if (copy.scope.accountId !== accountId) continue;
        const fresh = account.workspaces.find(
          (item) => item.id === copy.scope.workspaceId,
        );
        if (!fresh) {
          remove.push(key);
          removeMedia.push(...attachmentsToRemove(copy));
          if (
            resume?.kind === "resume" &&
            resume.workspaceId === copy.scope.workspaceId
          )
            remove.push(resumeKey);
          continue;
        }
        const access = accessCopy(fresh);
        if (
          (access.securityRevision || 0) < (copy.access.securityRevision || 0)
        ) {
          // A restored database and an older response cannot be distinguished
          // by the counter alone. Drop private snapshots rather than resuming
          // former grants; a fresh explicit offline save is required.
          remove.push(key);
          removeMedia.push(...attachmentsToRemove(copy));
          if (
            resume?.kind === "resume" &&
            resume.accountId === accountId &&
            resume.workspaceId === copy.scope.workspaceId
          )
            remove.push(resumeKey);
          continue;
        }
        if (permissionKey(access) === permissionKey(copy.access)) {
          put.push({ key, value: { ...copy, access, user } });
          continue;
        }
        // Keep only the opt-in choice. No stale private records or files survive
        // a changed access epoch while the filtered server snapshot is loading.
        removeMedia.push(...attachmentsToRemove(copy));
        put.push({
          key,
          value: {
            ...copy,
            access,
            user,
            workspace: null,
            bytes: 0,
            attachments: [],
            token: crypto.randomUUID(),
          },
        });
      }
      return { put, remove: [...new Set(remove)], removeMedia };
    });
    changed();
  }

  async function readResume(): Promise<OfflineResume | null> {
    let result: OfflineResume | null = null;
    // The same transaction reads identity, available workspaces, and selection.
    await adapter.mutate((current) => {
      const resume = current.get(resumeKey);
      if (resume?.kind !== "resume") return {};
      const copies = workspaceRecords(current)
        .map(([, copy]) => copy)
        .filter(
          (copy) =>
            copy.scope.accountId === resume.accountId && !!copy.workspace,
        );
      const selected =
        copies.find((copy) => copy.scope.workspaceId === resume.workspaceId) ||
        copies.sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
      if (!selected) return {};
      result = {
        account: {
          user: userCopy(selected.user),
          workspaces: copies.map((copy) => accessCopy(copy.access)),
          invitations: [],
        },
        activeId: selected.scope.workspaceId,
        savedAt: selected.savedAt,
      };
      return {};
    });
    return result;
  }

  async function cacheMedia(
    scope: DraftScope,
    id: string,
    blob: Blob,
    token: string,
  ) {
    if (!(blob instanceof Blob) || blob.size > OFFLINE_LIMITS.attachmentBytes)
      throw new OfflineStorageError(
        "This attachment is too large to keep offline.",
      );
    const key = scopeKey(scope);
    const binaryKey = mediaKey(scope, id);
    await adapter.mutate((current) => {
      const copy = current.get(key);
      const file =
        copy?.kind === "workspace" &&
        copy.workspace?.media.find((item) => item.id === id);
      if (
        !copy ||
        copy.kind !== "workspace" ||
        copy.token !== token ||
        !file ||
        !offlineMediaUrl(file, scope.workspaceId)
      )
        throw new OfflineStorageError(
          "Refresh this workspace's access before keeping the attachment offline.",
        );
      if (
        blob.size !== file.size ||
        (blob.type &&
          blob.type.split(";")[0].toLowerCase() !==
            file.type.split(";")[0].toLowerCase())
      )
        throw new OfflineStorageError(
          "The downloaded attachment could not be verified.",
        );
      const earlier = copy.attachments.find((item) => item.id === id);
      if (
        !earlier &&
        copy.attachments.length >= OFFLINE_LIMITS.attachmentsPerWorkspace
      )
        throw new OfflineStorageError(
          "This workspace has reached its offline attachment limit.",
        );
      const total = workspaceRecords(current).reduce(
        (sum, [, value]) =>
          sum + value.attachments.reduce((size, item) => size + item.size, 0),
        0,
      );
      if (
        total - (earlier?.size || 0) + blob.size >
        OFFLINE_LIMITS.totalAttachmentBytes
      )
        throw new OfflineStorageError(
          "Offline attachment storage is full. Remove an unused offline copy first.",
        );
      const attachment: OfflineAttachment = {
        id,
        fingerprint: fingerprint(file, scope.workspaceId),
        size: blob.size,
        type: file.type,
      };
      return {
        put: [
          {
            key,
            value: {
              ...copy,
              attachments: [
                ...copy.attachments.filter((item) => item.id !== id),
                attachment,
              ],
            },
          },
        ],
        putMedia: [{ key: binaryKey, value: blob }],
      };
    });
    changed();
  }

  async function readMedia(
    scope: DraftScope,
    id: string,
  ): Promise<Blob | null> {
    const copy = await readWorkspace(scope);
    const file = copy?.workspace?.media.find((item) => item.id === id);
    const stored = copy?.attachments.find((item) => item.id === id);
    if (
      !copy ||
      !file ||
      !stored ||
      stored.fingerprint !== fingerprint(file, scope.workspaceId)
    )
      return null;
    const blob = await adapter.readMedia(mediaKey(scope, id));
    if (!blob || blob.size !== stored.size) return null;
    const latest = await readWorkspace(scope);
    return latest?.token === copy.token &&
      latest.workspace?.media.some(
        (item) =>
          item.id === id &&
          fingerprint(item, scope.workspaceId) === stored.fingerprint,
      ) &&
      latest.attachments.some((item) => item.id === id)
      ? blob
      : null;
  }

  return {
    readWorkspace,
    enable: (
      scope: DraftScope,
      account: AccountContext,
      workspace: Workspace,
    ) => saveWorkspace(scope, account, workspace, true),
    update: (
      scope: DraftScope,
      account: AccountContext,
      workspace: Workspace,
    ) => saveWorkspace(scope, account, workspace, false),
    refreshAfterRollback: (
      scope: DraftScope,
      account: AccountContext,
      workspace: Workspace,
      expectedToken: string,
    ) =>
      typeof expectedToken === "string" && expectedToken
        ? saveWorkspace(scope, account, workspace, false, expectedToken)
        : Promise.resolve(null),
    readResume,
    clearResume,
    forgetWorkspace,
    forgetAccount,
    reconcileAccount,
    cacheMedia,
    readMedia,
  };
}

function storageFailure(cause: unknown): Error {
  if (cause instanceof OfflineStorageError) return cause;
  return new OfflineStorageError(
    "This browser could not save the offline copy. Free device storage or allow browser storage, then try again. Keep this page open until pending changes are safely kept.",
  );
}

let opening: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(
        new OfflineStorageError(
          "Offline storage is unavailable in this browser.",
        ),
      );
      return;
    }
    const request = indexedDB.open("projectanvil-offline-v1", 1);
    let rejected = false;
    request.onupgradeneeded = () => {
      for (const name of ["metadata", "media"])
        if (!request.result.objectStoreNames.contains(name))
          request.result.createObjectStore(name, { keyPath: "key" });
    };
    request.onerror = () => reject(storageFailure(request.error));
    request.onblocked = () => {
      rejected = true;
      reject(
        new OfflineStorageError(
          "Close other ProjectAnvil tabs, then retry offline storage.",
        ),
      );
    };
    request.onsuccess = () => {
      const db = request.result;
      if (rejected) {
        db.close();
        return;
      }
      db.onversionchange = () => {
        db.close();
        opening = undefined;
      };
      resolve(db);
    };
  });
  void opening.catch(() => {
    opening = undefined;
  });
  return opening;
}

const browserAdapter: OfflineStorageAdapter = {
  async read(key) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("metadata", "readonly");
      const request = tx.objectStore("metadata").get(key);
      tx.oncomplete = () =>
        resolve(request.result?.value as OfflineMetadata | undefined);
      tx.onerror = () => reject(storageFailure(tx.error));
      tx.onabort = () => reject(storageFailure(tx.error));
    });
  },
  async readMedia(key) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("media", "readonly");
      const request = tx.objectStore("media").get(key);
      tx.oncomplete = () => resolve(request.result?.value as Blob | undefined);
      tx.onerror = () => reject(storageFailure(tx.error));
      tx.onabort = () => reject(storageFailure(tx.error));
    });
  },
  async mutate(update) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["metadata", "media"], "readwrite");
      const metadata = tx.objectStore("metadata"),
        media = tx.objectStore("media");
      const request = metadata.getAll();
      let failure: unknown;
      request.onsuccess = () => {
        try {
          const current = new Map<string, OfflineMetadata>(
            request.result.map(
              (row: { key: string; value: OfflineMetadata }) => [
                row.key,
                row.value,
              ],
            ),
          );
          const changes = update(current);
          for (const row of changes.put || []) metadata.put(row);
          for (const key of changes.remove || []) metadata.delete(key);
          for (const row of changes.putMedia || []) media.put(row);
          for (const key of changes.removeMedia || []) media.delete(key);
        } catch (cause) {
          failure = cause;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(storageFailure(failure || tx.error));
      tx.onabort = () => reject(storageFailure(failure || tx.error));
    });
  },
};

const browserStore = createOfflineStore(browserAdapter);
export const readOfflineWorkspace = browserStore.readWorkspace;
const resumeBlockKey = "projectanvil-offline-resume-blocked";

export interface OfflineResumeTicket {
  generation: number;
  marker: string | null | undefined;
}

/** Injectable fence keeps late saves from undoing a logout/denial marker. */
export function createOfflineResumeFence(storage: {
  read(): string | null;
  write(value: string | null): void;
}) {
  let generation = 0,
    blocked = false;
  const readMarker = (): string | null | undefined => {
    try {
      return storage.read();
    } catch {
      return undefined;
    }
  };
  return {
    capture: (): OfflineResumeTicket => ({ generation, marker: readMarker() }),
    current(ticket: OfflineResumeTicket): boolean {
      return ticket.generation === generation && readMarker() === ticket.marker;
    },
    block() {
      generation++;
      blocked = true;
      // A unique marker also identifies a newer block from another tab, even
      // when this operation began while an older denial was already present.
      try {
        storage.write(`blocked:${crypto.randomUUID()}`);
      } catch {
        /* The in-memory fence still protects this session. */
      }
    },
    complete(ticket: OfflineResumeTicket, explicitEnable: boolean): boolean {
      if (
        !explicitEnable ||
        ticket.generation !== generation ||
        readMarker() !== ticket.marker
      )
        return false;
      generation++;
      blocked = false;
      try {
        storage.write(`allowed:${crypto.randomUUID()}`);
      } catch {
        /* A stored denial remains authoritative if it could not be replaced. */
      }
      return true;
    },
    isBlocked() {
      const marker = readMarker();
      return (
        blocked ||
        (marker !== undefined &&
          marker !== null &&
          !marker.startsWith("allowed:"))
      );
    },
  };
}

const resumeFence = createOfflineResumeFence({
  read: () => localStorage.getItem(resumeBlockKey),
  write: (value) => {
    if (value === null) localStorage.removeItem(resumeBlockKey);
    else localStorage.setItem(resumeBlockKey, value);
  },
});
async function saveBrowserCopy(
  enable: boolean,
  scope: DraftScope,
  account: AccountContext,
  workspace: Workspace,
) {
  const ticket = resumeFence.capture();
  const copy = await (enable ? browserStore.enable : browserStore.update)(
    scope,
    account,
    workspace,
  );
  if (copy?.workspace) resumeFence.complete(ticket, enable);
  return copy;
}
export const enableOfflineWorkspace = (
  scope: DraftScope,
  account: AccountContext,
  workspace: Workspace,
) => saveBrowserCopy(true, scope, account, workspace);
export const updateOfflineWorkspace = (
  scope: DraftScope,
  account: AccountContext,
  workspace: Workspace,
) => saveBrowserCopy(false, scope, account, workspace);
export const refreshOfflineWorkspaceAfterRollback = (
  scope: DraftScope,
  account: AccountContext,
  workspace: Workspace,
  expectedToken: string,
) =>
  browserStore.refreshAfterRollback(scope, account, workspace, expectedToken);
export async function readOfflineResume(): Promise<OfflineResume | null> {
  const ticket = resumeFence.capture();
  if (resumeFence.isBlocked()) return null;
  const saved = await browserStore.readResume();
  return !resumeFence.isBlocked() && resumeFence.current(ticket) ? saved : null;
}
export async function clearOfflineResume() {
  resumeFence.block();
  await browserStore.clearResume();
}
export const forgetOfflineWorkspace = browserStore.forgetWorkspace;
export async function forgetOfflineAccount(accountId: string) {
  resumeFence.block();
  await browserStore.forgetAccount(accountId);
}
export const reconcileOfflineAccount = browserStore.reconcileAccount;
export const cacheOfflineMedia = browserStore.cacheMedia;
export const readOfflineMedia = browserStore.readMedia;
