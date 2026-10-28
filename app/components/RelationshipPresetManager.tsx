"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { Archive, Plus, RotateCcw, X } from "lucide-react";
import { uid, type FeatureProps, type RelationshipPreset } from "../lib/types";
import { relationshipOptions } from "../lib/relationship-display";
import { useDialog } from "./useDialog";
import { useEntityEditor } from "./useEntityEditor";
import { EntityEditorFeedback } from "./EntityEditorFeedback";
import "./relationship-presets.css";

type Props = Pick<FeatureProps, "workspace" | "mutate" | "notify"> & {
  onClose: () => void;
};

function isPreset(value: unknown): value is RelationshipPreset {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<RelationshipPreset>;
  return (
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    typeof item.description === "string" &&
    typeof item.label === "string" &&
    typeof item.archived === "boolean" &&
    relationshipOptions.some((option) => option.value === item.kind) &&
    ["any", "note", "task", "project"].includes(item.fromType || "") &&
    ["any", "note", "task", "project"].includes(item.toType || "")
  );
}

export default function RelationshipPresetManager(props: Props) {
  const [editing, setEditing] = useState<
    RelationshipPreset | null | undefined
  >();
  if (editing !== undefined)
    return (
      <PresetEditor
        {...props}
        original={editing}
        onBack={() => setEditing(undefined)}
      />
    );
  return <PresetList {...props} onEdit={setEditing} />;
}

function PresetList({
  workspace,
  onClose,
  onEdit,
}: Props & { onEdit: (value: RelationshipPreset | null) => void }) {
  const dialog = useRef<HTMLElement>(null);
  useDialog(dialog, onClose);
  const [archived, setArchived] = useState(false);
  const items = (workspace.relationshipPresets || []).filter(
    (item) => item.archived === archived,
  );
  return (
    <div
      className="modal-shade"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Relationship presets"
        className="small-dialog preset-dialog"
      >
        <div className="dialog-heading">
          <h2>Relationship presets</h2>
          <button
            className="btn-icon"
            aria-label="Close relationship presets"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <p className="muted">
          Save a relationship type, item types, and a suggested reason for reuse.
        </p>
        <div className="preset-toolbar">
          <button className="btn btn-primary" onClick={() => onEdit(null)}>
            <Plus size={16} />
            New preset
          </button>
          <button
            className="btn"
            aria-pressed={archived}
            onClick={() => setArchived((value) => !value)}
          >
            {archived ? "Show active" : "Show archived"}
          </button>
        </div>
        <div className="preset-list">
          {items.map((item) => (
            <article key={item.id}>
              <div>
                <h3>{item.name}</h3>
                <p>{item.description || `${item.fromType} → ${item.toType}`}</p>
                <small>
                  {
                    relationshipOptions.find(
                      (option) => option.value === item.kind,
                    )?.label
                  }
                </small>
              </div>
              <button
                className="btn"
                aria-label={`Edit preset: ${item.name}`}
                onClick={() => onEdit(item)}
              >
                Edit
              </button>
            </article>
          ))}
          {!items.length && (
            <p className="preset-empty">
              {archived
                ? "No archived presets."
                : "No presets yet. Create one for a relationship you use often."}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function PresetEditor({
  original,
  mutate,
  notify,
  onBack,
}: Props & { original: RelationshipPreset | null; onBack: () => void }) {
  const editor = useEntityEditor<RelationshipPreset>({
    entity: "relationshipPresets",
    original,
    create: () => ({
      id: uid(),
      name: "",
      description: "",
      kind: "supports",
      label: "",
      fromType: "any",
      toType: "any",
      archived: false,
    }),
    validate: isPreset,
    mutate,
    onClose: onBack,
  });
  const form = useRef<HTMLFormElement>(null);
  const titleId = useId();
  useDialog(form, editor.requestClose, editor.busy);
  const { draft, change } = editor;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim()) {
      editor.setError("Give this preset a name.");
      return;
    }
    if (
      await editor.save({
        ...draft,
        name: draft.name.trim(),
        description: draft.description.trim(),
        label: draft.label.trim(),
      })
    ) {
      notify("Relationship preset saved");
      onBack();
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
        ref={form}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="small-dialog entity-dialog preset-dialog"
        onSubmit={(event) => void submit(event)}
      >
        <div className="dialog-heading">
          <h2 id={titleId}>
            {original ? "Edit relationship preset" : "New relationship preset"}
          </h2>
          <button
            type="button"
            className="btn-icon"
            aria-label="Close preset editor"
            disabled={editor.busy}
            onClick={editor.requestClose}
          >
            <X size={18} />
          </button>
        </div>
        <p className="muted">
          Presets fill in new relationships. Editing a preset does not change
          existing relationships.
        </p>
        <fieldset className="entity-editor-fields" disabled={editor.busy}>
          <label className="form-label">
            Name
            <input
              className="field"
              autoFocus
              required
              maxLength={100}
              value={draft.name}
              onChange={(event) => change({ name: event.target.value })}
            />
          </label>
          <label className="form-label">
            Description <span className="muted">(optional)</span>
            <textarea
              className="field"
              maxLength={2000}
              value={draft.description}
              onChange={(event) => change({ description: event.target.value })}
            />
          </label>
          <label className="form-label">
            Meaning
            <select
              className="field"
              value={draft.kind}
              onChange={(event) =>
                change({
                  kind: event.target.value as RelationshipPreset["kind"],
                })
              }
            >
              {relationshipOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">
            {
              relationshipOptions.find((option) => option.value === draft.kind)
                ?.explanation
            }
          </p>
          <div className="preset-type-grid">
            {(["fromType", "toType"] as const).map((field, index) => (
              <label className="form-label" key={field}>
                {index ? "Second item type" : "First item type"}
                <select
                  className="field"
                  value={draft[field]}
                  onChange={(event) =>
                    change({
                      [field]: event.target
                        .value as RelationshipPreset[typeof field],
                    })
                  }
                >
                  <option value="any">Any item</option>
                  <option value="note">Note</option>
                  <option value="task">Task</option>
                  <option value="project">Project</option>
                </select>
              </label>
            ))}
          </div>
          <label className="form-label">
            Suggested explanation <span className="muted">(optional)</span>
            <input
              className="field"
              maxLength={240}
              value={draft.label}
              onChange={(event) => change({ label: event.target.value })}
            />
          </label>
          {original && (
            <label className="preset-archive">
              <input
                type="checkbox"
                checked={draft.archived}
                onChange={(event) => change({ archived: event.target.checked })}
              />
              {draft.archived ? <RotateCcw size={16} /> : <Archive size={16} />}
              Archived — hidden from new connections
            </label>
          )}
        </fieldset>
        <EntityEditorFeedback editor={editor} existing={editor.exists} />
        <div className="dialog-footer">
          <button
            type="button"
            className="btn"
            disabled={editor.busy}
            onClick={editor.requestClose}
          >
            Back
          </button>
          <button className="btn btn-primary" disabled={editor.busy}>
            {editor.busy ? "Saving…" : "Save preset"}
          </button>
        </div>
      </form>
    </div>
  );
}
