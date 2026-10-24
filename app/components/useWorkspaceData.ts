"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Mutation, Workspace } from "../lib/types";
import {
  listDrafts,
  registerDraftGuard,
  removeDraft,
  subscribeDrafts,
  writeDraft,
} from "../lib/draft-store";
import { useDraftScope } from "./useRecoverableDraft";
import { useWorkspaceFetch, useWorkspaceScope } from "./WorkspaceScope";
import { recoverPendingOperation } from "../lib/editor-mutations";

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
  const { refreshAccount } = useWorkspaceScope();
  const scope = useDraftScope();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(0);
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

  const receive = useCallback((incoming: Workspace) => {
    const previous = latest.current;
    if (
      previous &&
      (incoming.revision < previous.revision ||
        (incoming.revision === previous.revision &&
          JSON.stringify(incoming.people) === JSON.stringify(previous.people)))
    )
      return;
    latest.current = incoming;
    if (alive.current) setWorkspace(incoming);
  }, []);

  const load = useCallback((): Promise<void> => {
    if (inFlightRead.current) return inFlightRead.current;
    const operation = (async () => {
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
              if (alive.current) setWorkspace(null);
              void refreshAccount().catch(() => undefined);
            }
            throw new Error(data.error || "The workspace could not be loaded.");
          }
          receive(data.workspace);
          etag.current = response.headers.get("etag") || "";
        }
        if (alive.current) setLoadError("");
      } catch (error) {
        if (
          alive.current &&
          !(error instanceof Error && error.name === "AbortError")
        )
          setLoadError(messageOf(error));
      }
    })();
    inFlightRead.current = operation;
    void operation.finally(() => {
      if (inFlightRead.current === operation) inFlightRead.current = null;
    });
    return operation;
  }, [scopedFetch, refreshAccount, receive]);

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
    return () => {
      alive.current = false;
      reads.current.abort();
      clearInterval(timer);
      window.removeEventListener("focus", wake);
      // Writes keep their captured account/workspace headers and durable receipt ID.
      // A page switch must not abort an otherwise valid save.
    };
  }, [load]);

  const mutate = useCallback(
    (input: Mutation): Promise<Workspace> => {
      let mutation: Mutation = structuredClone(input);
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
      const persisted = writeDraft(
        scope,
        "mutations",
        operationId,
        mutation,
        null,
      );
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
          try {
            let saved: Workspace | undefined;
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
              const submitted = Object.keys(mutation.item).filter(
                (key) => !["id", "createdAt", "updatedAt"].includes(key),
              );
              for (const older of listDrafts<Mutation>(scope, "mutations")) {
                const previous = older.record.value;
                if (
                  older.id === operationId ||
                  older.record.updatedAt > persisted.record.updatedAt ||
                  previous.action !== "upsert" ||
                  previous.entity !== mutation.entity ||
                  previous.item?.id !== mutation.item.id
                )
                  continue;
                const fields = Object.keys(previous.item || {}).filter(
                  (key) => !["id", "createdAt", "updatedAt"].includes(key),
                );
                const earlierComments =
                  previous.item && "comments" in previous.item
                    ? previous.item.comments
                    : undefined;
                const confirmedComments =
                  saved.tasks.find((task) => task.id === mutation.item?.id)
                    ?.comments || [];
                const keepsEarlierComments =
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
                  );
                if (
                  fields.every((key) => submitted.includes(key)) &&
                  keepsEarlierComments
                )
                  removeDraft(scope, "mutations", older.id, older.record.token);
              }
            }
            etag.current = "";
            receive(saved);
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
    [receive, scope, scopedFetch],
  );

  const retrySaves = useCallback(async () => {
    const recovered = listDrafts<Mutation>(scope, "mutations");
    for (const draft of recovered) {
      try {
        await mutate(draft.record.value);
      } catch {
        break;
      } // Leave conflicts visible and keep the remaining recovery copies.
    }
  }, [scope, mutate]);

  useEffect(
    () =>
      registerDraftGuard(scope, "workspace-writes", {
        hasUnsaved: () => listDrafts(scope, "mutations").length > 0,
        flush: async () => {
          await queue.current;
          return !listDrafts(scope, "mutations").length;
        },
      }),
    [scope],
  );

  return {
    workspace,
    load,
    loadError,
    mutate,
    pending,
    restoreWarnings,
    clearRestoreWarnings: () => setRestoreWarnings([]),
    outboxSize,
    retrySaves,
    syncError:
      Object.entries(saveErrors).find(([id]) => activeIds.has(id))?.[1] ||
      (outboxSize && !pending
        ? "Unsaved changes are kept on this device. Retry saving when the server is ready."
        : ""),
  };
}
