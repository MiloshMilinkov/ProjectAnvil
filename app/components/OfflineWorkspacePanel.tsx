"use client";

import { useEffect, useRef, useState } from "react";
import { Download, HardDrive, RefreshCw } from "lucide-react";
import type { OfflineWorkspaceCopy } from "../lib/offline-store";
import {
  cacheOfflineMedia,
  offlineMediaUrl,
  readOfflineWorkspace,
  OFFLINE_LIMITS,
} from "../lib/offline-store";
import { readDownloadBlob } from "../lib/response-bytes";
import type { Notify } from "../lib/types";
import { useWorkspaceFetch, useWorkspaceScope } from "./WorkspaceScope";
import { useDraftScope } from "./useRecoverableDraft";
import "./offline-workspace.css";

export default function OfflineWorkspacePanel({
  copy,
  error,
  queued,
  busy,
  onEnable,
  onForget,
  onSynchronize,
  onReview,
  notify,
}: {
  copy: OfflineWorkspaceCopy | null;
  error: string;
  queued: number;
  busy: boolean;
  onEnable: () => Promise<void>;
  onForget: () => Promise<void>;
  onSynchronize: () => Promise<void>;
  onReview: () => void;
  notify: Notify;
}) {
  const scope = useDraftScope();
  const fetchWorkspace = useWorkspaceFetch();
  const { isOffline } = useWorkspaceScope();
  const [working, setWorking] = useState(false),
    [message, setMessage] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [protectedStorage, setProtectedStorage] = useState<boolean | null>(
    null,
  );
  const download = useRef<AbortController | null>(null);
  useEffect(() => {
    void navigator.storage
      ?.persisted?.()
      .then(setProtectedStorage)
      .catch(() => {});
    return () => {
      download.current?.abort();
    };
  }, []);
  async function run(action: () => Promise<void>) {
    if (working) return;
    setWorking(true);
    setMessage("");
    try {
      await action();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "This offline action could not finish.",
      );
    } finally {
      setWorking(false);
    }
  }
  async function saveAttachments() {
    const controller = new AbortController();
    download.current = controller;
    setDownloading(true);
    let kept = 0,
      tooLarge = 0;
    try {
      const current = await readOfflineWorkspace(scope);
      if (!current?.workspace)
        throw new Error("Save a fresh offline workspace copy first.");
      const cached = new Set(current.attachments.map((file) => file.id));
      for (const file of current.workspace.media) {
        if (controller.signal.aborted) break;
        const url = offlineMediaUrl(file, scope.workspaceId);
        if (!url || cached.has(file.id)) continue;
        if (file.size > OFFLINE_LIMITS.attachmentBytes) {
          tooLarge++;
          continue;
        }
        if (cached.size + kept >= OFFLINE_LIMITS.attachmentsPerWorkspace)
          throw new Error(
            "This workspace has reached its offline attachment limit.",
          );
        const response = await fetchWorkspace(url, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok)
          throw new Error(
            "An attachment is no longer available. Refresh the workspace before trying again.",
          );
        await cacheOfflineMedia(
          scope,
          file.id,
          await readDownloadBlob(
            response,
            Math.min(file.size + 1, OFFLINE_LIMITS.attachmentBytes),
            controller.signal,
          ),
          current.token,
        );
        kept++;
        setMessage(
          `${kept} ${kept === 1 ? "attachment saved" : "attachments saved"} on this device…`,
        );
      }
      setMessage(
        controller.signal.aborted
          ? `Stopped. ${kept} downloaded attachments are kept.`
          : `${kept} new ${kept === 1 ? "attachment" : "attachments"} saved on this device. Existing copies were kept.${tooLarge ? ` ${tooLarge} oversized files need the local server.` : ""}`,
      );
    } catch (cause) {
      if (controller.signal.aborted)
        setMessage(`Stopped. ${kept} downloaded attachments are kept.`);
      else
        throw new Error(
          `${cause instanceof Error ? cause.message : "Attachment download failed."} ${kept} downloaded attachments are kept.`,
        );
    } finally {
      download.current = null;
      setDownloading(false);
    }
  }
  return (
    <section
      className="panel settings-section offline-settings"
      data-tour="offline-workspace"
    >
      <h2>
        <HardDrive size={20} /> Offline workspace
      </h2>
      <p>
        Save available work on this device. Edit while disconnected and
        synchronize after reconnecting to the local server.
      </p>
      <p className="offline-privacy">
        Use a trusted device. Saved copies can remain readable while
        disconnected.
      </p>
      {copy ? (
        <div className="offline-copy-summary">
          <strong>
            {copy.workspace
              ? "Offline copy enabled"
              : "Refreshing offline access"}
          </strong>
          <span>
            {copy.workspace
              ? `Last copied ${new Date(copy.savedAt).toLocaleString()}`
              : "Connect and reload to refresh the records available to you."}
          </span>
          <span>
            {copy.attachments.length}{" "}
            {copy.attachments.length === 1 ? "attachment" : "attachments"} kept
            · {queued} queued {queued === 1 ? "change" : "changes"}
          </span>
        </div>
      ) : (
        <p className="muted">
          Offline access is off for this workspace. Connect once to save its
          current records.
        </p>
      )}
      <div className="offline-actions">
        <button
          className="btn btn-primary"
          disabled={working || busy || isOffline}
          onClick={() =>
            void run(async () => {
              await onEnable();
              notify("Offline workspace copy saved");
            })
          }
        >
          <Download size={16} />
          {copy ? "Refresh offline copy" : "Save workspace offline"}
        </button>
        {copy && (
          <>
            <button
              className="btn"
              data-tour="offline-attachments"
              disabled={working || busy || isOffline || !copy.workspace}
              onClick={() => void run(saveAttachments)}
            >
              Save attachments offline
            </button>
            <button
              className="btn"
              disabled={working || busy || isOffline || !queued}
              onClick={() => void run(onSynchronize)}
            >
              <RefreshCw size={16} />
              Synchronize now
            </button>
            {!!queued && (
              <button className="btn" disabled={busy} onClick={onReview}>
                Review queued changes
              </button>
            )}
            <button
              className="btn"
              disabled={working || busy}
              onClick={() =>
                void run(async () => {
                  if (queued)
                    throw new Error(
                      "Synchronize or download and review queued changes before removing the offline workspace copy.",
                    );
                  await onForget();
                  notify("Offline workspace copy removed from this device");
                })
              }
            >
              Remove offline copy
            </button>
          </>
        )}
        {downloading && (
          <button className="btn" onClick={() => download.current?.abort()}>
            Stop downloads
          </button>
        )}
      </div>
      <details className="offline-storage-options">
        <summary>Storage and privacy</summary>
        <p className="small-text muted">
          Signing out removes offline workspace copies. Unfinished drafts stay
          in their account’s recovery storage.
        </p>
        {copy && protectedStorage === false && (
          <button
            className="btn"
            disabled={working}
            onClick={() =>
              void run(async () => {
                const result = await navigator.storage?.persist?.();
                setProtectedStorage(!!result);
                setMessage(
                  result
                    ? "The browser granted persistent storage. Keep backups too."
                    : "The browser did not grant persistent storage. Keep regular backups and avoid clearing site data.",
                );
              })
            }
          >
            Request persistent storage
          </button>
        )}
        <p className="small-text muted">
          Offline copies stay in this browser profile at this local address. The
          normal local launcher prepares offline reopening. Files must be saved
          separately; uploads, account changes, imports, and Trash restore need
          the local server. Browser storage is separate from complete local
          backups.
        </p>
      </details>
      {(error || message) && (
        <p role={error ? "alert" : "status"} className="offline-feedback">
          {error || message}
        </p>
      )}
    </section>
  );
}
