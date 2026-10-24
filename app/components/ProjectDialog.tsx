"use client";

import { useId, useRef, type FormEvent } from "react";
import { Trash2, X } from "lucide-react";
import { uid, type FeatureProps, type Project } from "../lib/types";
import { useDialog } from "./useDialog";
import { useEntityEditor } from "./useEntityEditor";
import { EntityEditorFeedback } from "./EntityEditorFeedback";

interface Props {
  project: Project | null;
  mutate: FeatureProps["mutate"];
  onClose: () => void;
  notify: FeatureProps["notify"];
}

function isProject(value: unknown): value is Project {
  if (!value || typeof value !== "object") return false;
  const project = value as Partial<Project>;
  return [
    "id",
    "name",
    "key",
    "description",
    "goal",
    "color",
    "status",
    "targetDate",
  ].every((key) => typeof project[key as keyof Project] === "string");
}

export default function ProjectDialog({
  project,
  mutate,
  onClose,
  notify,
}: Props) {
  const editor = useEntityEditor({
    entity: "projects",
    original: project,
    validate: isProject,
    mutate,
    onClose,
    create: () => ({
      id: uid(),
      name: "",
      key: "",
      description: "",
      goal: "",
      color: "#a192fc",
      status: "Planning",
      targetDate: "",
    }),
  });
  const dialog = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const prefixHelpId = useId();
  useDialog(dialog, editor.requestClose, editor.busy);
  const { draft, change } = editor;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim()) {
      editor.setError("Give your project a name.");
      return;
    }
    const cleaned = {
      ...draft,
      name: draft.name.trim(),
      key:
        (draft.key || draft.name.slice(0, 3))
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "")
          .slice(0, 8) || "PRJ",
    };
    if (await editor.save(cleaned)) {
      notify(editor.exists ? "Project updated" : "Project created");
      onClose();
    }
  }

  async function remove() {
    if (
      !window.confirm(
        "Move this project to Trash? Move its notes and tasks first.",
      )
    )
      return;
    const undoId = await editor.remove();
    if (undoId) {
      notify("Project moved to Trash", { undoId });
      onClose();
    }
  }

  return (
    <div
      className="modal-shade"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) editor.requestClose();
      }}
    >
      <form
        ref={dialog}
        className="small-dialog entity-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={editor.busy}
        onSubmit={(event) => void submit(event)}
      >
        <div className="dialog-heading">
          <h2 id={titleId}>{editor.exists ? "Edit project" : "New project"}</h2>
          <button
            type="button"
            className="btn-icon"
            aria-label="Close project editor"
            disabled={editor.busy}
            onClick={editor.requestClose}
          >
            <X size={19} />
          </button>
        </div>
        <p className="muted">
          This project belongs to the current workspace. In a team workspace,
          every accepted member can access its tasks, notes, and files.
        </p>
        <fieldset className="entity-editor-fields" disabled={editor.busy}>
          <label className="form-label">
            Project name
            <input
              required
              autoFocus
              className="field"
              maxLength={300}
              value={draft.name}
              onChange={(event) => change({ name: event.target.value })}
              placeholder="Project name"
            />
          </label>
          <div className="form-grid">
            <label className="form-label">
              Task prefix
              <input
                className="field"
                value={draft.key}
                maxLength={8}
                onChange={(event) => change({ key: event.target.value })}
                placeholder="PRJ"
                aria-describedby={prefixHelpId}
              />
              <small className="editor-field-help" id={prefixHelpId}>
                Starts task IDs, such as PRJ-1.
              </small>
            </label>
            <label className="form-label">
              Accent color
              <input
                type="color"
                className="field color-field"
                value={draft.color}
                onChange={(event) => change({ color: event.target.value })}
              />
            </label>
          </div>
          <label className="form-label">
            Description
            <textarea
              className="field"
              maxLength={10000}
              value={draft.description}
              onChange={(event) => change({ description: event.target.value })}
              placeholder="What are you working toward?"
            />
          </label>
          <label className="form-label">
            Next milestone
            <input
              className="field"
              maxLength={10000}
              value={draft.goal}
              onChange={(event) => change({ goal: event.target.value })}
              placeholder="First milestone complete"
            />
          </label>
          <div className="form-grid">
            <label className="form-label">
              Phase
              <select
                className="field"
                value={draft.status}
                onChange={(event) => change({ status: event.target.value })}
              >
                {[
                  ...new Set([
                    draft.status,
                    "Planning",
                    "In progress",
                    "Review",
                    "Completed",
                    "Archived",
                  ]),
                ]
                  .filter(Boolean)
                  .map((status) => (
                    <option key={status}>{status}</option>
                  ))}
              </select>
            </label>
            <label className="form-label">
              Target date
              <input
                type="date"
                className="field"
                value={draft.targetDate}
                onChange={(event) => change({ targetDate: event.target.value })}
              />
            </label>
          </div>
        </fieldset>
        <EntityEditorFeedback editor={editor} existing={editor.exists} />
        <div className="dialog-footer">
          {project && (
            <button
              type="button"
              className="btn danger editor-delete"
              aria-label="Move project to Trash"
              disabled={editor.busy}
              onClick={() => void remove()}
            >
              <Trash2 size={16} />
              <span>Move to Trash</span>
            </button>
          )}
          <button
            type="button"
            className="btn"
            disabled={editor.busy}
            onClick={editor.requestClose}
          >
            Close
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={editor.busy}
          >
            {editor.busy
              ? "Saving…"
              : editor.exists
                ? "Save project"
                : "Create project"}
          </button>
        </div>
      </form>
    </div>
  );
}
