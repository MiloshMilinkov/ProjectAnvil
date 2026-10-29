"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { RefreshCw } from "lucide-react";
import { useWorkspaceFetch } from "./WorkspaceScope";
import type {
  StorageCleanupPreview,
  StorageReport,
} from "../lib/storage-cleanup";

const size = (bytes: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(
    bytes < 1_000_000 ? bytes / 1_000 : bytes / 1_000_000,
  ) + (bytes < 1_000_000 ? " KB" : " MB");

/** Cleanup is always reviewed and explicitly applied; no automatic retention job. */
export default function StorageHealth() {
  const scopedFetch = useWorkspaceFetch();
  const [report, setReport] = useState<StorageReport | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [retentionDays, setRetentionDays] = useState<30 | 90 | 365>(90);
  const [remove, setRemove] = useState({
    uploads: false,
    trash: false,
    history: false,
  });
  const [preview, setPreview] = useState<StorageCleanupPreview | null>(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const retentionId = useId();
  const previewRef = useRef<HTMLDivElement>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const focusTarget = useRef<"preview" | "review" | null>(null);
  const mounted = useRef(false);
  const running = useRef(false);
  useLayoutEffect(() => {
    if (!focusTarget.current || busy || cleanupBusy) return;
    const target =
      focusTarget.current === "preview"
        ? previewRef.current
        : reviewButton.current;
    if (target?.isConnected && !target.matches(":disabled")) {
      target.focus();
      focusTarget.current = null;
    }
  }, [preview, busy, cleanupBusy]);
  const check = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const response = await scopedFetch("/api/storage", { cache: "no-store" });
      const data = (await response.json()) as StorageReport & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(data.error || "Storage could not be checked.");
      if (mounted.current) {
        setReport(data);
        setError("");
      }
    } catch (error) {
      if (mounted.current)
        setError(
          error instanceof Error
            ? error.message
            : "Storage could not be checked.",
        );
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [scopedFetch]);
  useEffect(() => {
    mounted.current = true;
    const frame = requestAnimationFrame(() => void check());
    return () => {
      mounted.current = false;
      cancelAnimationFrame(frame);
    };
  }, [check]);
  async function cleanup(action: "preview" | "apply") {
    if (running.current || cleanupBusy) return;
    setCleanupBusy(true);
    setError("");
    setFeedback("");
    let returnFocus = action === "apply";
    try {
      const response = await scopedFetch("/api/storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "preview"
            ? { action, retentionDays, remove }
            : {
                action,
                preview: preview && {
                  token: preview.token,
                  expiresAt: preview.expiresAt,
                  retentionDays: preview.retentionDays,
                  remove: preview.remove,
                },
                confirmed: true,
              },
        ),
      });
      const data = (await response.json()) as Partial<StorageCleanupPreview> & {
        error?: string;
        message?: string;
      };
      if (!response.ok)
        throw new Error(
          data.error ||
            "Cleanup could not be completed. Review storage and try again.",
        );
      if (!mounted.current) return;
      if (action === "preview") {
        focusTarget.current = "preview";
        setPreview(data as StorageCleanupPreview);
      } else {
        setPreview(null);
        setFeedback(data.message || "Cleanup completed.");
        await check();
      }
    } catch (cause) {
      returnFocus = true;
      if (mounted.current) {
        setPreview(null);
        setError(
          cause instanceof Error
            ? cause.message
            : "Cleanup could not be completed. Check storage and review again.",
        );
      }
    } finally {
      if (mounted.current) {
        if (returnFocus) focusTarget.current = "review";
        setCleanupBusy(false);
      }
    }
  }
  return (
    <section className="panel settings-section" data-tour="storage-health">
      <h2>Storage & recovery</h2>
      <p>Check workspace data, saved note versions, and uploaded files.</p>
      {report && (
        <>
          <label className="storage-meter-label">
            Workspace text: {size(report.activeBytes)} of{" "}
            {size(report.limitBytes)}
            <meter
              className="storage-meter"
              min={0}
              max={report.limitBytes}
              value={report.activeBytes}
              low={report.limitBytes * 0.7}
              high={report.limitBytes * 0.9}
              optimum={0}
            />
          </label>
          <p className="small-text muted">
            {report.history.versions} saved note versions (
            {size(report.history.bytes)}), stored separately.{" "}
            {report.media.active} attachments; {report.media.retained} files
            kept for recovery ({size(report.media.retainedBytes)}).
          </p>
          {report.media.missing.length > 0 && (
            <div className="warning-box" role="alert">
              Missing attachment files:{" "}
              {report.media.missing.map((file) => file.name).join(", ")}.
              Restore the missing files from a complete backup or upload them
              again.
            </div>
          )}
          {(report.media.pending > 0 || report.media.untracked > 0) && (
            <p>
              {report.media.pending} incomplete uploads and{" "}
              {report.media.untracked} other stored files found. These files are
              kept for recovery.
            </p>
          )}
          {report.media.partial && (
            <p>
              The scan reached its limit. Some files kept for recovery may not
              be included in these totals.
            </p>
          )}
          {report.media.pendingCleanup > 0 && (
            <p role="status">
              {report.media.pendingCleanup} file removals need another attempt.
              Review unused uploaded files below to retry.
            </p>
          )}
          <p className="small-text muted">{report.retention}</p>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {feedback && <p role="status">{feedback}</p>}
      <button
        className="btn"
        disabled={busy || cleanupBusy}
        onClick={() => {
          setPreview(null);
          void check();
        }}
      >
        <RefreshCw size={15} aria-hidden="true" />
        {busy ? "Checking storage…" : "Check storage"}
      </button>
      {report?.canCleanup && (
        <details className="storage-cleanup settings-format-details">
          <summary>Clean up storage</summary>
          <p>
            Choose what to review. Referenced files and the newest saved version
            of each note are kept. Nothing is removed automatically.
          </p>
          <fieldset className="dialog-fields" disabled={busy || cleanupBusy}>
            <label className="form-label" htmlFor={retentionId}>
              <span>Only remove items older than</span>
              <select
                className="field"
                id={retentionId}
                value={retentionDays}
                onChange={(event) => {
                  setRetentionDays(Number(event.target.value) as 30 | 90 | 365);
                  setPreview(null);
                }}
              >
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
                <option value={365}>1 year</option>
              </select>
            </label>
            <div className="storage-cleanup-options">
              {(
                [
                  ["uploads", "Unused uploaded files"],
                  ["trash", "Items in Trash"],
                  ["history", "Older note versions"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={remove[key]}
                    onChange={(event) => {
                      setRemove((value) => ({
                        ...value,
                        [key]: event.target.checked,
                      }));
                      setPreview(null);
                    }}
                  />
                  {label}
                </label>
              ))}
            </div>
            <button
              ref={reviewButton}
              className="btn"
              disabled={!Object.values(remove).some(Boolean)}
              onClick={() => void cleanup("preview")}
            >
              {cleanupBusy ? "Checking cleanup…" : "Review cleanup"}
            </button>
          </fieldset>
          {preview && (
            <div
              className="storage-cleanup-review"
              tabIndex={-1}
              ref={previewRef}
              aria-label="Cleanup review"
            >
              <h3>Review before removing</h3>
              <ul>
                <li>
                  {preview.counts.uploads} uploaded files (
                  {size(preview.counts.uploadBytes)})
                </li>
                <li>{preview.counts.trash} items in Trash</li>
                <li>
                  {preview.counts.history} note versions (
                  {size(preview.counts.historyBytes)})
                </li>
              </ul>
              {preview.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
              <details className="settings-format-details">
                <summary>See examples (up to 50 per group)</summary>
                <ul className="storage-cleanup-items">
                  {preview.items.uploads.map((item) => (
                    <li key={`file-${item.id}`}>
                      File: {item.name} ({size(item.bytes)})
                    </li>
                  ))}
                  {preview.items.trash.map((item) => (
                    <li key={`trash-${item.id}`}>Trash: {item.title}</li>
                  ))}
                  {preview.items.history.map((item) => (
                    <li key={`note-${item.noteId}`}>
                      {item.versions} older versions of {item.title}
                    </li>
                  ))}
                </ul>
              </details>
              <p className="warning-box">
                Removal is permanent and cannot be undone. Synchronize pending
                work and keep a complete backup before continuing. Browser
                recovery copies are separate.
              </p>
              <div className="button-row">
                <button
                  className="btn"
                  disabled={cleanupBusy}
                  onClick={() => {
                    focusTarget.current = "review";
                    setPreview(null);
                  }}
                >
                  Cancel cleanup
                </button>
                <button
                  className="btn btn-danger"
                  disabled={
                    cleanupBusy || !Object.values(preview.counts).some(Boolean)
                  }
                  onClick={() => void cleanup("apply")}
                >
                  {cleanupBusy
                    ? "Removing…"
                    : "Permanently remove reviewed items"}
                </button>
              </div>
            </div>
          )}
        </details>
      )}
    </section>
  );
}
