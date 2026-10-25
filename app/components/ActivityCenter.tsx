"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clock3, RefreshCw } from "lucide-react";
import type { FeatureProps } from "../lib/types";
import type { ActivityEntry, ActivityPage } from "../lib/collaboration-types";
import { activityVerb } from "../lib/collaboration-model";
import { useWorkspaceFetch, useWorkspaceScope } from "./WorkspaceScope";
import "./team-collaboration.css";

export function activityTime(timestamp: string): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
export function ActivityDescription({ entry }: { entry: ActivityEntry }) {
  return (
    <>
      <strong>{entry.actor}</strong> {activityVerb(entry.action)}{" "}
      <strong>{entry.title}</strong>
    </>
  );
}

export default function ActivityCenter({
  workspace,
  projectFilter,
  openNote,
  openTask,
  onOpenProject,
}: FeatureProps & { onOpenProject?: (id: string) => void }) {
  const scopedFetch = useWorkspaceFetch();
  const { account, activeId } = useWorkspaceScope();
  const securityRevision =
    account.workspaces.find((item) => item.id === activeId)?.securityRevision ||
    0;
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const alive = useRef(true);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const load = useCallback(
    async (next?: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      const token = generation.current;
      if (next) setMore(true);
      else setLoading(true);
      try {
        const query = new URLSearchParams({
          limit: "30",
          ...(projectFilter ? { project: projectFilter } : {}),
          ...(next ? { cursor: next } : {}),
        });
        const response = await scopedFetch(`/api/activity?${query}`, {
          cache: "no-store",
        });
        const data = (await response.json()) as ActivityPage & {
          error?: string;
        };
        if (!response.ok) {
          if (
            [401, 403, 404].includes(response.status) &&
            alive.current &&
            token === generation.current
          )
            setEntries([]);
          throw new Error(data.error || "Activity could not be loaded.");
        }
        if (!alive.current || token !== generation.current) return;
        setEntries((previous) =>
          next
            ? [
                ...previous,
                ...data.entries.filter(
                  (entry) => !previous.some((old) => old.id === entry.id),
                ),
              ]
            : data.entries,
        );
        setCursor(data.nextCursor);
        setError("");
      } catch (cause) {
        if (alive.current && token === generation.current)
          setError(
            cause instanceof Error
              ? cause.message
              : "Activity could not be loaded.",
          );
      } finally {
        if (token === generation.current) inFlight.current = false;
        if (alive.current && token === generation.current) {
          setLoading(false);
          setMore(false);
        }
      }
    },
    [scopedFetch, projectFilter],
  );
  useEffect(() => {
    alive.current = true;
    const token = ++generation.current;
    inFlight.current = false;
    queueMicrotask(() => {
      if (generation.current !== token) return;
      setEntries([]);
      setCursor(null);
      void load();
    });
    const wake = () => {
      if (!document.hidden) void load();
    };
    const timer = setInterval(wake, 15_000);
    window.addEventListener("focus", wake);
    return () => {
      alive.current = false;
      generation.current = token + 1;
      clearInterval(timer);
      window.removeEventListener("focus", wake);
    };
  }, [load, securityRevision]);
  useEffect(() => {
    queueMicrotask(() => {
      if (!document.hidden) void load();
    });
  }, [workspace.revision, load]);
  function open(entry: ActivityEntry) {
    const reference = entry.reference;
    if (!reference) return;
    if (reference.type === "note") openNote(reference.id);
    else if (reference.type === "task") openTask(reference.id);
    else onOpenProject?.(reference.id);
  }
  return (
    <section className="page activity-page" data-tour="activity-history">
      <header className="collaboration-heading">
        <div>
          <h1>Activity history</h1>
          <p>
            Follow confirmed changes and the people moving the work forward.
          </p>
        </div>
        <button
          className="btn"
          disabled={loading || more}
          onClick={() => void load()}
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </header>
      <p className="collaboration-scope">
        {projectFilter
          ? workspace.projects.find((project) => project.id === projectFilter)
              ?.name || "Selected project"
          : "All accessible projects"}{" "}
        · Recent workspace activity
      </p>
      {error && (
        <p className="collaboration-notice collaboration-error" role="alert">
          {error}
        </p>
      )}
      {loading && !entries.length ? (
        <p className="collaboration-empty" role="status">
          Loading activity…
        </p>
      ) : !entries.length ? (
        <div className="collaboration-empty">
          <Clock3 size={28} />
          <h2>No activity to show yet</h2>
          <p>
            New saved changes appear here. The history respects your current
            workspace and project access.
          </p>
        </div>
      ) : (
        <ol className="activity-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <span className="activity-marker" aria-hidden="true">
                <Clock3 size={17} />
              </span>
              <div className="activity-entry">
                <p>
                  <ActivityDescription entry={entry} />
                </p>
                {entry.fields.length > 0 && (
                  <p className="activity-fields">{entry.fields.join(" · ")}</p>
                )}
                <div className="activity-meta">
                  <time dateTime={entry.createdAt}>
                    {activityTime(entry.createdAt)}
                  </time>
                  {entry.reference &&
                    (entry.reference.type !== "project" || onOpenProject) && (
                      <button className="btn" onClick={() => open(entry)}>
                        Open {entry.reference.type}
                      </button>
                    )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {cursor && (
        <button
          className="btn activity-more"
          disabled={loading || more}
          onClick={() => void load(cursor)}
        >
          {more ? "Loading…" : "Load older activity"}
        </button>
      )}
      <p className="collaboration-footnote">
        The latest 10,000 workspace events are retained. Entries show changed
        fields; note text history remains in the note editor.
      </p>
    </section>
  );
}
