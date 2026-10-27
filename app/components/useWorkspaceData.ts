"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Mutation, Workspace } from "../lib/types";
import {
  listDrafts,
  readDraft,
  isDraftPersisted,
  registerDraftGuard,
  removeDraft,
  subscribeDrafts,
  writeDraft,
  type DraftWriteResult,
} from "../lib/draft-store";
import { useDraftScope } from "./useRecoverableDraft";
import { useWorkspaceFetch, useWorkspaceScope } from "./WorkspaceScope";
import { recoverPendingOperation } from "../lib/editor-mutations";
import {
  cancelUnsentQueuedDeletion,
  claimQueuedMutation,
} from "../lib/queued-mutation-lock";
import {
  enableOfflineWorkspace,
  forgetOfflineWorkspace,
  refreshOfflineWorkspaceAfterRollback,
  readOfflineWorkspace,
  subscribeOfflineStorage,
  updateOfflineWorkspace,
  type OfflineWorkspaceCopy,
} from "../lib/offline-store";
import {
  nextOfflineQueueMetadata,
  orderedOfflineMutations,
  canSupersedeQueuedMutation,
  queuedMutationSnapshotMatches,
  projectOfflineMutations,
  type OfflineConflict,
} from "../lib/offline-projection";

class SaveError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The local server could not be reached. Retry when it is ready.";
}

