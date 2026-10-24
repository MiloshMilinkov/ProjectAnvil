"use client";

import type { Note, NoteType } from "../lib/types";
import "./note-structures.css";

export default function NoteStructuredFields({
  note,
  types,
  onChange,
  onManage,
}: {
  note: Note;
  types: NoteType[];
  onChange: (patch: Partial<Note>) => void;
  onManage: () => void;
}) {
  const selected = types.find((type) => type.id === note.customTypeId);
  const values = note.propertyValues || {};
  const missing =
    selected?.fields.filter(
      (field) => field.required && !values[field.id]?.trim(),
    ) || [];
  function choose(id: string) {
    if (id === (note.customTypeId || "")) return;
    if (
      Object.values(values).some(Boolean) &&
      !window.confirm(
        "Change the custom note type and clear its structured values? Your note content and freeform properties will remain.",
      )
    )
      return;
    onChange({ customTypeId: id, propertyValues: {} });
  }
  function valueChange(id: string, value: string) {
    onChange({ propertyValues: { ...values, [id]: value } });
  }
  return (
    <div className="note-structured-fields" data-tour="custom-note-types">
      <label className="form-label">
        Custom note type
        <select
          className="field"
          value={note.customTypeId || ""}
          onChange={(event) => choose(event.target.value)}
        >
          <option value="">No custom type</option>
          {note.customTypeId && !selected && (
            <option value={note.customTypeId}>
              Unavailable type — choose another
            </option>
          )}
          {types
            .filter((type) => !type.archived || type.id === note.customTypeId)
            .map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
                {type.archived ? " (archived)" : ""}
              </option>
            ))}
        </select>
      </label>
      <button type="button" className="btn" onClick={onManage}>
        Manage note types
      </button>
      {selected?.description && (
        <p className="note-structure-help">{selected.description}</p>
      )}
      {missing.length > 0 && (
        <p className="note-structure-help" role="status">
          {missing.length} required{" "}
          {missing.length === 1 ? "property needs" : "properties need"} a value.
          You can finish this draft later.
        </p>
      )}
      {selected?.fields.map((field) => (
        <label
          className={`form-label note-structured-property ${field.type === "checkbox" ? "note-structured-check" : ""}`}
          key={field.id}
        >
          <span>
            {field.name}
            {field.required && <small>Required</small>}
          </span>
          {field.type === "checkbox" ? (
            <select
              className="field"
              value={values[field.id] || ""}
              onChange={(event) => valueChange(field.id, event.target.value)}
            >
              <option value="">Not set</option>
              <option value="true">Checked</option>
              <option value="false">Unchecked</option>
            </select>
          ) : field.type === "select" ? (
            <select
              className="field"
              value={values[field.id] || ""}
              onChange={(event) => valueChange(field.id, event.target.value)}
            >
              <option value="">Choose…</option>
              {values[field.id] &&
                !field.options.includes(values[field.id]) && (
                  <option value={values[field.id]}>
                    Unavailable choice: {values[field.id]}
                  </option>
                )}
              {field.options.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          ) : (
            <input
              className="field"
              type={field.type === "date" ? "date" : "text"}
              inputMode={field.type === "number" ? "decimal" : undefined}
              maxLength={2000}
              value={values[field.id] || ""}
              onChange={(event) => valueChange(field.id, event.target.value)}
            />
          )}
        </label>
      ))}
    </div>
  );
}
