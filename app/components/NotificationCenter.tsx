"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { CheckCheck, Inbox, RefreshCw, X } from "lucide-react";
import type { FeatureProps } from "../lib/types";
import type {
  NotificationPage,
  WorkspaceNotification,
} from "../lib/collaboration-types";
import { useWorkspaceFetch, useWorkspaceScope } from "./WorkspaceScope";
import { useDialog } from "./useDialog";
import { ActivityDescription, activityTime } from "./ActivityCenter";
import "./team-collaboration.css";

type Props = Pick<FeatureProps, "openNote" | "openTask" | "notify"> & {
  onOpenProject?: (id: string) => void;
};
const empty: NotificationPage = {
  entries: [],
  nextCursor: null,
  unreadCount: 0,
  available: false,
};
export default function NotificationCenter(props: Props) {
  const fetchWorkspace = useWorkspaceFetch();
  const { account, activeId } = useWorkspaceScope();
  const securityRevision =
    account.workspaces.find((item) => item.id === activeId)?.securityRevision ||
    0;
  const signedIn = !!account.user;
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotificationPage>(empty);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [unread, setUnread] = useState(false);
  const alive = useRef(true);
  const activeRequest = useRef(false);
  const requestSequence = useRef(0);
  const generation = useRef(0);
  const load = useCallback(
    async (next?: string, force = false) => {
      if (!signedIn) {
        setData(empty);
        return;
      }
      if (activeRequest.current && !force) return;
      activeRequest.current = true;
      const requestId = ++requestSequence.current;
      const token = generation.current;
      const currentRequest = () =>
        alive.current &&
        token === generation.current &&
        requestId === requestSequence.current;
      setLoading(true);
      try {
        const query = new URLSearchParams({
          limit: "30",
          ...(unread ? { unread: "true" } : {}),
          ...(next ? { cursor: next } : {}),
        });
        const response = await fetchWorkspace(`/api/notifications?${query}`, {
          cache: "no-store",
        });
        const incoming = (await response.json()) as NotificationPage & {
          error?: string;
        };
        if (!response.ok) {
          if ([401, 403, 404].includes(response.status) && currentRequest())
            setData(empty);
          throw new Error(
            incoming.error || "Notifications could not be loaded.",
          );
        }
        if (!currentRequest()) return;
        setData((previous) => ({
          ...incoming,
          entries: next
            ? [
                ...previous.entries,
                ...incoming.entries.filter(
                  (entry) =>
                    !previous.entries.some((old) => old.id === entry.id),
                ),
              ]
            : incoming.entries,
        }));
        setError("");
      } catch (cause) {
        if (currentRequest())
          setError(
            cause instanceof Error
              ? cause.message
              : "Notifications could not be loaded.",
          );
      } finally {
        if (
          token === generation.current &&
          requestId === requestSequence.current
        )
          activeRequest.current = false;
        if (currentRequest()) setLoading(false);
      }
    },
    [fetchWorkspace, signedIn, unread],
  );
  useEffect(() => {
    alive.current = true;
    const token = ++generation.current;
    activeRequest.current = false;
    queueMicrotask(() => {
      if (generation.current !== token) return;
      setData(empty);
      setBusy("");
      setError("");
      void load();
    });
    const wake = () => {
      if (!document.hidden) void load();
    };
    const timer = setInterval(wake, 5_000);
    window.addEventListener("focus", wake);
    return () => {
      alive.current = false;
      generation.current = token + 1;
      clearInterval(timer);
      window.removeEventListener("focus", wake);
    };
  }, [load, securityRevision]);
  async function mark(id?: string) {
    if (busy) return false;
    const token = generation.current;
    setBusy(id || "all");
    setError("");
    try {
      const response = await fetchWorkspace("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          id ? { action: "read", id } : { action: "read-all" },
        ),
      });
      const result = (await response.json()) as { error?: string };
      if (!alive.current || token !== generation.current) return false;
      if (!response.ok)
        throw new Error(result.error || "The read status could not be saved.");
      // A poll started before this acknowledgement may still be in flight.
      // Replace its authority without changing the account/workspace generation.
      await load(undefined, true);
      return alive.current && token === generation.current;
    } catch (cause) {
      if (alive.current && token === generation.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "The read status could not be saved.",
        );
      return false;
    } finally {
      if (alive.current && token === generation.current) setBusy("");
    }
  }
  async function openItem(notification: WorkspaceNotification) {
    if (!notification.read && !(await mark(notification.id))) return;
    const ref = notification.activity.reference;
    if (!ref) return;
    setOpen(false);
    if (ref.type === "note") props.openNote(ref.id);
    else if (ref.type === "task") props.openTask(ref.id);
    else props.onOpenProject?.(ref.id);
  }
  return (
    <>
      <button
        type="button"
        className="btn-icon notification-trigger"
        aria-label={`Notifications${data.unreadCount ? `, ${data.unreadCount} unread` : ""}`}
        title="Notifications"
        onClick={() => {
          setOpen(true);
          void load();
        }}
        data-tour="notifications"
      >
        <Inbox size={18} aria-hidden="true" />
        {data.unreadCount > 0 && (
          <span aria-hidden="true">
            {data.unreadCount > 99 ? "99+" : data.unreadCount}
          </span>
        )}
      </button>
      {open &&
        createPortal(
          <NotificationDialog
            data={data}
            loading={loading}
            busy={busy}
            error={error}
            signedIn={!!account.user}
            unread={unread}
            setUnread={setUnread}
            onClose={() => setOpen(false)}
            onLoad={load}
            onMark={mark}
            onOpen={openItem}
            canOpenProject={!!props.onOpenProject}
          />,
          document.body,
        )}
    </>
  );
}

