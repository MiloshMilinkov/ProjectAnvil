"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Canvas, FeatureProps, Mutation, Workspace } from "../lib/types";
import {
  discardDraftMutations,
  listDrafts,
  readDraft,
  registerDraftGuard,
  removeDraft,
  subscribeDrafts,
  writeDraft,
} from "../lib/draft-store";
import { useDraftScope } from "./useRecoverableDraft";
import { useWorkspaceFetch } from "./WorkspaceScope";

const entity = "canvases";

function sameCanvas(left: Canvas, right: Canvas): boolean {
  const cardFields = [
    "id",
    "type",
    "entityId",
    "text",
    "color",
    "x",
    "y",
    "width",
    "height",
  ] as const;
  const edgeFields = ["id", "from", "to", "label"] as const;
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.cards.length === right.cards.length &&
    left.edges.length === right.edges.length &&
    left.cards.every((card, index) =>
      cardFields.every((field) => card[field] === right.cards[index][field]),
    ) &&
    left.edges.every((edge, index) =>
      edgeFields.every((field) => edge[field] === right.edges[index][field]),
    )
  );
}

function isCanvas(value: unknown): value is Canvas {
  if (!value || typeof value !== "object") return false;
  const canvas = value as Partial<Canvas>;
  return (
    typeof canvas.id === "string" &&
    typeof canvas.title === "string" &&
    Array.isArray(canvas.cards) &&
    canvas.cards.length <= 500 &&
    canvas.cards.every(
      (card) =>
        card &&
        typeof card.id === "string" &&
        typeof card.text === "string" &&
        typeof card.color === "string" &&
        ["note", "task", "text", "media", "url"].includes(card.type) &&
        [card.x, card.y, card.width, card.height].every(Number.isFinite) &&
        (card.entityId === undefined || typeof card.entityId === "string"),
    ) &&
    Array.isArray(canvas.edges) &&
    canvas.edges.length <= 1500 &&
    canvas.edges.every(
      (edge) =>
        edge &&
        typeof edge.id === "string" &&
        typeof edge.from === "string" &&
        typeof edge.to === "string" &&
        typeof edge.label === "string",
    )
  );
}

