"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Bookmark, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { uid, type FeatureProps, type SavedView } from "../lib/types";
import {
  matchesSavedView,
  savedViewConfig,
  type SavedViewConfig,
} from "../lib/saved-view-config";
import { moveToTrash } from "../lib/trash-actions";
import "./everyday-workflow.css";
import { useDraftScope } from "./useRecoverableDraft";
import { useWorkspacePermissions } from "./WorkspacePermissions";

export default function SavedTaskViews({
  workspace,
  mutate,
  notify,
  config,
  onApply,
  mine,
}: Pick<FeatureProps, "workspace" | "mutate" | "notify"> & {
  config: SavedViewConfig;
  onApply: (config: SavedViewConfig) => void;
  mine: boolean;
}) {
  const permissions = useWorkspacePermissions(workspace);
  const [selected, setSelected] = useState<SavedView | null>(null);
  const [editing, setEditing] = useState<"new" | "rename" | null>(null);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const guard = useRef(false);
  const scope = useDraftScope();
  const createId = useRef(uid());
  const formId = useId();
  const nameId = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const active =
    selected && workspace.savedViews.find((view) => view.id === selected.id);
  const modified = !!active && !matchesSavedView(active, config);
  useEffect(() => {
    if (pending) return;
    if (editing) nameInput.current?.focus();
    else if (returnFocus.current) saveButton.current?.focus();
    returnFocus.current = false;
  }, [editing, pending, selected]);

  function start(mode: "new" | "rename") {
    if (
      !permissions.canEditProject(
        mode === "new" ? config.project : active?.project || "",
      )
    )
      return;
    setName(mode === "rename" ? selected?.name || "" : "");
    setError("");
    setEditing(mode);
  }
  function closeForm() {
    setEditing(null);
    returnFocus.current = true;
  }
  async function persist(mode: "new" | "rename" | "update", event?: FormEvent) {
    event?.preventDefault();
    if (
      !permissions.canEditProject(
        mode === "new" ? config.project : active?.project || "",
      )
    )
      return;
    if (guard.current || (mode !== "update" && !name.trim())) return;
    if (mode !== "new" && (!selected || !active)) return;
    guard.current = true;
    setPending(true);
    setError("");
    try {
      const id = mode === "new" ? createId.current : selected!.id;
      const item =
        mode === "rename"
          ? { id, name: name.trim() }
          : {
              id,
              ...(mode === "new" ? { name: name.trim() } : {}),
              ...config,
            };
      const updated = await mutate({
        action: "upsert",
        entity: "savedViews",
        item,
        base: mode === "new" ? null : { ...selected! },
      });
      setSelected(updated.savedViews.find((view) => view.id === id) || null);
      if (mode === "new") createId.current = uid();
      closeForm();
      notify(
        mode === "new"
          ? "View saved"
          : mode === "rename"
            ? "View renamed"
            : "View updated",
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The view could not be saved.",
      );
    } finally {
      guard.current = false;
      setPending(false);
    }
  }
  async function remove() {
    if (!permissions.canEditProject(active?.project || "")) return;
    if (!selected || !active || guard.current) return;
    guard.current = true;
    setPending(true);
    setError("");
    try {
      await moveToTrash(
        mutate,
        notify,
        { entity: "savedViews", id: selected.id, base: { ...selected } },
        "Saved view",
        scope,
      );
      setSelected(null);
      setEditing(null);
      returnFocus.current = true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The view could not be moved to Trash.",
      );
    } finally {
      guard.current = false;
      setPending(false);
    }
  }
  return (
    <section
      className="saved-task-views"
      data-tour="saved-views"
      aria-label="Saved task views"
    >
      <div className="saved-views-line">
        <span className="saved-views-label">
          <Bookmark size={15} /> Saved views
        </span>
        <div
          className="saved-view-options"
          role="group"
          aria-label="Open saved view"
        >
          {workspace.savedViews.map((view) => (
            <button
              key={view.id}
              className={`saved-view-choice ${active?.id === view.id ? "selected" : ""}`}
              aria-pressed={active?.id === view.id}
              disabled={pending}
              onClick={() => {
                setSelected(structuredClone(view));
                onApply(savedViewConfig(view));
                setEditing(null);
                setError("");
              }}
            >
              {view.name}
            </button>
          ))}
        </div>
        <button
          ref={saveButton}
          className="btn btn-subtle"
          disabled={pending || !permissions.canEditProject(config.project)}
          aria-expanded={editing === "new"}
          aria-controls={formId}
          onClick={() => start("new")}
        >
          <Plus size={15} />
          Save current view
        </button>
      </div>
      {active && (
        <div className="saved-view-actions">
          <span>
            <strong>{active.name}</strong>
            <small>
              {modified
                ? "Modified · changes are not saved"
                : "Filters, sorting and layout saved"}
            </small>
          </span>
          <button
            className="btn btn-secondary"
            disabled={
              pending ||
              !modified ||
              !permissions.canEditProject(active.project)
            }
            onClick={() => void persist("update")}
          >
            <Check size={14} />
            {pending && !editing ? "Saving…" : "Update view"}
          </button>
          <button
            className="btn btn-subtle"
            disabled={pending || !permissions.canEditProject(active.project)}
            onClick={() => start("rename")}
          >
            <Pencil size={14} />
            Rename
          </button>
          <button
            className="btn btn-subtle"
            disabled={pending || !permissions.canEditProject(active.project)}
            onClick={() => void remove()}
          >
            <Trash2 size={14} />
            Move to Trash
          </button>
        </div>
      )}
      {editing && (
        <form
          className="saved-view-form"
          id={formId}
          onSubmit={(event) => void persist(editing, event)}
        >
          <label htmlFor={nameId}>
            {editing === "rename" ? "Rename view" : "View name"}
          </label>
          <input
            ref={nameInput}
            id={nameId}
            className="field"
            maxLength={300}
            required
            value={name}
            disabled={pending}
            placeholder="e.g. This week's priorities"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !pending) {
                event.stopPropagation();
                closeForm();
              }
            }}
          />
          <button
            className="btn btn-primary"
            disabled={pending || !name.trim()}
          >
            {pending
              ? "Saving…"
              : editing === "rename"
                ? "Save name"
                : "Save view"}
          </button>
          <button
            type="button"
            className="btn-icon"
            aria-label="Cancel saving view"
            disabled={pending}
            onClick={closeForm}
          >
            <X size={17} />
          </button>
          <p className="muted">
            {mine ? "My work always shows your assignment. " : ""}Views are
            shared with this workspace members.
          </p>
        </form>
      )}
      {error && (
        <div className="form-error" role="alert">
          {error} Select the view again to load its latest saved settings.
        </div>
      )}
    </section>
  );
}