/** Owns reads and acknowledged writes independently of the currently open page. */
export function useWorkspaceData() {
  const scopedFetch = useWorkspaceFetch();
  const { account, activeId, refreshAccount, isOffline, onConnectionChange } =
    useWorkspaceScope();
  const scope = useDraftScope();
  const access = account.workspaces.find((item) => item.id === activeId);
  const permissionEpoch = JSON.stringify([
    account.user?.id || "guest",
    activeId,
    access?.role,
    access?.securityRevision || 0,
    Object.entries(access?.projectRoles || {}).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  ]);
  const epoch = useRef(permissionEpoch);
  useLayoutEffect(() => {
    if (epoch.current !== permissionEpoch) {
      confirmed.current = null;
      latest.current = null;
      copy.current = null;
      etag.current = "";
    }
    epoch.current = permissionEpoch;
  }, [permissionEpoch]);
  const [workspaceEpoch, setWorkspaceEpoch] = useState(permissionEpoch);
  const [confirmedWorkspace, setConfirmedWorkspace] =
    useState<Workspace | null>(null);
  const [offlineCopy, setOfflineCopy] = useState<OfflineWorkspaceCopy | null>(
    null,
  );
  const [offlineError, setOfflineError] = useState("");
  const [offlineConflicts, setOfflineConflicts] = useState<OfflineConflict[]>(
    [],
  );
  const [offlineWarnings, setOfflineWarnings] = useState<string[]>([]);
  const confirmed = useRef<Workspace | null>(null);
  const copy = useRef<OfflineWorkspaceCopy | null>(null);
  const offline = useRef(isOffline);
  useLayoutEffect(() => {
    offline.current = isOffline;
  }, [isOffline]);
  const blockedAutomatic = useRef(new Set<string>());
  const synchronize = useRef<() => Promise<void>>(async () => {});
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(0);
  const [liveStatus, setLiveStatus] = useState<
    "connecting" | "live" | "reconnecting"
  >("connecting");
  const [restoreWarnings, setRestoreWarnings] = useState<string[]>([]);
  const latest = useRef<Workspace | null>(null);
  const alive = useRef(true);
  const reads = useRef(new AbortController());
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const inFlightRead = useRef<Promise<void> | null>(null);
  const etag = useRef("");

  const outboxIds = useSyncExternalStore(
    subscribeDrafts,
    useCallback(
      () =>
        listDrafts(scope, "mutations")
          .map((draft) => draft.id)
          .sort()
          .join(","),
      [scope],
    ),
    () => "",
  );
  const activeIds = new Set(outboxIds ? outboxIds.split(",") : []);
  const outboxSize = activeIds.size;

  const project = useCallback(() => {
    if (!confirmed.current || !access || epoch.current !== permissionEpoch)
      return null;
    const result = copy.current
      ? projectOfflineMutations(
          confirmed.current,
          listDrafts<Mutation, unknown>(scope, "mutations"),
          access,
          account.user,
        )
      : { workspace: confirmed.current, conflicts: [], warnings: [] };
    latest.current = result.workspace;
    if (alive.current) {
      setWorkspace(result.workspace);
      setWorkspaceEpoch(permissionEpoch);
      setOfflineConflicts(result.conflicts);
      setOfflineWarnings(result.warnings);
    }
    return result;
  }, [access, account.user, permissionEpoch, scope]);

  const receive = useCallback(
    (incoming: Workspace, authoritativeRollback = false) => {
      if (!alive.current || epoch.current !== permissionEpoch) return;
      const previous = confirmed.current;
      const rolledBack = !!previous && incoming.revision < previous.revision;
      if (rolledBack && !authoritativeRollback) return;
      confirmed.current = incoming;
      if (alive.current) setConfirmedWorkspace(incoming);
      project();
      const rollbackToken = rolledBack ? copy.current?.token : undefined;
      const persistCopy = async () => {
        if (rolledBack)
          return rollbackToken
            ? refreshOfflineWorkspaceAfterRollback(
                scope,
                account,
                incoming,
                rollbackToken,
              )
            : null;
        return updateOfflineWorkspace(scope, account, incoming);
      };
      void persistCopy()
        .then((saved) => {
          if (!alive.current || epoch.current !== permissionEpoch) return;
          copy.current = saved;
          setOfflineCopy(saved);
          setOfflineError("");
          project();
        })
        .catch((cause) => {
          if (alive.current) setOfflineError(messageOf(cause));
        });
    },
    [permissionEpoch, project, scope, account],
  );

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const saved = await readOfflineWorkspace(scope);
        if (cancelled || epoch.current !== permissionEpoch) return;
        copy.current = saved;
        setOfflineCopy(saved);
        const sameAccess =
          saved &&
          access &&
          saved.access.role === access.role &&
          (saved.access.securityRevision || 0) ===
            (access.securityRevision || 0);
        if (!confirmed.current && sameAccess && saved.workspace) {
          confirmed.current = saved.workspace;
          setConfirmedWorkspace(saved.workspace);
          project();
        } else if (confirmed.current && sameAccess) project();
        if (!saved && offline.current) {
          confirmed.current = null;
          latest.current = null;
          setWorkspace(null);
        }
      } catch (cause) {
        if (!cancelled) setOfflineError(messageOf(cause));
      }
    };
    void read();
    const unsubscribe = subscribeOfflineStorage(() => {
      void read();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [scope, access, permissionEpoch, project]);

  useEffect(() => {
    queueMicrotask(() => {
      project();
    });
  }, [outboxIds, project]);

  const load = useCallback((): Promise<void> => {
    if (inFlightRead.current) return inFlightRead.current;
    const operation = (async () => {
      const readBase = confirmed.current;
      try {
        const response = await scopedFetch("/api/state", {
          cache: "no-store",
          signal: reads.current.signal,
          headers: etag.current ? { "If-None-Match": etag.current } : {},
        });
        if (response.status !== 304) {
          const data = (await response.json()) as {
            workspace?: Workspace;
            error?: string;
          };
          if (!response.ok || !data.workspace) {
            if ([401, 403, 404, 409].includes(response.status)) {
              confirmed.current = null;
              latest.current = null;
              copy.current = null;
              void forgetOfflineWorkspace(scope).catch(() => undefined);
              if (alive.current) setWorkspace(null);
              void refreshAccount().catch(() => undefined);
            }
            throw new SaveError(
              data.error || "The workspace could not be loaded.",
              response.status,
            );
          }
          // Reconnection must refresh the cached identity's grants before any
          // queued editor intent or new private snapshot becomes authoritative.
          if (isOffline || offline.current) {
            await refreshAccount();
            if (epoch.current !== permissionEpoch) return;
          }
          receive(data.workspace, confirmed.current === readBase);
          etag.current = response.headers.get("etag") || "";
        }
        if (alive.current) {
          offline.current = false;
          onConnectionChange(false);
          setLoadError("");
          queueMicrotask(() => {
            void synchronize.current();
          });
        }
      } catch (error) {
        if (
          alive.current &&
          !(error instanceof Error && error.name === "AbortError")
        ) {
          setLoadError(messageOf(error));
          const unavailable =
            !(error instanceof SaveError) || error.status >= 500;
          offline.current = unavailable;
          onConnectionChange(unavailable);
        }
      }
    })();
    inFlightRead.current = operation;
    void operation.finally(() => {
      if (inFlightRead.current === operation) inFlightRead.current = null;
    });
    return operation;
  }, [
    scopedFetch,
    refreshAccount,
    receive,
    scope,
    onConnectionChange,
    isOffline,
    permissionEpoch,
  ]);

  useEffect(() => {
    alive.current = true;
    reads.current = new AbortController();
    // Strict Mode restarts effects before an aborted first read settles.
    inFlightRead.current = null;
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 10_000);
    const wake = () => {
      void load();
    };
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    return () => {
      alive.current = false;
      reads.current.abort();
      clearInterval(timer);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      // Writes keep their captured account/workspace headers and durable receipt ID.
      // A page switch must not abort an otherwise valid save.
    };
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    let cursor = "";
    let security = "";
    let failures = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const delay = (milliseconds: number) =>
      new Promise<void>((resolve) => {
        const finish = () => {
          if (retryTimer) clearTimeout(retryTimer);
          controller.signal.removeEventListener("abort", finish);
          resolve();
        };
        retryTimer = setTimeout(finish, milliseconds);
        controller.signal.addEventListener("abort", finish, { once: true });
      });
    void (async () => {
      while (!stopped) {
        try {
          if (document.hidden) {
            await delay(2_000);
            continue;
          }
          const response = await scopedFetch(
            `/api/live?since=${encodeURIComponent(cursor)}`,
            { cache: "no-store", signal: controller.signal },
          );
          const data = (await response.json()) as {
            cursor?: string;
            securityRevision?: number;
            role?: string;
            error?: string;
          };
          if (!response.ok || typeof data.cursor !== "string") {
            if ([401, 403, 404, 409].includes(response.status)) {
              if (!stopped) {
                latest.current = null;
                setWorkspace(null);
                await refreshAccount().catch(() => undefined);
              }
            }
            throw new Error(data.error || "Live updates could not connect.");
          }
          if (stopped) return;
          const permissions = `${data.securityRevision}:${data.role}`;
          if (security && permissions !== security) {
            etag.current = "";
            await refreshAccount().catch(() => undefined);
          }
          security = permissions;
          if (data.cursor !== cursor) {
            cursor = data.cursor;
            await load();
          }
          failures = 0;
          setLiveStatus("live");
        } catch {
          if (stopped) return;
          setLiveStatus("reconnecting");
          failures++;
          await delay(Math.min(15_000, 1_000 * 2 ** Math.min(failures - 1, 4)));
        }
      }
    })();
    return () => {
      stopped = true;
      controller.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [scopedFetch, load, refreshAccount]);

  const mutate = useCallback(
    async (input: Mutation): Promise<Workspace> => {
      let mutation: Mutation = structuredClone(input);
      if (mutation.action === "restore" && mutation.id) {
        const deletion = readDraft<Mutation, unknown>(
          scope,
          "mutations",
          mutation.id,
        );
        if (deletion?.value.action === "delete") {
          const metadata = deletion.baseline as {
            offlineNeverSent?: boolean;
          } | null;
          if (metadata?.offlineNeverSent) {
            const cancelled = await cancelUnsentQueuedDeletion(
              scope,
              mutation.id,
              deletion.token,
            );
            if (cancelled === "changed")
              throw new Error(
                "This queued deletion changed in another window. Review it before undoing.",
              );
            if (cancelled === "already-sent")
              throw new Error(
                "This deletion is already synchronizing. Wait for it to finish, then restore it.",
              );
            if (cancelled === "cancelled") {
              blockedAutomatic.current.delete(mutation.id);
              const restored = project()?.workspace;
              if (!restored)
                throw new Error("Reopen the workspace to finish Undo.");
              return restored;
            }
          }
          if (offline.current)
            return Promise.reject(
              new Error(
                "Reconnect to confirm this deletion before restoring it. Your recovery receipt is kept.",
              ),
            );
        }
      }
      if (offline.current && ["restore", "import"].includes(mutation.action))
        return Promise.reject(
          new Error(
            "Reconnect to the local server before restoring Trash or importing a workspace backup.",
          ),
        );
      if (mutation.action === "rename" && !Object.hasOwn(mutation, "base"))
        mutation.base = { name: latest.current?.name || "" };
      if (mutation.action === "upsert" || mutation.action === "delete") {
        if (!Object.hasOwn(mutation, "base")) {
          const id =
            mutation.action === "delete" ? mutation.id : mutation.item?.id;
          const record =
            mutation.entity &&
            latest.current?.[mutation.entity]?.find((item) => item.id === id);
          mutation.base = record
            ? (structuredClone(record) as unknown as Record<string, unknown>)
            : null;
        }
      }
      mutation = recoverPendingOperation(scope, mutation);
      mutation.operationId ||= crypto.randomUUID();
      const operationId = mutation.operationId;
      const existing = readDraft<Mutation, unknown>(
        scope,
        "mutations",
        operationId,
      );
      let persisted: DraftWriteResult<Mutation, unknown> =
        existing &&
        isDraftPersisted(scope, "mutations", operationId, existing.token)
          ? { record: existing, persisted: true, error: null }
          : writeDraft(scope, "mutations", operationId, mutation, {
              ...nextOfflineQueueMetadata(
                listDrafts<Mutation, unknown>(scope, "mutations"),
                operationId,
              ),
              offlineNeverSent: existing
                ? (existing.baseline as { offlineNeverSent?: boolean } | null)
                    ?.offlineNeverSent === true
                : offline.current,
            });
      if (alive.current) {
        setPending((count) => count + 1);
        if (persisted.error)
          setSaveErrors((errors) => ({
            ...errors,
            [operationId]: persisted.error!,
          }));
      }

      const operation = queue.current
        .catch(() => undefined)
        .then(async () => {
          const keepOnDevice = () => {
            if (
              !copy.current ||
              persisted.error ||
              !isDraftPersisted(
                scope,
                "mutations",
                operationId,
                persisted.record.token,
              ) ||
              !confirmed.current ||
              epoch.current !== permissionEpoch
            )
              return null;
            const projection = project();
            const conflict = projection?.conflicts.find(
              (item) => item.id === operationId,
            );
            if (conflict) throw new SaveError(conflict.reason, conflict.status);
            return projection?.workspace || null;
          };
          try {
            if (!readDraft(scope, "mutations", operationId)) {
              const current = project()?.workspace;
              if (current) return current;
              throw new Error(
                "This pending change was cancelled in another window.",
              );
            }
            if (offline.current && copy.current) {
              const queued = keepOnDevice();
              if (queued) return queued;
            }
            let saved: Workspace | undefined;
            const claim = await claimQueuedMutation(
              scope,
              operationId,
              persisted.record.token,
            ).catch((cause) => {
              throw new SaveError(messageOf(cause), 409);
            });
            if (claim.state === "missing") {
              const current = project()?.workspace;
              if (current) return current;
              throw new SaveError(
                "This pending change was cancelled in another window.",
                409,
              );
            }
            if (claim.state === "changed")
              throw new SaveError(
                "This pending change changed in another window. Review it before synchronizing.",
                409,
              );
            persisted = claim.draft;
            if (persisted.error) throw new SaveError(persisted.error, 400);
            for (let attempt = 0; attempt < 2; attempt++) {
              try {
                const response = await scopedFetch("/api/state", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(mutation),
                });
                const data = (await response.json()) as {
                  workspace?: Workspace;
                  error?: string;
                  warnings?: string[];
                };
                if (!response.ok || !data.workspace)
                  throw new SaveError(
                    data.error || "This change could not be saved.",
                    response.status,
                  );
                saved = data.workspace;
                if (
                  alive.current &&
                  mutation.action === "restore" &&
                  data.warnings?.length
                )
                  setRestoreWarnings((previous) => [
                    ...new Set([...previous, ...data.warnings!]),
                  ]);
                break;
              } catch (error) {
                if (
                  attempt ||
                  (error instanceof SaveError && error.status < 500)
                )
                  throw error;
                await new Promise((resolve) => setTimeout(resolve, 350));
              }
            }
            if (!saved) throw new Error("This change could not be saved.");
            removeDraft(
              scope,
              "mutations",
              operationId,
              persisted.record.token,
            );
            // A corrected editor save supersedes older failed intents only when it
            // covers every field they attempted. Unrelated unsaved fields stay recoverable.
            if (
              mutation.action === "upsert" &&
              mutation.item &&
              mutation.entity
            ) {
              const acknowledged = {
                id: operationId,
                record: persisted.record,
              };
              for (const older of listDrafts<Mutation, unknown>(
                scope,
                "mutations",
              )) {
                if (canSupersedeQueuedMutation(older, acknowledged, saved))
                  removeDraft(scope, "mutations", older.id, older.record.token);
              }
            }
            etag.current = "";
            receive(saved);
            blockedAutomatic.current.delete(operationId);
            if (alive.current)
              setSaveErrors((errors) => {
                const remaining = { ...errors };
                delete remaining[operationId];
                return remaining;
              });
            // A poll may already have delivered a later revision while this reply
            // was in flight. Editors must acknowledge against that newer state.
            return latest.current || saved;
          } catch (error) {
            if (!(error instanceof SaveError) || error.status >= 500) {
              offline.current = true;
              if (alive.current) onConnectionChange(true);
              const queued = keepOnDevice();
              if (queued) return queued;
            } else blockedAutomatic.current.add(operationId);
            if (alive.current)
              setSaveErrors((errors) => ({
                ...errors,
                [operationId]: messageOf(error),
              }));
            throw error;
          } finally {
            if (alive.current) setPending((count) => Math.max(0, count - 1));
          }
        });
      queue.current = operation.catch(() => undefined);
      return operation;
    },
    [receive, scope, scopedFetch, permissionEpoch, project, onConnectionChange],
  );

  const retrySaves = useCallback(async () => {
    const recovered = orderedOfflineMutations(
      listDrafts<Mutation, unknown>(scope, "mutations"),
    );
    blockedAutomatic.current.clear();
    for (const draft of recovered) {
      const current = readDraft<Mutation, unknown>(
        scope,
        "mutations",
        draft.id,
      );
      if (!queuedMutationSnapshotMatches(draft, current)) continue;
      try {
        await mutate(current.value);
      } catch {
        break;
      } // Leave conflicts visible and keep the remaining recovery copies.
    }
  }, [scope, mutate]);

  const syncing = useRef(false);
  useLayoutEffect(() => {
    synchronize.current = async () => {
      if (syncing.current || offline.current || !copy.current) return;
      syncing.current = true;
      try {
        for (const entry of orderedOfflineMutations(
          listDrafts<Mutation, unknown>(scope, "mutations"),
        )) {
          if (blockedAutomatic.current.has(entry.id)) break;
          const current = readDraft<Mutation, unknown>(
            scope,
            "mutations",
            entry.id,
          );
          if (!queuedMutationSnapshotMatches(entry, current)) continue;
          if (["import", "restore"].includes(current.value.action)) {
            blockedAutomatic.current.add(entry.id);
            setSaveErrors((errors) => ({
              ...errors,
              [entry.id]:
                "This server action needs an explicit retry after reviewing the current workspace.",
            }));
            break;
          }
          try {
            await mutate(current.value);
          } catch {
            break;
          }
          if (offline.current) break;
        }
      } finally {
        syncing.current = false;
      }
    };
  }, [scope, mutate]);

  const enableOffline = useCallback(async () => {
    if (offline.current)
      throw new Error(
        "Connect to the local server before saving a fresh offline copy.",
      );
    // An explicit device copy must not reuse a tab's grants after another
    // window signs out or changes access.
    await refreshAccount();
    if (!alive.current || epoch.current !== permissionEpoch)
      throw new Error(
        "Workspace access changed. Reopen it before saving an offline copy.",
      );
    await load();
    if (
      !alive.current ||
      epoch.current !== permissionEpoch ||
      !confirmed.current ||
      offline.current
    )
      throw new Error(
        "Reconnect and verify workspace access before saving an offline copy.",
      );
    const saved = await enableOfflineWorkspace(
      scope,
      account,
      confirmed.current,
    );
    copy.current = saved;
    setOfflineCopy(saved);
    setOfflineError("");
    project();
  }, [scope, account, project, refreshAccount, permissionEpoch, load]);
  const forgetOffline = useCallback(async () => {
    await forgetOfflineWorkspace(scope);
    copy.current = null;
    setOfflineCopy(null);
    project();
  }, [scope, project]);

  const rebaseQueuedChange = useCallback(
    async (
      id: string,
      token: string,
      reviewed: Record<string, unknown> | null,
    ) => {
      if (offline.current)
        throw new Error("Reconnect before applying reviewed changes.");
      blockedAutomatic.current.add(id);
      await queue.current;
      await load();
      if (offline.current)
        throw new Error(
          "The local server is unavailable. Your queued change is kept.",
        );
      const entry = readDraft<Mutation, unknown>(scope, "mutations", id);
      if (!entry || entry.token !== token)
        throw new Error(
          "This queued change changed in another window. Review it again.",
        );
      const mutation = structuredClone(entry.value);
      if (
        !["upsert", "delete"].includes(mutation.action) ||
        !mutation.entity ||
        mutation.base === null
      )
        throw new Error(
          "Review this change in its editor; it cannot replace an existing record here.",
        );
      const recordId = mutation.id || mutation.item?.id;
      const current = confirmed.current?.[mutation.entity]?.find(
        (item) => item.id === recordId,
      ) as unknown as Record<string, unknown> | undefined;
      if (!current || !reviewed)
        throw new Error(
          "This record is no longer available. Download the queued change to keep a copy.",
        );
      const keys =
        mutation.action === "delete"
          ? Object.keys(current)
          : Object.keys(mutation.item || {}).filter(
              (key) => !["id", "createdAt", "updatedAt"].includes(key),
            );
      if (
        keys.some(
          (key) =>
            JSON.stringify(current[key]) !== JSON.stringify(reviewed[key]),
        )
      )
        throw new Error(
          "The saved record changed while you were reviewing it. Review the latest values again.",
        );
      mutation.base = structuredClone(current);
      mutation.operationId = crypto.randomUUID();
      const staged = writeDraft(
        scope,
        "mutations",
        mutation.operationId,
        mutation,
        entry.baseline,
      );
      if (staged.error) throw new Error(staged.error);
      removeDraft(scope, "mutations", id, token);
      blockedAutomatic.current.delete(id);
      await mutate(mutation);
    },
    [scope, load, mutate],
  );

  useEffect(
    () =>
      registerDraftGuard(scope, "workspace-writes", {
        hasUnsaved: () => {
          const entries = listDrafts(scope, "mutations");
          return (
            entries.length > 0 &&
            (!copy.current ||
              entries.some(
                (entry) =>
                  !isDraftPersisted(
                    scope,
                    "mutations",
                    entry.id,
                    entry.record.token,
                  ),
              ))
          );
        },
        hasUnpersisted: () =>
          listDrafts(scope, "mutations").some(
            (entry) =>
              !isDraftPersisted(
                scope,
                "mutations",
                entry.id,
                entry.record.token,
              ),
          ),
        flush: async () => {
          await queue.current;
          return !listDrafts(scope, "mutations").length;
        },
      }),
    [scope],
  );

  return {
    workspace: workspaceEpoch === permissionEpoch ? workspace : null,
    confirmedWorkspace:
      workspaceEpoch === permissionEpoch ? confirmedWorkspace : null,
    offlineCopy,
    offlineError,
    offlineConflicts,
    offlineWarnings,
    isOffline,
    enableOffline,
    forgetOffline,
    rebaseQueuedChange,
    load,
    loadError,
    liveStatus,
    mutate,
    pending,
    restoreWarnings,
    clearRestoreWarnings: () => setRestoreWarnings([]),
    outboxSize,
    retrySaves,
    syncError:
      Object.entries(saveErrors).find(([id]) => activeIds.has(id))?.[1] ||
      (outboxSize && !pending && !offlineCopy
        ? "Unsaved changes are kept on this device. Retry saving when the server is ready."
        : ""),
  };
}