/** Owns recoverable edits and the original server version used for conflict checks. */
export function useCanvasPersistence({
  canvases,
  revision,
  mutate,
  notify,
  preferredId,
}: {
  canvases: Canvas[];
  revision: number;
  mutate: FeatureProps["mutate"];
  notify: FeatureProps["notify"];
  preferredId?: string;
}) {
  const scope = useDraftScope();
  const scopedFetch = useWorkspaceFetch();
  const pendingOperations = useSyncExternalStore(
    subscribeDrafts,
    useCallback(
      () =>
        JSON.stringify(
          listDrafts<Mutation>(scope, "mutations")
            .filter(({ record }) => record.value?.entity === entity)
            .map(({ id, record }) => [id, record.token]),
        ),
      [scope],
    ),
    () => "[]",
  );
  const [initial] = useState(() => {
    const recovered = listDrafts<Canvas>(scope, entity).filter(
      ({ id, record }) =>
        isCanvas(record.value) &&
        record.value.id === id &&
        (record.baseline === null ||
          (isCanvas(record.baseline) && record.baseline.id === id)),
    );
    const id =
      preferredId && canvases.some((canvas) => canvas.id === preferredId)
        ? preferredId
        : canvases[0]?.id || recovered[0]?.id || "";
    return { recovered, id };
  });
  const [canvasId, setCanvasId] = useState(initial.id);
  const [localCanvas, setLocalCanvas] = useState<Canvas | null>(
    () =>
      initial.recovered.find((item) => item.id === initial.id)?.record.value ||
      null,
  );
  const [saving, setSaving] = useState(0);
  const [reloading, setReloading] = useState(false);
  const [snapshot, setSnapshot] = useState<{
    revision: number;
    canvases: Canvas[];
  } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [storageError, setStorageError] = useState("");
  const [recoveredIds, setRecoveredIds] = useState(
    () => new Set(initial.recovered.map((item) => item.id)),
  );
  const [draftOptions, setDraftOptions] = useState(() =>
    initial.recovered.map(({ id, record }) => ({
      id,
      title: record.value.title,
    })),
  );
  const effectiveCanvases =
    snapshot && snapshot.revision > revision ? snapshot.canvases : canvases;
  const serverById = useMemo(
    () => new Map(effectiveCanvases.map((canvas) => [canvas.id, canvas])),
    [effectiveCanvases],
  );
  const canvas = localCanvas || serverById.get(canvasId) || null;
  const canvasRef = useRef<Canvas | null>(canvas);
  const currentId = useRef(initial.id);
  const drafts = useRef(
    new Map(initial.recovered.map((item) => [item.id, item.record.value])),
  );
  const baselines = useRef(
    new Map<string, Canvas | null>([
      ...canvases.map((item) => [item.id, item] as const),
      ...initial.recovered.map(
        (item) => [item.id, item.record.baseline] as const,
      ),
    ]),
  );
  const persisted = useRef(
    new Map(
      initial.recovered.map((item) => [
        item.id,
        { value: item.record.value, token: item.record.token },
      ]),
    ),
  );
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);
  const reloadPending = useRef(false);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const persist = useCallback(
    (next: Canvas, force = false) => {
      const previous = persisted.current.get(next.id);
      if (!force && previous?.value === next) return previous.token;
      const result = writeDraft(
        scope,
        entity,
        next.id,
        next,
        baselines.current.get(next.id) || null,
      );
      persisted.current.set(next.id, {
        value: next,
        token: result.record.token,
      });
      if (alive.current) setStorageError(result.error || "");
      return result.record.token;
    },
    [scope],
  );

  const persistAll = useCallback(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = null;
    for (const value of drafts.current.values()) persist(value);
  }, [persist]);

  const local = useCallback(
    (next: Canvas, activate = true) => {
      if (!baselines.current.has(next.id)) baselines.current.set(next.id, null);
      drafts.current.set(next.id, next);
      setDraftOptions((current) => {
        const previous = current.find((item) => item.id === next.id);
        if (previous?.title === next.title) return current;
        return [
          ...current.filter((item) => item.id !== next.id),
          { id: next.id, title: next.title },
        ];
      });
      if (activate || currentId.current === next.id) {
        canvasRef.current = next;
        currentId.current = next.id;
        setCanvasId(next.id);
        setLocalCanvas(next);
      }
      // Pointer movement can update hundreds of times; batch browser recovery writes.
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(persistAll, 150);
    },
    [persistAll],
  );

  const save = useCallback(
    (next: Canvas, activate = true): Promise<boolean> => {
      local(next, activate);
      const token = persist(next, true);
      pending.current++;
      if (alive.current) setSaving(pending.current);
      const request = queue.current
        .catch(() => undefined)
        .then(async () => {
          const baseline = baselines.current.get(next.id);
          const updated = await mutate({
            action: "upsert",
            entity,
            item: next,
            base: baseline ? { ...baseline } : null,
          });
          const committed = updated.canvases.find(
            (canvas) => canvas.id === next.id,
          );
          if (!committed)
            throw new Error(
              "The saved canvas was not returned. Your recovery copy is kept.",
            );
          baselines.current.set(next.id, committed);
          if (drafts.current.get(next.id) === next) {
            const latestPersisted = persisted.current.get(next.id);
            const savedToken =
              latestPersisted?.value === next ? latestPersisted.token : token;
            drafts.current.delete(next.id);
            persisted.current.delete(next.id);
            removeDraft(scope, entity, next.id, savedToken);
            if (alive.current)
              setDraftOptions((current) =>
                current.filter((item) => item.id !== next.id),
              );
            if (currentId.current === next.id) {
              canvasRef.current = committed;
              if (alive.current) {
                setLocalCanvas(null);
                setStorageError("");
              }
            }
          } else {
            // A late acknowledgement may advance the baseline, never replace later typing.
            const latest = drafts.current.get(next.id);
            if (latest) persist(latest, true);
          }
          if (alive.current) {
            setErrors((current) => {
              const remaining = { ...current };
              delete remaining[next.id];
              return remaining;
            });
            setRecoveredIds((current) => {
              const remaining = new Set(current);
              remaining.delete(next.id);
              return remaining;
            });
          }
          return true;
        })
        .catch((cause: unknown) => {
          const message =
            cause instanceof Error
              ? cause.message
              : "The canvas could not be saved.";
          if (alive.current) {
            setErrors((current) => ({ ...current, [next.id]: message }));
            notify(message);
          }
          return false;
        })
        .finally(() => {
          pending.current--;
          if (alive.current) setSaving(pending.current);
        });
      queue.current = request;
      return request;
    },
    [local, mutate, notify, persist, scope],
  );

  const switchCanvas = useCallback(
    (id: string): boolean => {
      const next = drafts.current.get(id) || serverById.get(id);
      if (!next) return false;
      persistAll();
      currentId.current = id;
      canvasRef.current = next;
      setCanvasId(id);
      setLocalCanvas(drafts.current.get(id) || null);
      return true;
    },
    [persistAll, serverById],
  );

  const discard = useCallback(async () => {
    if (pending.current || reloadPending.current) return;
    const id = currentId.current;
    if (
      !window.confirm(
        "Discard the unsaved changes to this canvas and load the latest saved version?",
      )
    )
      return;
    persistAll();
    const discardedValue = drafts.current.get(id);
    const record = readDraft(scope, entity, id);
    reloadPending.current = true;
    setReloading(true);
    try {
      const response = await scopedFetch("/api/state", { cache: "no-store" });
      const result = (await response.json()) as {
        workspace?: Workspace;
        error?: string;
      };
      if (!response.ok || !result.workspace)
        throw new Error(
          result.error ||
            "The latest saved canvas could not be loaded. Your recovery copy is kept.",
        );
      if (drafts.current.get(id) !== discardedValue)
        throw new Error(
          "The canvas changed while loading. Review your latest edits before discarding them.",
        );
      if (record && !removeDraft(scope, entity, id, record.token))
        throw new Error(
          "A newer recovery copy is present. Review it before discarding.",
        );
      const remoteCanvases = result.workspace.canvases;
      drafts.current.delete(id);
      persisted.current.delete(id);
      discardDraftMutations(scope, entity, id);
      const next =
        remoteCanvases.find((canvas) => canvas.id === id) ||
        remoteCanvases[0] ||
        null;
      baselines.current.set(
        id,
        remoteCanvases.find((canvas) => canvas.id === id) || null,
      );
      currentId.current = next?.id || "";
      canvasRef.current = next;
      setSnapshot({
        revision: result.workspace.revision,
        canvases: remoteCanvases,
      });
      setCanvasId(next?.id || "");
      setLocalCanvas(next ? drafts.current.get(next.id) || null : null);
      setErrors((current) => {
        const remaining = { ...current };
        delete remaining[id];
        return remaining;
      });
      setRecoveredIds((current) => {
        const remaining = new Set(current);
        remaining.delete(id);
        return remaining;
      });
      setDraftOptions((current) => current.filter((item) => item.id !== id));
      setStorageError("");
    } catch (cause) {
      setErrors((current) => ({
        ...current,
        [id]:
          cause instanceof Error
            ? cause.message
            : "The saved canvas could not be loaded.",
      }));
    } finally {
      reloadPending.current = false;
      setReloading(false);
    }
  }, [scope, scopedFetch, persistAll]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const outbox = listDrafts<Mutation>(scope, "mutations");
      const acknowledged = new Set<string>();
      for (const item of effectiveCanvases) {
        const localValue = drafts.current.get(item.id);
        const unresolved = outbox.some(
          ({ record }) =>
            record.value?.entity === entity &&
            (record.value.id === item.id || record.value.item?.id === item.id),
        );
        // A successful retry outside this editor can acknowledge its exact draft.
        // Keep differing edits and any intent with a request still in flight.
        if (
          localValue &&
          !pending.current &&
          !unresolved &&
          sameCanvas(localValue, item)
        ) {
          const token = persisted.current.get(item.id)?.token;
          if (token) removeDraft(scope, entity, item.id, token);
          drafts.current.delete(item.id);
          persisted.current.delete(item.id);
          acknowledged.add(item.id);
          if (currentId.current === item.id) {
            setLocalCanvas(null);
            setStorageError("");
          }
        }
        if (!drafts.current.has(item.id)) baselines.current.set(item.id, item);
      }
      if (acknowledged.size) {
        setErrors((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([id]) => !acknowledged.has(id)),
          ),
        );
        setRecoveredIds(
          (current) =>
            new Set([...current].filter((id) => !acknowledged.has(id))),
        );
        setDraftOptions((current) =>
          current.filter((item) => !acknowledged.has(item.id)),
        );
      }
      if (!drafts.current.has(currentId.current))
        canvasRef.current = serverById.get(currentId.current) || null;
    });
    return () => cancelAnimationFrame(frame);
  }, [effectiveCanvases, serverById, scope, pendingOperations]);

  useEffect(() => {
    alive.current = true;
    const unregister = registerDraftGuard(scope, "canvas-editor", {
      hasUnsaved: () => drafts.current.size > 0 || pending.current > 0,
      hasUnpersisted: () =>
        [...drafts.current.values()].some(
          (value) => persisted.current.get(value.id)?.value !== value,
        ),
      flush: async () => {
        persistAll();
        await queue.current;
        const results = await Promise.all(
          [...drafts.current.values()].map((value) => save(value, false)),
        );
        return results.every(Boolean);
      },
    });
    const flushRecovery = () => persistAll();
    window.addEventListener("pagehide", flushRecovery);
    window.addEventListener("beforeunload", flushRecovery);
    return () => {
      alive.current = false;
      persistAll();
      unregister();
      window.removeEventListener("pagehide", flushRecovery);
      window.removeEventListener("beforeunload", flushRecovery);
    };
  }, [persistAll, save, scope]);

  return {
    canvasId,
    canvas,
    canvasRef,
    save,
    local,
    switchCanvas,
    discard,
    draftOptions,
    saving: saving > 0 || reloading,
    unsaved: localCanvas !== null,
    recovered: recoveredIds.has(canvasId),
    error: errors[canvasId] || "",
    storageError,
  };
}
