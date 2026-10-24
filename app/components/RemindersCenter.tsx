"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, Check, Clock3, RotateCcw, X } from "lucide-react";
import type { Workspace } from "../lib/types";
import { readBrowserPreference } from "../lib/browser-preferences";
import {
  parseReminderPreferences,
  scheduledReminders,
  visibleReminders,
  type ReminderPreferences,
} from "../lib/reminder-state";
import { useDraftScope } from "./useRecoverableDraft";
import { useDialog } from "./useDialog";
import "./planning-actions.css";

export default function RemindersCenter({
  workspace,
  currentPerson,
  openTask,
}: {
  workspace: Workspace;
  currentPerson: string;
  openTask: (id: string) => void;
}) {
  const scope = useDraftScope();
  const storageKey = `projectanvil-reminders-v1:${encodeURIComponent(scope.accountId)}:${encodeURIComponent(scope.workspaceId)}`;
  const read = () => {
    try {
      return parseReminderPreferences(
        JSON.parse(readBrowserPreference(storageKey) || "null"),
      );
    } catch {
      return parseReminderPreferences(null);
    }
  };
  const [preferences, setPreferences] = useState(read);
  const [now, setNow] = useState(0);
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<"due" | "upcoming" | "dismissed">(
    "due",
  );
  const [limit, setLimit] = useState(20);
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLElement>(null);
  const collectionFocus = useRef<HTMLButtonElement>(null);
  const storageFailed = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  useDialog(dialog, () => setOpen(false), false, open);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const frame = requestAnimationFrame(tick);
    const interval = setInterval(tick, 30_000);
    window.addEventListener("focus", tick);
    const sync = (event: StorageEvent) => {
      if (event.key !== storageKey && event.key !== null) return;
      try {
        setPreferences(
          parseReminderPreferences(JSON.parse(event.newValue || "null")),
        );
      } catch {
        setPreferences(parseReminderPreferences(null));
      }
    };
    window.addEventListener("storage", sync);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(interval);
      window.removeEventListener("focus", tick);
      window.removeEventListener("storage", sync);
    };
  }, [storageKey]);
  const scheduled = useMemo(
    () => scheduledReminders(workspace.tasks, currentPerson),
    [workspace.tasks, currentPerson],
  );
  const items = visibleReminders(scheduled, preferences, now);
  const due = items.filter((item) => item.due);
  const upcoming = items.filter((item) => !item.due);
  const dismissed = new Set(preferences.dismissed);
  const dismissedItems = scheduled.filter((item) => dismissed.has(item.key));
  const shown =
    section === "dismissed"
      ? dismissedItems
      : section === "due"
        ? due
        : upcoming;

  function save(next: ReminderPreferences) {
    const cleaned = parseReminderPreferences(next);
    setPreferences(cleaned);
    setNow(Date.now());
    try {
      localStorage.setItem(storageKey, JSON.stringify(cleaned));
      storageFailed.current = false;
      setNotice("");
    } catch {
      storageFailed.current = true;
      setNotice(
        "Your reminder choices are kept for this session. Browser storage is unavailable or full.",
      );
    }
    requestAnimationFrame(() => collectionFocus.current?.focus());
  }
  function change(key: string, action: "dismiss" | "snooze" | "restore") {
    const latest = storageFailed.current ? preferences : read();
    const next = {
      dismissed: latest.dismissed.filter((value) => value !== key),
      snoozed: { ...latest.snoozed },
    };
    delete next.snoozed[key];
    if (action === "dismiss") next.dismissed.push(key);
    if (action === "snooze") {
      const effectiveAt =
        latest.snoozed[key] ||
        scheduled.find((item) => item.key === key)?.instant ||
        Date.now();
      next.snoozed[key] = Math.min(
        8_640_000_000_000_000,
        Math.max(Date.now(), effectiveAt) + 60 * 60 * 1000,
      );
    }
    save(next);
  }
  return (
    <>
      <button
        className="btn-icon reminder-trigger"
        data-tour="reminder-center"
        aria-label={due.length ? `Reminders, ${due.length} due` : "Reminders"}
        title="Reminders"
        onClick={() => {
          setOpen(true);
          setLimit(20);
          setSection(due.length ? "due" : "upcoming");
        }}
      >
        <Bell size={18} />
        {due.length > 0 && (
          <span className="reminder-count" aria-hidden="true">
            {due.length > 99 ? "99+" : due.length}
          </span>
        )}
      </button>
      <span className="sr-only" role="status">
        {now > 0 && due.length > 0
          ? due.length === 1
            ? "1 task reminder is ready."
            : `${due.length} task reminders are ready.`
          : ""}
      </span>
      {open &&
        createPortal(
          <div
            className="modal-shade"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <section
              ref={dialog}
              className="planning-action-dialog reminder-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={descriptionId}
            >
              <header className="dialog-heading">
                <h2 id={titleId}>
                  <Bell size={21} />
                  Reminders
                </h2>
                <button
                  className="btn-icon"
                  aria-label="Close reminders"
                  onClick={() => setOpen(false)}
                >
                  <X size={18} />
                </button>
              </header>
              <p className="muted" id={descriptionId}>
                For tasks assigned to you and unassigned work in this workspace.
                Reminders appear while ProjectAnvil is open; missed reminders
                are ready when you return.
              </p>
              <div
                className="planning-choice-group"
                role="group"
                aria-label="Reminder collection"
              >
                {(
                  [
                    ["due", `Due (${due.length})`],
                    ["upcoming", `Upcoming (${upcoming.length})`],
                    ["dismissed", `Dismissed (${dismissedItems.length})`],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    ref={section === id ? collectionFocus : undefined}
                    className="btn"
                    aria-pressed={section === id}
                    onClick={() => {
                      setSection(id);
                      setLimit(20);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {notice && (
                <p className="form-error" role="status">
                  {notice}
                </p>
              )}
              <div className="reminder-items">
                {shown.slice(0, limit).map((item) => {
                  const at =
                    "at" in item && typeof item.at === "number"
                      ? item.at
                      : item.instant;
                  return (
                    <article className="reminder-item" key={item.key}>
                      <div>
                        <button
                          className="reminder-task-title"
                          onClick={() => {
                            setOpen(false);
                            openTask(item.task.id);
                          }}
                        >
                          <small>{item.task.key}</small>
                          <strong>{item.task.title}</strong>
                        </button>
                        <p>
                          {new Date(at).toLocaleString(undefined, {
                            timeZone: item.task.reminder!.timeZone,
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}{" "}
                          · {item.task.reminder!.timeZone}
                          {preferences.snoozed[item.key] ? " · Snoozed" : ""}
                        </p>
                      </div>
                      <div className="reminder-item-actions">
                        {section === "dismissed" ? (
                          <button
                            className="btn"
                            onClick={() => change(item.key, "restore")}
                          >
                            <RotateCcw size={15} />
                            Restore reminder
                          </button>
                        ) : (
                          <>
                            {section === "due" && (
                              <button
                                className="btn"
                                onClick={() => change(item.key, "snooze")}
                              >
                                <Clock3 size={15} />
                                Snooze 1 hour
                              </button>
                            )}
                            <button
                              className="btn"
                              onClick={() => change(item.key, "dismiss")}
                            >
                              <Check size={15} />
                              Dismiss
                            </button>
                          </>
                        )}
                      </div>
                    </article>
                  );
                })}
                {!shown.length && (
                  <div className="planning-action-empty">
                    <Bell size={28} />
                    <strong>
                      {section === "due"
                        ? "You're up to date"
                        : section === "upcoming"
                          ? "No upcoming reminders"
                          : "No dismissed reminders"}
                    </strong>
                    <p>
                      Set a reminder in the task Planning details. Dismissals
                      and snoozes stay in this browser for this account and
                      workspace.
                    </p>
                  </div>
                )}
              </div>
              <footer className="planning-action-footer">
                {shown.length > limit && (
                  <button
                    className="btn"
                    onClick={() => setLimit((value) => value + 20)}
                  >
                    Show more
                  </button>
                )}
                <button
                  className="btn btn-primary"
                  onClick={() => setOpen(false)}
                >
                  Done
                </button>
              </footer>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
