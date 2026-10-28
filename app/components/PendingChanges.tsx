"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Download, X } from "lucide-react";
import {
  listDrafts,
  removeDraft,
  subscribeDrafts,
  type DraftRecord,
  type DraftRecoveryCopy,
} from "../lib/draft-store";
import type { Mutation, Workspace } from "../lib/types";
import { statuses } from "../lib/types";
import { entityLabel, fieldLabel } from "../lib/collaboration-model";
import { useDraftScope } from "./useRecoverableDraft";
import { useDialog } from "./useDialog";
import { useWorkspacePermissions } from "./WorkspacePermissions";

function comparisonValue(
  key: string,
  value: unknown,
  workspace: Workspace,
): string {
  if (key === "projectId")
    return (
      workspace.projects.find((item) => item.id === value)?.name ||
      (value ? "Unavailable project" : "No project")
    );
  if (key === "assigneeId")
    return (
      workspace.people.find((item) => item.id === value)?.name ||
      (value ? "Unavailable person" : "Unassigned")
    );
  if (value === null || value === "" || value === undefined) return "Not set";
  if (key === "status" && typeof value === "string")
    return statuses.find((status) => status.id === value)?.label || value;
  if (key === "priority" && typeof value === "string")
    return value.charAt(0).toUpperCase() + value.slice(1);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

/** Recovery controls for changes that could not be acknowledged by the server. */
export default function PendingChanges({
  workspace,
  busy,
  onClose,
  confirmedWorkspace,
  offline = false,
  issues = {},
  onRebase,
}: {
  workspace: Workspace;
  busy: boolean;
  onClose: () => void;
  confirmedWorkspace?: Workspace | null;
  offline?: boolean;
  issues?: Record<string, string>;
  onRebase?: (
    id: string,
    token: string,
    reviewed: Record<string, unknown> | null,
  ) => Promise<void>;
}) {
  const scope = useDraftScope();
  const permissions = useWorkspacePermissions(confirmedWorkspace || workspace);
  const dialog = useRef<HTMLElement>(null);
  const [reviewing, setReviewing] = useState("");
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const wasWorking = useRef(false);
  useDialog(dialog, onClose, busy || !!reviewing);
  useLayoutEffect(() => {
    if (
      wasWorking.current &&
      !busy &&
      !reviewing &&
      !dialog.current?.contains(document.activeElement)
    )
      heading.current?.focus({ preventScroll: true });
    wasWorking.current = busy || !!reviewing;
  }, [busy, reviewing]);
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
      workspace[mutation.entity]?.find((item) => item.id === id);
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
        if (!busy && !reviewing && event.target === event.currentTarget)
          onClose();
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
          <h2 ref={heading} tabIndex={-1}>
            Unsaved changes
          </h2>
          <button
            className="btn-icon"
            aria-label="Close unsaved changes"
            disabled={busy || !!reviewing}
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <p className="muted">
          Changes on this device still need confirmation. Compare them with the
          last saved version, or download a recovery copy.
        </p>
        {error && (
          <p className="account-error" role="alert">
            {error}
          </p>
        )}
        {!drafts.length && !copies.length && (
          <p>No changes are waiting to sync.</p>
        )}
        <div className="pending-change-list">
          {drafts.map(({ id, record }) => {
            const mutation = record.value;
            const recordId = mutation.id || mutation.item?.id;
            const confirmed =
              mutation.entity &&
              confirmedWorkspace?.[mutation.entity]?.find(
                (item) => item.id === recordId,
              );
            const describe = (values: unknown) => {
              if (!values || typeof values !== "object") return "Not present";
              return Object.entries(values)
                .filter(
                  ([key]) =>
                    !["id", "createdAt", "updatedAt", "snapshots"].includes(
                      key,
                    ),
                )
                .map(([key, value]) => {
                  const label = fieldLabel(key, mutation.entity);
                  return `${label}: ${comparisonValue(key, value, workspace)}`;
                })
                .join("\n\n");
            };
            const reviewed = confirmed
              ? (structuredClone(confirmed) as unknown as Record<
                  string,
                  unknown
                >)
              : null;
            const projectId =
              mutation.entity === "projects"
                ? String(recordId || "")
                : confirmed && "projectId" in confirmed
                  ? String(confirmed.projectId || "")
                  : "";
            const canReview =
              !!onRebase &&
              !!confirmed &&
              permissions.canEditProject(projectId || "") &&
              mutation.base !== null &&
              ["upsert", "delete"].includes(mutation.action);
            return (
              <article key={id}>
                <div>
                  <strong>{title(record.value)}</strong>
                  <p className="small-text muted">
                    {{
                      upsert: record.value.base === null ? "Create" : "Update",
                      delete: "Move to Trash",
                      restore: "Restore",
                      rename: "Rename",
                      import: "Import backup",
                      "review-relationship": "Review connection",
                      "vote-idea": "Vote",
                    }[record.value.action] || "Change"}{" "}
                    · {entityLabel(record.value.entity || "workspace")} ·{" "}
                    {new Date(record.updatedAt).toLocaleString()}
                  </p>
                  {issues[id] && <p className="account-error">{issues[id]}</p>}
                  <details data-tour="sync-conflicts">
                    <summary>Compare changes</summary>
                    <div className="sync-field-comparison">
                      <section>
                        <h4>On this device</h4>
                        <pre>
                          {mutation.action === "delete"
                            ? "Move this item to Trash"
                            : describe(mutation.item)}
                        </pre>
                      </section>
                      <section>
                        <h4>Last saved version</h4>
                        <pre>
                          {describe(
                            confirmed && mutation.item
                              ? Object.fromEntries(
                                  Object.keys(mutation.item).map((key) => [
                                    key,
                                    (
                                      confirmed as unknown as Record<
                                        string,
                                        unknown
                                      >
                                    )[key],
                                  ]),
                                )
                              : confirmed,
                          )}
                        </pre>
                      </section>
                    </div>
                    {canReview && (
                      <button
                        className="btn"
                        disabled={busy || !!reviewing || offline}
                        onClick={async () => {
                          setReviewing(id);
                          setError("");
                          try {
                            await onRebase!(id, record.token, reviewed);
                          } catch (cause) {
                            setError(
                              cause instanceof Error
                                ? cause.message
                                : "This change could not be synced. Try again.",
                            );
                          } finally {
                            setReviewing("");
                          }
                        }}
                      >
                        {reviewing === id
                          ? "Applying…"
                          : mutation.action === "delete"
                            ? "Apply reviewed deletion"
                            : "Apply reviewed changes"}
                      </button>
                    )}
                  </details>
                </div>
                <button
                  className="btn danger"
                  disabled={busy || !!reviewing}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Discard this pending save? It will not be retried. Any separate editor draft stays on this device.",
                      )
                    )
                      removeDraft(scope, "mutations", id, record.token);
                  }}
                >
                  Discard pending save
                </button>
              </article>
            );
          })}
        </div>
        {copies.length > 0 && (
          <>
            <h3>Drafts kept from another window</h3>
            <p className="small-text muted">
              Review or download these drafts before copying changes into the
              current item. They are kept separately from your current draft.
            </p>
            <div className="pending-change-list">
              {copies.map(({ id, record }) => {
                const raw = record.value.record.value;
                const value =
                  raw && typeof raw === "object"
                    ? (raw as Record<string, unknown>)
                    : {};
                const item =
                  value.item && typeof value.item === "object"
                    ? (value.item as Record<string, unknown>)
                    : value;
                const recoveredTitle =
                  (typeof item.title === "string" && item.title) ||
                  (typeof item.name === "string" && item.name) ||
                  "Recovered draft";
                return (
                  <article key={id}>
                    <div>
                      <strong>{recoveredTitle}</strong>
                      <p className="small-text muted">
                        {entityLabel(
                          typeof value.entity === "string"
                            ? value.entity
                            : record.value.entity,
                        )}{" "}
                        ·{" "}
                        {new Date(
                          record.value.record.updatedAt,
                        ).toLocaleString()}
                      </p>
                      <details>
                        <summary>View recovered draft</summary>
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
                          removeDraft(
                            scope,
                            "recovery-copies",
                            id,
                            record.token,
                          );
                      }}
                    >
                      Discard recovery copy
                    </button>
                  </article>
                );
              })}
            </div>
          </>
        )}
        <div className="dialog-footer">
          <button
            className="btn"
            onClick={download}
            disabled={!drafts.length && !copies.length}
          >
            <Download size={15} aria-hidden="true" />
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
