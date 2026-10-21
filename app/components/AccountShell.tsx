"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountContext } from "../lib/access-types";
import ProjectAnvil from "./ProjectAnvil";
import { WorkspaceScope } from "./WorkspaceScope";
import { fetchWithTimeout } from "../lib/fetch-with-timeout";
import { flushDraftGuards, hasUnpersistedDrafts } from "../lib/draft-store";

export default function AccountShell() {
  const [account, setAccount] = useState<AccountContext | null>(null),
    [activeId, setActiveId] = useState(""),
    [error, setError] = useState("");
  const latest = useRef<AccountContext | null>(null),
    requestVersion = useRef(0),
    transitionVersion = useRef(0);
  const apply = useCallback((next: AccountContext) => {
    const sameUser = latest.current?.user?.id === next.user?.id;
    latest.current = next;
    requestVersion.current++;
    setAccount(next);
    setActiveId((current) => {
      let saved = "";
      try {
        saved =
          localStorage.getItem(
            "projectanvil-workspace-" + (next.user?.id || "guest"),
          ) || "";
      } catch {}
      const proposed = sameUser ? current : saved;
      return next.workspaces.some((w) => w.id === proposed)
        ? proposed
        : next.workspaces[0]?.id || "";
    });
    setError("");
  }, []);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const response = await fetchWithTimeout("/api/account", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const result = (await response.json()) as AccountContext & {
        account?: AccountContext;
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error || "Unable to open your account");
      if (version === requestVersion.current) apply(result.account || result);
    } catch (error) {
      if (version === requestVersion.current)
        setError((error as Error).message);
      throw error;
    }
  }, [apply]);
  const invalidateRequests = useCallback(() => {
    requestVersion.current += 1;
  }, []);
  const authChanged = useCallback(async () => {
    // The authentication request has succeeded. Do not show the previous user's
    // private workspace while a fresh account lookup is unavailable.
    transitionVersion.current += 1;
    setAccount(null);
    setActiveId("");
    setError("");
    await refresh();
  }, [refresh]);
  useEffect(() => {
    refresh().catch(() => {});
    const timer = setInterval(() => {
      if (!document.hidden) refresh().catch(() => {});
    }, 10000);
    const wake = () => refresh().catch(() => {});
    window.addEventListener("focus", wake);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", wake);
      invalidateRequests();
    };
  }, [refresh, invalidateRequests]);
  const updateAccount = useCallback(
    (next: AccountContext) => {
      if (latest.current?.user?.id === next.user?.id) apply(next);
    },
    [apply],
  );
  const switchWorkspace = useCallback(
    async (id: string) => {
      const current = latest.current;
      if (!current?.workspaces.some((w) => w.id === id)) return;
      const transition = ++transitionVersion.current;
      const scope = {
        accountId: current.user?.id || "guest",
        workspaceId: activeId,
      };
      await flushDraftGuards(scope);
      if (transition !== transitionVersion.current) return;
      if (hasUnpersistedDrafts(scope)) {
        setError(
          "Keep this workspace open until your recording or recovery copy can be saved.",
        );
        return;
      }
      if (
        latest.current?.user?.id !== current.user?.id ||
        !latest.current?.workspaces.some((workspace) => workspace.id === id)
      )
        return;
      setActiveId(id);
      try {
        localStorage.setItem(
          "projectanvil-workspace-" + (current.user?.id || "guest"),
          id,
        );
      } catch {}
    },
    [activeId],
  );
  if (!account || !activeId)
    return (
      <main className="loading-page">
        <h1>ProjectAnvil</h1>
        <p>{error || "Opening your workspace…"}</p>
        {error && (
          <button className="btn" onClick={() => refresh().catch(() => {})}>
            Try again
          </button>
        )}
      </main>
    );
  return (
    <WorkspaceScope.Provider
      value={{
        account,
        activeId,
        onSwitch: switchWorkspace,
        onAuthChanged: authChanged,
        onChanged: updateAccount,
        refreshAccount: refresh,
      }}
    >
      {error && (
        <div className="error-banner account-connection-banner" role="status">
          {error}
          <button onClick={() => void refresh().catch(() => {})}>
            Retry account connection
          </button>
        </div>
      )}
      <ProjectAnvil key={(account.user?.id || "guest") + ":" + activeId} />
    </WorkspaceScope.Provider>
  );
}
