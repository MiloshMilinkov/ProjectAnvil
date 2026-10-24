"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import {
  uid,
  type FeatureProps,
  type NotePropertyField,
  type NoteType,
} from "../lib/types";
import { isNoteTypeDraft } from "../lib/note-structures";
import { useDialog } from "./useDialog";
import { useEntityEditor } from "./useEntityEditor";
import { EntityEditorFeedback } from "./EntityEditorFeedback";
import "./note-structures.css";

type Props = Pick<FeatureProps, "workspace" | "mutate" | "notify"> & {
  onClose: () => void;
};

export default function NoteTypeManager(props: Props) {
  const [editing, setEditing] = useState<NoteType | null | undefined>(
    undefined,
  );
  const dialog = useRef<HTMLElement>(null);
  const titleId = useId();
  useDialog(dialog, props.onClose, false, editing === undefined);
  const types = props.workspace.noteTypes || [];
  if (editing !== undefined)
    return (
      <NoteTypeEditor
        {...props}
        noteType={editing}
        onClose={() => setEditing(undefined)}
      />
    );
  return (
    <div
      className="modal-shade"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <section
        className="small-dialog entity-dialog note-type-manager"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-tour="custom-note-types"
      >
        <div className="dialog-heading">
          <h2 id={titleId}>Custom note types</h2>
          <button
            className="btn-icon"
            aria-label="Close note types"
            onClick={props.onClose}
          >
            <X size={19} />
          </button>
        </div>
        <p className="muted">
          Build reusable property structures for this workspace, such as a
          research source, recipe, or location. Existing freeform properties
          stay available.
        </p>
        <button
          className="btn btn-primary"
          onClick={() => setEditing(null)}
          disabled={types.length >= 100}
        >
          <Plus size={16} />
          New note type
        </button>
        {types.length ? (
          <ul className="note-type-list">
            {types.map((type) => (
              <li key={type.id}>
                <div>
                  <strong>{type.name}</strong>
                  <span>
                    {type.fields.length} properties
                    {type.archived ? " · Archived" : ""}
                  </span>
                  <p>{type.description}</p>
                </div>
                <button className="btn" onClick={() => setEditing(type)}>
                  Edit {type.name}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="note-structure-help">
            No custom types yet. Create one, then choose it in a note’s Details.
          </p>
        )}
        <p className="note-structure-help">
          Archive a type to keep its existing notes while hiding it from new
          assignments. Up to 100 types, with 30 properties each.
        </p>
      </section>
    </div>
  );
}

function NoteTypeEditor({
  noteType,
  mutate,
  notify,
  onClose,
}: Omit<Props, "workspace"> & { noteType: NoteType | null }) {
  const editor = useEntityEditor<NoteType>({
    entity: "noteTypes",
    original: noteType,
    validate: isNoteTypeDraft,
    mutate,
    onClose,
    create: () => ({
      id: uid(),
      name: "",
      description: "",
      archived: false,
      fields: [],
    }),
  });
  const dialog = useRef<HTMLFormElement>(null);
  const titleId = useId();
  useDialog(dialog, editor.requestClose, editor.busy);
  const { draft, change } = editor;
  function fieldChange(id: string, patch: Partial<NotePropertyField>) {
    change({
      fields: draft.fields.map((field) =>
        field.id === id ? { ...field, ...patch } : field,
      ),
    });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim()) {
      editor.setError("Give this note type a name.");
      return;
    }
    if (draft.fields.some((field) => !field.name.trim())) {
      editor.setError("Give every property a name.");
      return;
    }
    if (
      new Set(
        draft.fields.map((field) => field.name.trim().toLocaleLowerCase()),
      ).size !== draft.fields.length
    ) {
      editor.setError("Use a different name for each property.");
      return;
    }
    if (
      draft.fields.some(
        (field) =>
          field.type === "select" &&
          !field.options.some((option) => option.trim()),
      )
    ) {
      editor.setError("Add at least one choice to each choice property.");
      return;
    }
    const cleaned: NoteType = {
      ...draft,
      name: draft.name.trim(),
      description: draft.description.trim(),
      fields: draft.fields.map((field) => ({
        ...field,
        name: field.name.trim(),
        options:
          field.type === "select"
            ? field.options.map((option) => option.trim()).filter(Boolean)
            : [],
      })),
    };
    if (await editor.save(cleaned)) {
      notify(noteType ? "Note type updated" : "Note type created");
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
        className="small-dialog entity-dialog note-type-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={editor.busy}
        onSubmit={(event) => void save(event)}
      >
        <div className="dialog-heading">
          <h2 id={titleId}>{noteType ? "Edit note type" : "New note type"}</h2>
          <button
            type="button"
            className="btn-icon"
            aria-label="Close note type editor"
            disabled={editor.busy}
            onClick={editor.requestClose}
          >
            <X size={19} />
          </button>
        </div>
        <fieldset className="entity-editor-fields" disabled={editor.busy}>
          <label className="form-label">
            Type name
            <input
              className="field"
              maxLength={100}
              required
              value={draft.name}
              onChange={(event) => change({ name: event.target.value })}
            />
          </label>
          <label className="form-label">
            Description
            <textarea
              className="field"
              maxLength={2000}
              value={draft.description}
              onChange={(event) => change({ description: event.target.value })}
            />
          </label>
          <div className="note-structure-heading">
            <h3>Properties</h3>
            <span>{draft.fields.length} of 30</span>
          </div>
          <p className="note-structure-help">
            Required properties are reminders to finish a note; incomplete notes
            can still be saved. Populated fields cannot be removed or changed to
            an incompatible format.
          </p>
          <div className="note-type-fields">
            {draft.fields.map((field, index) => (
              <section
                key={field.id}
                className="note-type-field"
                aria-label={`Property ${index + 1}`}
              >
                <label className="form-label">
                  Property name
                  <input
                    className="field"
                    maxLength={80}
                    required
                    value={field.name}
                    onChange={(event) =>
                      fieldChange(field.id, { name: event.target.value })
                    }
                  />
                </label>
                <label className="form-label">
                  Format
                  <select
                    className="field"
                    value={field.type}
                    onChange={(event) =>
                      fieldChange(field.id, {
                        type: event.target.value as NotePropertyField["type"],
                      })
                    }
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="date">Date</option>
                    <option value="checkbox">Checkbox</option>
                    <option value="select">Choice</option>
                  </select>
                </label>
                {field.type === "select" && (
                  <label className="form-label">
                    Choices, one per line
                    <textarea
                      className="field"
                      rows={3}
                      value={field.options.join("\n")}
                      onChange={(event) =>
                        fieldChange(field.id, {
                          options: event.target.value.split("\n"),
                        })
                      }
                    />
                  </label>
                )}
                <div className="note-type-field-actions">
                  <label>
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(event) =>
                        fieldChange(field.id, {
                          required: event.target.checked,
                        })
                      }
                    />
                    Required
                  </label>
                  <button
                    type="button"
                    className="btn danger"
                    onClick={() =>
                      change({
                        fields: draft.fields.filter(
                          (item) => item.id !== field.id,
                        ),
                      })
                    }
                  >
                    Remove property {index + 1}
                  </button>
                </div>
              </section>
            ))}
          </div>
          <button
            type="button"
            className="btn"
            disabled={draft.fields.length >= 30}
            onClick={() =>
              change({
                fields: [
                  ...draft.fields,
                  {
                    id: uid(),
                    name: "",
                    type: "text",
                    required: false,
                    options: [],
                  },
                ],
              })
            }
          >
            <Plus size={16} />
            Add property
          </button>
          {noteType && (
            <label className="note-type-archive">
              <input
                type="checkbox"
                checked={draft.archived}
                onChange={(event) => change({ archived: event.target.checked })}
              />
              Archive this type
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
            Close
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={editor.busy}
          >
            {editor.busy ? "Saving…" : "Save note type"}
          </button>
        </div>
      </form>
    </div>
  );
}
