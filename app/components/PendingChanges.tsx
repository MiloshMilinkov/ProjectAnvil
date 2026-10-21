"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import { Download, X } from "lucide-react";
import {
  listDrafts,
  removeDraft,
  subscribeDrafts,
  type DraftRecord,
  type DraftRecoveryCopy,
} from "../lib/draft-store";
import type { Mutation, Workspace } from "../lib/types";
import { useDraftScope } from "./useRecoverableDraft";
import { useDialog } from "./useDialog";

/** Recovery controls for changes that could not be acknowledged by the server. */
export default function PendingChanges({
  workspace,
  busy,
  onClose,
}: {
  workspace: Workspace;
  busy: boolean;
  onClose: () => void;
}) {
  const scope = useDraftScope();
  const dialog = useRef<HTMLElement>(null);
  useDialog(dialog, onClose, busy);
  const serialized = useSyncExternalStore(
    subscribeDrafts,
    useCallback(
      () => JSON.stringify(listDrafts<Mutation>(scope, "mutations")),
      [scope],
    ),
    () => "[]",
  );
  const drafts = JSON.parse(serialized) as {
    id: string;
    record: DraftRecord<Mutation>;
  }[];
  const serializedCopies = useSyncExternalStore(
    subscribeDrafts,
    useCallback(
      () =>
        JSON.stringify(listDrafts<DraftRecoveryCopy>(scope, "recovery-copies")),
      [scope],
    ),
    () => "[]",
  );
  const copies = (
    JSON.parse(serializedCopies) as {
      id: string;
      record: DraftRecord<DraftRecoveryCopy>;
    }[]
  ).filter(
    (copy) =>
      copy.record.value &&
      typeof copy.record.value.entity === "string" &&
      copy.record.value.record &&
      typeof copy.record.value.record.token === "string",
  );
  const title = (mutation: Mutation) => {
    const id = mutation.id || mutation.item?.id;
    const saved =
      mutation.entity &&
      workspace[mutation.entity].find((item) => item.id === id);
    const item = mutation.item;
    return String(
      (item &&
        ("title" in item ? item.title : "name" in item ? item.name : "")) ||
        (saved &&
          ("title" in saved
            ? saved.title
            : "name" in saved
              ? saved.name
              : "")) ||
        mutation.name ||
        id ||
        "Workspace",
    );
  };
  function download() {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { pendingSaves: drafts, otherWindowDrafts: copies },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "projectanvil-unsaved-changes.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div
      className="modal-shade"
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="small-dialog pending-changes-dialog"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Unsaved changes"
      >
        <div className="dialog-heading">
          <h2>Unsaved changes</h2>
          <button
            className="btn-icon"
            aria-label="Close unsaved changes"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <p className="muted">
          These changes need a successful save. Conflicting edits need to be
          reviewed in their editor. Download a copy before discarding anything
          you may need.
        </p>
        {!drafts.length && !copies.length && (
          <p>All queued changes have been saved or discarded.</p>
        )}
        <div className="pending-change-list">
          {drafts.map(({ id, record }) => (
            <article key={id}>
              <div>
                <strong>{title(record.value)}</strong>
                <p className="small-text muted">
                  {record.value.action} · {record.value.entity || "workspace"} ·{" "}
                  {new Date(record.updatedAt).toLocaleString()}
                </p>
              </div>
              <button
                className="btn danger"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Discard this pending save? It will no longer be retried. Any separate editor recovery draft stays on this device.",
                    )
                  )
                    removeDraft(scope, "mutations", id, record.token);
                }}
              >
                Discard pending save
              </button>
            </article>
          ))}
        </div>
        {copies.length > 0 && (
          <>
            <h3>Drafts kept from another window</h3>
            <p className="small-text muted">
              Review or download these copies before merging useful text into
              the current item. They are kept separately so one window cannot
              erase another window’s unfinished work.
            </p>
            <div className="pending-change-list">
              {copies.map(({ id, record }) => (
                <article key={id}>
                  <div>
                    <strong>
                      {record.value.entity} · {record.value.id}
                    </strong>
                    <p className="small-text muted">
                      {new Date(record.value.record.updatedAt).toLocaleString()}
                    </p>
                    <details>
                      <summary>Inspect recovered draft</summary>
                      <pre className="recovery-copy-content">
                        {JSON.stringify(record.value.record.value, null, 2)}
                      </pre>
                    </details>
                  </div>
                  <button
                    className="btn danger"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Discard this recovery copy? Download it first if it contains work you need.",
                        )
                      )
                        removeDraft(scope, "recovery-copies", id, record.token);
                    }}
                  >
                    Discard recovery copy
                  </button>
                </article>
              ))}
            </div>
          </>
        )}
        <div className="dialog-footer">
          <button
            className="btn"
            onClick={download}
            disabled={!drafts.length && !copies.length}
          >
            <Download size={15} />
            Download recovery copy
          </button>
          <button className="btn" disabled={busy} onClick={onClose}>
            Done
          </button>
        </div>
      </section>
    </div>
  );
}
