"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useWorkspaceFetch } from "./WorkspaceScope";

interface Report {
  activeBytes: number;
  limitBytes: number;
  history: { versions: number; bytes: number };
  media: {
    active: number;
    retained: number;
    retainedBytes: number;
    pending: number;
    missing: { id: string; name: string }[];
    untracked: number;
    partial: boolean;
  };
  retention: string;
}
const size = (bytes: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(
    bytes < 1_000_000 ? bytes / 1_000 : bytes / 1_000_000,
  ) + (bytes < 1_000_000 ? " KB" : " MB");

/** A read-only health check; retained attachments are never silently deleted. */
export default function StorageHealth() {
  const scopedFetch = useWorkspaceFetch();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const mounted = useRef(false);
  const running = useRef(false);
  const check = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const response = await scopedFetch("/api/storage", { cache: "no-store" });
      const data = (await response.json()) as Report & { error?: string };
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
  return (
    <section className="panel settings-section" data-tour="storage-health">
      <h2>Storage & recovery</h2>
      <p>
        Check the active workspace allowance, archived history, and attachment
        references. Complete backups preserve the database and files together.
      </p>
      {report && (
        <>
          <label className="storage-meter-label">
            Active records: {size(report.activeBytes)} of{" "}
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
            {report.history.versions} archived note versions (
            {size(report.history.bytes)}), stored outside the active allowance.{" "}
            {report.media.active} active attachments; {report.media.retained}{" "}
            retained files ({size(report.media.retainedBytes)}).
          </p>
          {report.media.missing.length > 0 && (
            <div className="warning-box" role="alert">
              Missing attachment files:{" "}
              {report.media.missing.map((file) => file.name).join(", ")}.
              Restore their files from a complete backup, or re-upload them.
            </div>
          )}
          {(report.media.pending > 0 || report.media.untracked > 0) && (
            <p>
              {report.media.pending} incomplete uploads and{" "}
              {report.media.untracked} untracked files found. Files are retained
              for recovery.
            </p>
          )}
          {report.media.partial && (
            <p>
              The file scan reached its limit. The totals may exclude additional
              retained files.
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
      <button className="btn" disabled={busy} onClick={() => void check()}>
        <RefreshCw size={15} />
        {busy ? "Checking storage…" : "Check storage"}
      </button>
    </section>
  );
}