function NotificationDialog({
  data,
  loading,
  busy,
  error,
  signedIn,
  unread,
  setUnread,
  onClose,
  onLoad,
  onMark,
  onOpen,
  canOpenProject,
}: {
  data: NotificationPage;
  loading: boolean;
  busy: string;
  error: string;
  signedIn: boolean;
  unread: boolean;
  setUnread: (value: boolean) => void;
  onClose: () => void;
  onLoad: (cursor?: string) => Promise<void>;
  onMark: (id?: string) => Promise<boolean>;
  onOpen: (entry: WorkspaceNotification) => Promise<void>;
  canOpenProject: boolean;
}) {
  const ref = useRef<HTMLElement>(null),
    title = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const wasBusy = useRef(false);
  useDialog(ref, onClose, !!busy);
  useLayoutEffect(() => {
    // Read actions can remove the focused row or disable the read-all button.
    if (
      wasBusy.current &&
      !busy &&
      !ref.current?.contains(document.activeElement)
    )
      heading.current?.focus({ preventScroll: true });
    wasBusy.current = !!busy;
  }, [busy]);
  return (
    <div
      className="modal-shade"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title}
        className="notification-dialog"
      >
        <div className="dialog-heading">
          <h2 id={title} ref={heading} tabIndex={-1}>
            Notifications
          </h2>
          <button
            className="btn-icon"
            disabled={!!busy}
            aria-label="Close notifications"
            onClick={onClose}
          >
            <X size={19} aria-hidden="true" />
          </button>
        </div>
        {!signedIn ? (
          <div className="collaboration-empty">
            <Inbox size={28} aria-hidden="true" />
            <h3>Sign in for notifications</h3>
            <p>
              Receive mentions and updates to items you watch. Guest work does
              not require an account.
            </p>
          </div>
        ) : (
          <>
            <p className="collaboration-scope">
              Mentions and updates in this workspace · {data.unreadCount} unread
            </p>
            <div className="notification-toolbar">
              <div role="group" aria-label="Notification filter">
                <button
                  className="btn"
                  aria-pressed={!unread}
                  disabled={!!busy}
                  onClick={() => setUnread(false)}
                >
                  All
                </button>
                <button
                  className="btn"
                  aria-pressed={unread}
                  disabled={!!busy}
                  onClick={() => setUnread(true)}
                >
                  Unread
                </button>
              </div>
              <button
                className="btn"
                disabled={loading || !!busy}
                onClick={() => void onLoad()}
              >
                <RefreshCw size={16} aria-hidden="true" />
                Refresh
              </button>
              <button
                className="btn"
                disabled={!data.unreadCount || !!busy}
                onClick={() => void onMark()}
              >
                <CheckCheck size={16} aria-hidden="true" />
                {busy === "all" ? "Saving…" : "Mark all read"}
              </button>
            </div>
            {error && (
              <p
                className="collaboration-notice collaboration-error"
                role="alert"
              >
                {error}
              </p>
            )}
            {loading && !data.entries.length ? (
              <p className="collaboration-empty" role="status">
                Loading notifications…
              </p>
            ) : !data.entries.length ? (
              <div className="collaboration-empty">
                <Inbox size={28} aria-hidden="true" />
                <h3>
                  {unread ? "No unread notifications" : "No notifications yet"}
                </h3>
                <p>Mentions and changes to items you watch appear here.</p>
              </div>
            ) : (
              <ol className="notification-list">
                {data.entries.map((entry) => (
                  <li key={entry.id} className={entry.read ? "" : "is-unread"}>
                    <div className="notification-kind">
                      {entry.reason === "mention"
                        ? "You were mentioned"
                        : "Watched item updated"}
                      {!entry.read && <span>Unread</span>}
                    </div>
                    <p>
                      <ActivityDescription entry={entry.activity} />
                    </p>
                    <time dateTime={entry.createdAt}>
                      {activityTime(entry.createdAt)}
                    </time>
                    <div className="notification-actions">
                      {entry.activity.reference &&
                        (entry.activity.reference.type !== "project" ||
                          canOpenProject) && (
                          <button
                            className="btn"
                            disabled={!!busy}
                            onClick={() => void onOpen(entry)}
                          >
                            Open {entry.activity.reference.type}
                          </button>
                        )}
                      {!entry.read && (
                        <button
                          className="btn"
                          disabled={!!busy}
                          onClick={() => void onMark(entry.id)}
                        >
                          {busy === entry.id ? "Saving…" : "Mark read"}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {data.nextCursor && (
              <button
                className="btn activity-more"
                disabled={loading || !!busy}
                onClick={() => void onLoad(data.nextCursor!)}
              >
                {loading ? "Loading…" : "Load older notifications"}
              </button>
            )}
            <p className="collaboration-footnote">
              In-app notifications only. Updates to watched items are grouped.
              Your own changes do not notify you.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
