"use client";
import { useRef } from "react";
import {
  CheckSquare2,
  FileText,
  Globe2,
  ImagePlus,
  Loader2,
  Plus,
  Search,
  StickyNote,
  X,
} from "lucide-react";
import type { CanvasCard, Media, Note, Task } from "../../lib/types";
import { useDialog } from "../useDialog";
import { isHttp } from "./canvas-model";

interface CanvasAddDialogProps {
  addType: CanvasCard["type"];
  addSearch: string;
  newText: string;
  visibleItems: (Note | Task)[];
  allMedia: Media[];
  uploading: boolean;
  onClose: () => void;
  onTypeChange: (type: CanvasCard["type"]) => void;
  onSearchChange: (value: string) => void;
  onTextChange: (value: string) => void;
  addCard: (type: CanvasCard["type"], entityId?: string, text?: string) => void;
  onUploadRequest: () => void;
}

export function CanvasAddDialog({
  addType,
  addSearch,
  newText,
  visibleItems,
  allMedia,
  uploading,
  onClose,
  onTypeChange,
  onSearchChange,
  onTextChange,
  addCard,
  onUploadRequest,
}: CanvasAddDialogProps) {
  const addDialog = useRef<HTMLDivElement>(null);
  useDialog(addDialog, onClose);
  return (
    <div
      className="visual-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={addDialog}
        className="visual-add-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-add-title"
      >
        <div className="visual-modal-heading">
          <div>
            <h2 id="canvas-add-title">Add a card</h2>
            <p>Choose a note, task, text, file, or website.</p>
          </div>
          <button
            className="btn-icon"
            aria-label="Close add card"
            onClick={() => onClose()}
          >
            <X size={19} />
          </button>
        </div>
        <div className="canvas-add-types" role="group" aria-label="Card type">
          {(
            [
              { type: "note", label: "Note", icon: FileText },
              { type: "task", label: "Task", icon: CheckSquare2 },
              { type: "text", label: "Text", icon: StickyNote },
              { type: "media", label: "Media", icon: ImagePlus },
              { type: "url", label: "Website", icon: Globe2 },
            ] as const
          ).map((item) => (
            <button
              key={item.type}
              aria-pressed={addType === item.type}
              className={addType === item.type ? "active" : ""}
              onClick={() => {
                onTypeChange(item.type);
                onSearchChange("");
                onTextChange("");
              }}
            >
              <item.icon size={17} />
              {item.label}
            </button>
          ))}
        </div>
        {(addType === "note" || addType === "task") && (
          <>
            <label className="visual-search canvas-add-search">
              <Search size={15} />
              <input
                value={addSearch}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={`Find a ${addType}…`}
                aria-label={`Search ${addType}s`}
              />
            </label>
            <div className="canvas-add-list">
              {visibleItems.map((item) => (
                <button key={item.id} onClick={() => addCard(addType, item.id)}>
                  <span className="canvas-add-item-icon">
                    {addType === "note" ? (
                      <FileText size={17} />
                    ) : (
                      <CheckSquare2 size={17} />
                    )}
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {"key" in item ? item.key : item.folder || item.kind}
                    </small>
                  </span>
                  <Plus size={16} />
                </button>
              ))}
              {!visibleItems.length && (
                <div className="canvas-no-results">
                  No {addType}s found. Create one from the workspace first.
                </div>
              )}
            </div>
          </>
        )}
        {addType === "text" && (
          <div className="canvas-add-form">
            <label className="visual-field-label" htmlFor="new-canvas-thought">
              Card text
            </label>
            <textarea
              id="new-canvas-thought"
              className="field"
              rows={7}
              placeholder="Add a note, question, or reminder…"
              value={newText}
              onChange={(e) => onTextChange(e.target.value)}
            />
            <button
              className="btn btn-primary"
              onClick={() => addCard("text", "", newText)}
            >
              <Plus size={15} /> Add text
            </button>
          </div>
        )}
        {addType === "url" && (
          <div className="canvas-add-form">
            <label className="visual-field-label" htmlFor="new-canvas-url">
              Reference website
            </label>
            <input
              id="new-canvas-url"
              className="field"
              placeholder="https://example.com"
              type="url"
              value={newText}
              onChange={(e) => onTextChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && isHttp(newText))
                  addCard("url", "", newText);
              }}
            />
            <p className="visual-muted">
              Add a website link to the canvas.
            </p>
            <button
              className="btn btn-primary"
              disabled={!isHttp(newText)}
              onClick={() => addCard("url", "", newText)}
            >
              <Plus size={15} /> Add website
            </button>
          </div>
        )}
        {addType === "media" && (
          <div className="canvas-add-form">
            <button
              className="canvas-upload-zone"
              onClick={() => onUploadRequest()}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 size={28} className="visual-spin" />
              ) : (
                <ImagePlus size={28} />
              )}
              <strong>
                {uploading
                  ? "Uploading file…"
                  : "Upload a file"}
              </strong>
              <span>Images, PDFs, audio, and video · Up to 20 MB per file</span>
            </button>
            {allMedia.length > 0 && (
              <>
                <label className="visual-field-label">
                  Or use an existing attachment
                </label>
                <div className="canvas-add-list canvas-existing-media">
                  {allMedia.map((media) => (
                    <button
                      key={media.id}
                      onClick={() => addCard("media", media.id, media.name)}
                    >
                      <ImagePlus size={17} />
                      <span>
                        <strong>{media.name}</strong>
                        <small>
                          {(media.size / 1024 / 1024).toFixed(1)} MB
                        </small>
                      </span>
                      <Plus size={15} />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
