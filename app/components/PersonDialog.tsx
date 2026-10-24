"use client";

import { useId, useRef, type FormEvent } from "react";
import { Trash2, X } from "lucide-react";
import { uid, type FeatureProps, type Person } from "../lib/types";
import { useDialog } from "./useDialog";
import { useEntityEditor } from "./useEntityEditor";
import { EntityEditorFeedback } from "./EntityEditorFeedback";

interface Props {
  person: Person | null;
  mutate: FeatureProps["mutate"];
  onClose: () => void;
  notify: FeatureProps["notify"];
}

function isPerson(value: unknown): value is Person {
  if (!value || typeof value !== "object") return false;
  const person = value as Partial<Person>;
  return (
    typeof person.id === "string" &&
    typeof person.name === "string" &&
    typeof person.role === "string" &&
    typeof person.color === "string"
  );
}

export default function PersonDialog({
  person,
  mutate,
  onClose,
  notify,
}: Props) {
  const editor = useEntityEditor({
    entity: "people",
    original: person,
    validate: isPerson,
    mutate,
    onClose,
    create: () => ({ id: uid(), name: "", role: "", color: "#9e93ef" }),
  });
  const dialog = useRef<HTMLFormElement>(null);
  const titleId = useId();
  useDialog(dialog, editor.requestClose, editor.busy);
  const { draft, change } = editor;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim()) {
      editor.setError("Give the assignment label a name.");
      return;
    }
    if (await editor.save({ ...draft, name: draft.name.trim() })) {
      notify(
        editor.exists ? "Assignment label updated" : "Assignment label added",
      );
      onClose();
    }
  }

  async function remove() {
    if (
      !window.confirm(
        "Move this assignment label to Trash? Its tasks will become unassigned.",
      )
    )
      return;
    const undoId = await editor.remove();
    if (undoId) {
      notify("Assignment label moved to Trash", { undoId });
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
          <h2 id={titleId}>
            {editor.exists ? "Edit assignment label" : "New assignment label"}
          </h2>
          <button
            type="button"
            className="btn-icon"
            aria-label="Close assignment label editor"
            disabled={editor.busy}
            onClick={editor.requestClose}
          >
            <X size={18} />
          </button>
        </div>
        <p className="muted">
          Add a name for task assignments. Invite registered accounts through
          Teams &amp; people to grant workspace access.
        </p>
        <fieldset className="entity-editor-fields" disabled={editor.busy}>
          <label className="form-label">
            Name
            <input
              required
              autoFocus
              className="field"
              maxLength={300}
              value={draft.name}
              onChange={(event) => change({ name: event.target.value })}
              placeholder="Name"
            />
          </label>
          <label className="form-label">
            <span>
              Role <small className="editor-optional">(optional)</small>
            </span>
            <input
              className="field"
              maxLength={300}
              value={draft.role}
              onChange={(event) => change({ role: event.target.value })}
              placeholder="e.g. Project coordinator"
            />
          </label>
          <label className="form-label">
            Color
            <input
              className="field color-field"
              type="color"
              value={draft.color}
              onChange={(event) => change({ color: event.target.value })}
            />
          </label>
        </fieldset>
        <EntityEditorFeedback editor={editor} existing={editor.exists} />
        <div className="dialog-footer">
          {person && (
            <button
              type="button"
              className="btn danger editor-delete"
              aria-label="Remove assignment label"
              disabled={editor.busy}
              onClick={() => void remove()}
            >
              <Trash2 size={16} />
              <span>Remove</span>
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
                ? "Save changes"
                : "Add label"}
          </button>
        </div>
      </form>
    </div>
  );
}
