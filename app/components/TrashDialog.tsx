"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { RotateCcw, Trash2, X } from "lucide-react";
import type { FeatureProps } from "../lib/types";
import { entityLabel } from "../lib/collaboration-model";
import type { TrashEntry, TrashPage } from "../lib/trash-types";
import { useWorkspaceFetch } from "./WorkspaceScope";
import { useDialog } from "./useDialog";
import "./everyday-workflow.css";

export default function TrashDialog({
  mutate,
  notify,
  warnings,
  onClose,
}: {
  mutate: FeatureProps["mutate"];
  notify: FeatureProps["notify"];
  warnings: string[];
  onClose: () => void;
}) {
  const fetchWorkspace = useWorkspaceFetch();
  const dialog = useRef<HTMLElement>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const [entries, setEntries] = useState<TrashEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState("");
  const [error, setError] = useState("");
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    if (!restoring && returnFocus.current) {
      refreshButton.current?.focus();
      returnFocus.current = false;
    }
  }, [restoring, entries]);
  useDialog(dialog, onClose, !!restoring);
  const load = useCallback(
    async (next?: string) => {
      const response = await fetchWorkspace(
        `/api/trash?limit=30${next ? `&cursor=${encodeURIComponent(next)}` : ""}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as TrashPage & { error?: string };
      if (!response.ok)
        throw new Error(data.error || "Trash could not be loaded.");
      if (mounted.current) {
        setEntries((previous) =>
          next
            ? [
                ...previous,
                ...data.entries.filter(
                  (entry) => !previous.some((old) => old.id === entry.id),
                ),
              ]
            : data.entries,
        );
        setCursor(data.nextCursor);
      }
    },
    [fetchWorkspace],
  );
  useEffect(() => {
    mounted.current = true;
    void load()
      .catch((cause) => {
        if (mounted.current)
          setError(
            cause instanceof Error
              ? cause.message
              : "Trash could not be loaded.",
          );
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
    };
  }, [load]);

  async function refresh(next?: string) {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError("");
    try {
      await load(next);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Trash could not be loaded.",
      );
    } finally {
      busy.current = false;
      if (mounted.current) setLoading(false);
    }
  }
  async function restore(entry: TrashEntry) {
    if (busy.current) return;
    busy.current = true;
    setRestoring(entry.id);
    setError("");
    try {
      await mutate({ action: "restore", id: entry.id });
      notify(`${entityLabel(entry.entity)} restored`);
      await load();
      returnFocus.current = true;
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "This item could not be restored.",
        );
    } finally {
      busy.current = false;
      if (mounted.current) setRestoring("");
    }
  }
  return (
    <div
      className="modal-shade"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !restoring) onClose();
      }}
    >
      <section
        ref={dialog}
        className="everyday-dialog trash-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={loading || !!restoring}
      >
        <header className="dialog-heading">
          <h2 id={titleId}>Workspace Trash</h2>
          <button
            className="btn-icon"
            aria-label="Close Trash"
            disabled={!!restoring}
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <p className="muted" id={descriptionId}>
          Restore deleted items with any links that are still available. Newer
          edits are preserved. Personal templates have their own Deleted tab.
        </p>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        {warnings.length > 0 && (
          <div className="trash-restore-details" role="status">
            <strong>Check the restored connections</strong>
            <ul>
              {warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="trash-list">
          {entries.map((entry) => (
            <article className="trash-row" key={entry.id}>
              <div>
                <strong>{entry.title || entityLabel(entry.entity)}</strong>
                <span>
                  {entityLabel(entry.entity)} ·{" "}
                  {new Date(entry.deletedAt).toLocaleString()}
                </span>
                {!entry.restorable && (
                  <p className="muted">
                    {entry.unavailableReason ||
                      "This recovery copy can no longer be restored."}
                  </p>
                )}
              </div>
              <button
                className="btn btn-secondary"
                disabled={loading || !!restoring || !entry.restorable}
                aria-label={`Restore ${entry.title || entityLabel(entry.entity)}`}
                onClick={() => void restore(entry)}
              >
                <RotateCcw size={15} aria-hidden="true" />
                {restoring === entry.id ? "Restoring…" : "Restore"}
              </button>
            </article>
          ))}
          {!entries.length && (
            <div className="everyday-empty" role="status">
              <Trash2 size={28} aria-hidden="true" />
              <strong>{loading ? "Loading Trash…" : "Trash is empty"}</strong>
              <p>
                Deleted items appear here. They do not expire automatically.
              </p>
            </div>
          )}
        </div>
        <footer className="everyday-dialog-footer">
          <button
            ref={refreshButton}
            className="btn btn-secondary"
            disabled={loading || !!restoring}
            onClick={() => void refresh()}
          >
            Refresh
          </button>
          {cursor && (
            <button
              className="btn btn-secondary"
              disabled={loading || !!restoring}
              onClick={() => void refresh(cursor)}
            >
              {loading ? "Loading…" : "Load more"}
            </button>
          )}
          <button
            className="btn btn-primary"
            disabled={!!restoring}
            onClick={onClose}
          >
            Done
          </button>
        </footer>
      </section>
    </div>
  );
}
