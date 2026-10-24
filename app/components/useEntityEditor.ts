"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FeatureProps, Person, Project, Workspace } from "../lib/types";
import {
  discardDraftMutations,
  readDraft,
  registerDraftGuard,
  removeDraft,
  writeDraft,
} from "../lib/draft-store";
import { useDraftScope } from "./useRecoverableDraft";
import { useWorkspaceFetch } from "./WorkspaceScope";
import { recoverPendingOperation } from "../lib/editor-mutations";
import { uid } from "../lib/types";

type Editable = Project | Person;

/** Shared persistence and conflict protection for explicit-save entity forms. */
export function useEntityEditor<T extends Editable>({
  entity,
  original,
  create,
  validate,
  mutate,
  onClose,
}: {
  entity: "projects" | "people";
  original: T | null;
  create: () => T;
  validate: (value: unknown) => value is T;
  mutate: FeatureProps["mutate"];
  onClose: () => void;
}) {
  const scope = useDraftScope();
  const scopedFetch = useWorkspaceFetch();
  const recoveryEntity = `${entity}-editors`;
  const recoveryId = original?.id || "new";
  const [initial] = useState(() => {
    const empty = original || create();
    const stored = readDraft<T>(scope, recoveryEntity, recoveryId);
    const usable =
      stored &&
      validate(stored.value) &&
      (stored.baseline === null ||
        (validate(stored.baseline) &&
          stored.baseline.id === stored.value.id)) &&
      (!original || stored.value.id === original.id);
    return {
      value: usable ? stored.value : empty,
      baseline: usable ? stored.baseline : original,
      empty,
      recovered: !!usable,
    };
  });
  const [draft, setDraft] = useState(initial.value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [recovered, setRecovered] = useState(initial.recovered);
  const [exists, setExists] = useState(initial.baseline !== null);
  const [confirmClose, setConfirmClose] = useState(false);
  const baseline = useRef(initial.baseline);
  const current = useRef(initial.value);
  const busyRef = useRef(false);
  const dirty = useRef(
    initial.recovered &&
      JSON.stringify(initial.value) !== JSON.stringify(initial.baseline),
  );
  const errorRef = useRef<HTMLDivElement>(null);

  const persist = useCallback(() => {
    const result = writeDraft(
      scope,
      recoveryEntity,
      recoveryId,
      current.current,
      baseline.current,
    );
    setStorageError(result.error || "");
    return result.persisted;
  }, [scope, recoveryEntity, recoveryId]);

  const change = useCallback(
    (patch: Partial<T>) => {
      if (busyRef.current) return;
      const next = { ...current.current, ...patch };
      current.current = next;
      dirty.current =
        JSON.stringify(next) !==
        JSON.stringify(baseline.current || initial.empty);
      setDraft(next);
      if (dirty.current) persist();
      else removeDraft(scope, recoveryEntity, recoveryId);
    },
    [initial.empty, persist, scope, recoveryEntity, recoveryId],
  );

  const clearRecovery = useCallback(
    (token?: string) => {
      if (token) removeDraft(scope, recoveryEntity, recoveryId, token);
      dirty.current = false;
      setRecovered(false);
      setStorageError("");
    },
    [scope, recoveryEntity, recoveryId],
  );

  async function save(cleaned: T): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const token = readDraft(scope, recoveryEntity, recoveryId)?.token;
    try {
      const base = baseline.current;
      const item = base
        ? {
            id: cleaned.id,
            ...Object.fromEntries(
              Object.entries(cleaned).filter(
                ([key, value]) =>
                  key !== "id" &&
                  JSON.stringify(value) !==
                    JSON.stringify(base[key as keyof T]),
              ),
            ),
          }
        : cleaned;
      await mutate({
        action: "upsert",
        entity,
        item,
        base: base ? { ...base } : null,
      });
      clearRecovery(token);
      setExists(true);
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Your changes could not be saved.",
      );
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function remove(): Promise<string | false> {
    if (!original || busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const token = readDraft(scope, recoveryEntity, recoveryId)?.token;
    try {
      const base = baseline.current;
      const deletion = recoverPendingOperation(scope, {
        action: "delete",
        entity,
        id: original.id,
        base: base ? { ...base } : null,
      });
      deletion.operationId ||= uid();
      await mutate(deletion);
      clearRecovery(token);
      discardDraftMutations(scope, entity, original.id);
      return deletion.operationId;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "This item could not be removed.",
      );
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function loadLatest(): Promise<void> {
    if (busyRef.current) return;
    if (
      dirty.current &&
      !window.confirm(
        "Discard your unsaved form changes and load the latest saved values?",
      )
    )
      return;
    busyRef.current = true;
    setBusy(true);
    const previousToken = readDraft(scope, recoveryEntity, recoveryId)?.token;
    try {
      const response = await scopedFetch("/api/state", { cache: "no-store" });
      const result = (await response.json()) as {
        workspace?: Workspace;
        error?: string;
      };
      if (!response.ok || !result.workspace)
        throw new Error(
          result.error || "The latest saved version could not be loaded.",
        );
      const latest = result.workspace[entity].find(
        (item) => item.id === current.current.id,
      );
      if (!validate(latest))
        throw new Error(
          "No saved version was found. Your unfinished changes are kept; retry saving or copy them before closing.",
        );
      baseline.current = latest;
      current.current = latest;
      setDraft(latest);
      clearRecovery(previousToken);
      discardDraftMutations(scope, entity, latest.id);
      setExists(true);
      setConfirmClose(false);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The latest version could not be loaded.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const requestClose = useCallback(() => {
    if (busyRef.current) return;
    if (dirty.current) setConfirmClose(true);
    else onClose();
  }, [onClose]);

  function keepAndClose() {
    if (!busyRef.current && persist()) onClose();
  }

  function discardAndClose() {
    if (busyRef.current) return;
    const token = readDraft(scope, recoveryEntity, recoveryId)?.token;
    clearRecovery(token);
    discardDraftMutations(scope, entity, current.current.id);
    onClose();
  }

  useEffect(
    () =>
      registerDraftGuard(scope, `${entity}-editor`, {
        hasUnsaved: () => dirty.current,
        flush: async () => !dirty.current || persist(),
      }),
    [scope, entity, persist],
  );
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  return {
    draft,
    change,
    busy,
    error,
    setError,
    errorRef,
    storageError,
    recovered,
    exists,
    save,
    remove,
    loadLatest,
    requestClose,
    confirmClose,
    setConfirmClose,
    keepAndClose,
    discardAndClose,
  };
}
