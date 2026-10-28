"use client";

import { Download, RefreshCw, Users, WifiOff } from "lucide-react";
import type { CollaborationStatus } from "./useNoteCollaboration";
import "./live-notes.css";

export default function LiveNoteStatus({
  status,
  error,
  recoveryError,
  peers,
  content,
  onRetry,
  onReload,
  onRestart,
  earlierDrafts = [],
}: {
  status: CollaborationStatus;
  error: string;
  recoveryError: string;
  peers: { id: string; name: string }[];
  content: string;
  onRetry: () => void;
  onReload: () => void;
  onRestart: () => void;
  earlierDrafts: { id: string; content: string; updatedAt: string }[];
}) {
  const labels: Record<CollaborationStatus, string> = {
    opening: "Opening shared editing…",
    saved: "Shared editing · Saved",
    saving: "Shared editing · Saving…",
    offline: "Connection interrupted",
    review: "Review recovered changes",
    "read-only": "Shared editing · Read only",
  };
  function download(text = content) {
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "projectanvil-unfinished-note.md";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section
      className="live-note-status"
      data-tour="simultaneous-editing"
      aria-label="Shared note editing"
    >
      <div className="live-note-state" role="status">
        {status === "offline" ? <WifiOff size={16} /> : <Users size={16} />}
        <strong>{labels[status]}</strong>
        <span>
          {peers.length
            ? `Here now: ${peers
                .slice(0, 4)
                .map((peer) => peer.name)
                .join(
                  ", ",
                )}${peers.length > 4 ? ` and ${peers.length - 4} more` : ""}`
            : status === "opening" ? "Checking participants…" : "No participants listed"}
        </span>
      </div>
      {(error || recoveryError) && <p role="alert">{error || recoveryError}</p>}
      {(error || recoveryError) && (
        <div className="live-note-recovery">
          <button type="button" className="btn" onClick={onRetry}>
            <RefreshCw size={16} />
            Retry sync
          </button>
          <button type="button" className="btn" onClick={() => download()}>
            <Download size={16} />
            Download my text
          </button>
          <button type="button" className="btn" onClick={onReload}>
            Load saved version
          </button>
          {(error + recoveryError).includes("history limit") && (
            <button type="button" className="btn" onClick={onRestart}>
              Restart shared session
            </button>
          )}
        </div>
      )}
      {earlierDrafts.length > 0 && (
        <details className="live-note-earlier">
          <summary>Earlier shared drafts ({earlierDrafts.length})</summary>
          <p className="live-note-help">
            These copies belong to a replaced editing session. Download useful
            text before loading the saved version.
          </p>
          {earlierDrafts.map((draft, index) => (
            <button
              type="button"
              className="btn"
              key={draft.id}
              onClick={() => download(draft.content)}
            >
              <Download size={16} />
              Download draft {index + 1} ·{" "}
              {new Date(draft.updatedAt).toLocaleString()}
            </button>
          ))}
        </details>
      )}
      <p className="live-note-help">
        Markdown edits merge with other active editors. Other note properties
        keep their normal conflict checks.
      </p>
    </section>
  );
}
