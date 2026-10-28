"use client";
import {
  ArrowUpRight,
  Check,
  ImagePlus,
  Layers3,
  Link2,
  Plus,
  StickyNote,
  Trash2,
  Unlink,
} from "lucide-react";
import type { Canvas, CanvasCard } from "../../lib/types";
import { cssColor } from "./visual-helpers";
import { cardColors, cardColorNames } from "./canvas-model";

interface CanvasInspectorProps {
  canvas: Canvas | null;
  selectedCard?: CanvasCard;
  edge?: Canvas["edges"][number];
  writable: boolean;
  canCreateCanvas: boolean;
  connectingFrom: string;
  titleEditor: {
    active: boolean;
    value: string;
    onChange: (value: string) => void;
    onStart: () => void;
    onCommit: () => void;
    onCancel: () => void;
  };
  updateCard: (
    id: string,
    patch: Partial<CanvasCard>,
    persist?: boolean,
  ) => void;
  onCommit: () => void;
  onDeleteSelection: () => void;
  onOpenCard: (card: CanvasCard) => void;
  onConnect: (id: string) => void;
  onConnectionLabelChange: (id: string, label: string) => void;
  onCreateCanvas: () => void;
}

export function CanvasInspector({
  canvas,
  selectedCard,
  edge,
  writable,
  canCreateCanvas,
  connectingFrom,
  titleEditor,
  updateCard,
  onCommit,
  onDeleteSelection,
  onOpenCard,
  onConnect,
  onConnectionLabelChange,
  onCreateCanvas,
}: CanvasInspectorProps) {
  return (
    <aside
      className="canvas-inspector"
      id="canvas-details"
      aria-label="Canvas details"
    >
      <div className="visual-inspector-label">
        {selectedCard ? "Card details" : edge ? "Connection" : "Canvas details"}
      </div>
      {selectedCard ? (
        <>
          <div className="canvas-inspector-type">
            <span style={{ color: cssColor(selectedCard.color) }}>
              {selectedCard.type === "text"
                ? "Text"
                : selectedCard.type === "url"
                  ? "Web reference"
                  : selectedCard.type}
            </span>
            <button
              className="btn-icon visual-danger"
              aria-label="Delete card"
              disabled={!writable}
              title="Delete card"
              onClick={onDeleteSelection}
            >
              <Trash2 size={15} />
            </button>
          </div>
          <label className="visual-field-label">Accent color</label>
          <div
            className="canvas-colors"
            role="group"
            aria-label="Card accent color"
          >
            {cardColors.map((color, index) => (
              <button
                key={color}
                aria-label={`${cardColorNames[index]} accent`}
                disabled={!writable}
                aria-pressed={selectedCard.color === color}
                title={`${cardColorNames[index]} accent`}
                style={{ background: color }}
                className={selectedCard.color === color ? "active" : ""}
                onClick={() => updateCard(selectedCard.id, { color })}
              >
                {selectedCard.color === color && <Check size={12} />}
              </button>
            ))}
          </div>
          {(selectedCard.type === "text" || selectedCard.type === "url") && (
            <>
              <label className="visual-field-label" htmlFor="canvas-card-text">
                {selectedCard.type === "url"
                  ? "Website address"
                  : "Card text"}
              </label>
              <textarea
                id="canvas-card-text"
                readOnly={!writable}
                className="field canvas-edit-text"
                value={selectedCard.text}
                placeholder={
                  selectedCard.type === "url"
                    ? "https://…"
                    : "Add a note, question, or reminder…"
                }
                onChange={(e) => {
                  updateCard(selectedCard.id, { text: e.target.value }, false);
                }}
                onBlur={onCommit}
              />
              <p className="visual-input-hint">
                {selectedCard.type === "url"
                  ? "Use a complete http:// or https:// address."
                  : "Changes save when you leave this field."}
              </p>
            </>
          )}
          {(selectedCard.type === "note" || selectedCard.type === "task") && (
            <button
              className="btn graph-open"
              onClick={() => onOpenCard(selectedCard)}
            >
              Open {selectedCard.type}
              <ArrowUpRight size={14} />
            </button>
          )}
          <div className="canvas-card-size">
            <label>
              Width
              <input
                type="number"
                className="field"
                min={200}
                value={Math.round(selectedCard.width)}
                readOnly={!writable}
                onChange={(e) =>
                  updateCard(
                    selectedCard.id,
                    {
                      width: Math.max(200, Number(e.target.value) || 200),
                    },
                    false,
                  )
                }
                onBlur={onCommit}
              />
            </label>
            <label>
              Height
              <input
                type="number"
                className="field"
                min={150}
                value={Math.round(selectedCard.height)}
                readOnly={!writable}
                onChange={(e) =>
                  updateCard(
                    selectedCard.id,
                    {
                      height: Math.max(150, Number(e.target.value) || 150),
                    },
                    false,
                  )
                }
                onBlur={onCommit}
              />
            </label>
          </div>
          <label className="visual-field-label">Position</label>
          <div className="canvas-card-size">
            <label>
              X
              <input
                type="number"
                className="field"
                value={Math.round(selectedCard.x)}
                readOnly={!writable}
                onChange={(e) =>
                  updateCard(
                    selectedCard.id,
                    { x: Number(e.target.value) || 0 },
                    false,
                  )
                }
                onBlur={onCommit}
              />
            </label>
            <label>
              Y
              <input
                type="number"
                className="field"
                value={Math.round(selectedCard.y)}
                readOnly={!writable}
                onChange={(e) =>
                  updateCard(
                    selectedCard.id,
                    { y: Number(e.target.value) || 0 },
                    false,
                  )
                }
                onBlur={onCommit}
              />
            </label>
          </div>
          <button
            className="btn canvas-connect-button"
            disabled={!writable}
            aria-pressed={connectingFrom === selectedCard.id}
            onClick={() => onConnect(selectedCard.id)}
          >
            <Link2 size={14} /> Connect this card
          </button>
          <p className="visual-muted canvas-detail-hint">
            Drag the header to move, or use arrow keys on the card. Adjust
            width, height, and position above for precise placement.
          </p>
        </>
      ) : edge ? (
        <>
          <div className="canvas-inspector-type">
            <span>Directed connection</span>
            <button
              className="btn-icon visual-danger"
              aria-label="Delete connection"
              disabled={!writable}
              onClick={onDeleteSelection}
            >
              <Unlink size={15} />
            </button>
          </div>
          <label className="visual-field-label" htmlFor="canvas-edge-label">
            Connection label
          </label>
          <input
            key={edge.id}
            id="canvas-edge-label"
            readOnly={!writable}
            className="field"
            defaultValue={edge.label}
            placeholder="e.g. inspires, depends on…"
            onBlur={(event) =>
              onConnectionLabelChange(edge.id, event.target.value)
            }
          />
          <p className="visual-muted canvas-detail-hint">
            Label the connection to describe the relationship.
          </p>
        </>
      ) : (
        <>
          <div className="canvas-detail-icon">
            <Layers3 size={25} />
          </div>
          {titleEditor.active ? (
            <input
              className="field canvas-title-input"
              aria-label="Canvas title"
              readOnly={!writable}
              autoFocus
              value={titleEditor.value}
              onChange={(e) => titleEditor.onChange(e.target.value)}
              onBlur={titleEditor.onCommit}
              onKeyDown={(e) => {
                if (e.key === "Enter") titleEditor.onCommit();
                if (e.key === "Escape") titleEditor.onCancel();
              }}
            />
          ) : (
            <button
              className="canvas-title-button"
              disabled={!writable}
              onClick={titleEditor.onStart}
            >
              {canvas?.title || "Canvas"}
              <span>{writable ? "Rename canvas" : "View only"}</span>
            </button>
          )}
          <p className="visual-muted">
            Arrange cards and add connections to plan your work.
          </p>
          <div className="graph-stats canvas-stats">
            <div>
              <strong>{canvas?.cards.length || 0}</strong>
              <span>cards</span>
            </div>
            <div>
              <strong>{canvas?.edges.length || 0}</strong>
              <span>connections</span>
            </div>
          </div>
          <div className="visual-inspector-label canvas-guide-heading">
            Canvas controls
          </div>
          <div className="graph-hint">
            <StickyNote size={15} />
            <span>Add text for notes and reminders.</span>
          </div>
          <div className="graph-hint">
            <Link2 size={15} />
            <span>Connect cards and label their relationships.</span>
          </div>
          <div className="graph-hint">
            <ImagePlus size={15} />
            <span>Add images, audio, video, and PDFs.</span>
          </div>
          <button
            className="btn graph-open"
            onClick={onCreateCanvas}
            disabled={!canCreateCanvas}
          >
            <Plus size={14} /> New canvas
          </button>
        </>
      )}
    </aside>
  );
}
