"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BellPlus, BellRing } from "lucide-react";
import type { EntityRef, Notify } from "../lib/types";
import type { WatchState } from "../lib/collaboration-types";
import { useWorkspaceFetch, useWorkspaceScope } from "./WorkspaceScope";
import "./team-collaboration.css";

export function MentionHelp() {
  return (
    <p className="mention-help" data-tour="mentions">
      Type <strong>@username</strong> to notify a teammate who can access this
      item. Use their account username, not an assignment label.
    </p>
  );
}
export default function WatchControl({
  reference,
  notify,
}: {
  reference: EntityRef;
  notify: Notify;
}) {
  const scopedFetch = useWorkspaceFetch();
  const { account, activeId } = useWorkspaceScope();
  const securityRevision =
    account.workspaces.find((item) => item.id === activeId)?.securityRevision ||
    0;
  const signedIn = !!account.user;
  const [watching, setWatching] = useState(false);
  const [loading, setLoading] = useState(signedIn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const generation = useRef(0);
  const load = useCallback(async () => {
    if (!signedIn) return;
    const token = generation.current;
    try {
      const query = new URLSearchParams({
        type: reference.type,
        id: reference.id,
      });
      const response = await scopedFetch(`/api/watch?${query}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as WatchState & { error?: string };
      if (!response.ok)
        throw new Error(
          data.error || "This item's notification setting could not be loaded.",
        );
      if (alive.current && token === generation.current) {
        setWatching(data.watching);
        setError("");
      }
    } catch (cause) {
      if (alive.current && token === generation.current) {
        setWatching(false);
        setError(
          cause instanceof Error
            ? cause.message
            : "This item's notification setting could not be loaded.",
        );
      }
    } finally {
      if (alive.current && token === generation.current) setLoading(false);
    }
  }, [scopedFetch, signedIn, reference.type, reference.id]);
  useEffect(() => {
    alive.current = true;
    const token = ++generation.current;
    queueMicrotask(() => {
      if (generation.current !== token) return;
      setWatching(false);
      setLoading(signedIn);
      setBusy(false);
      setError("");
      void load();
    });
    const wake = () => void load();
    window.addEventListener("focus", wake);
    return () => {
      alive.current = false;
      generation.current = token + 1;
      window.removeEventListener("focus", wake);
    };
  }, [load, signedIn, securityRevision]);
  async function change() {
    if (busy || loading || !account.user) return;
    setBusy(true);
    setError("");
    const token = generation.current;
    try {
      const response = await scopedFetch("/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...reference, watching: !watching }),
      });
      const data = (await response.json()) as WatchState & { error?: string };
      if (!response.ok)
        throw new Error(
          data.error || "This item's notification setting could not be saved.",
        );
      if (alive.current && token === generation.current) {
        setWatching(data.watching);
        notify(
          data.watching ? "Watching this item" : "Stopped watching this item",
        );
      }
    } catch (cause) {
      if (alive.current && token === generation.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "This item's notification setting could not be saved.",
        );
    } finally {
      if (alive.current && token === generation.current) setBusy(false);
    }
  }
  return (
    <span className="watch-control" data-tour="watchers">
      <button
        type="button"
        className="btn watch-button"
        aria-pressed={watching}
        disabled={!account.user || loading || busy}
        title={
          !account.user
            ? "Sign in to watch updates"
            : watching
              ? "Stop watching this item"
              : "Receive notifications when someone changes this item"
        }
        onClick={() => void change()}
      >
        {watching ? (
          <BellRing size={16} aria-hidden="true" />
        ) : (
          <BellPlus size={16} aria-hidden="true" />
        )}
        <span>
          {busy
            ? "Saving…"
            : loading
              ? "Loading…"
              : watching
                ? "Watching"
                : "Watch"}
        </span>
      </button>
      {error && (
        <span className="watch-error" role="alert">
          {error}{" "}
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </span>
      )}
    </span>
  );
}
