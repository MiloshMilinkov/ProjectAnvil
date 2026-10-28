"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountContext, WorkspaceAccess } from "../lib/access-types";
import {
  AccountRefreshRequests,
  accountResponseStatus,
} from "../lib/account-refresh";
import ProjectAnvil from "./ProjectAnvil";
import { WorkspaceScope } from "./WorkspaceScope";
import { fetchWithTimeout } from "../lib/fetch-with-timeout";
import {
  AccountAccess,
  clearAccountCallback,
  readAccountCallback,
} from "./AccountAccess";
import { flushDraftGuards, hasUnpersistedDrafts } from "../lib/draft-store";
import {
  clearOfflineResume,
  forgetOfflineAccount,
  readOfflineResume,
  readOfflineWorkspace,
  reconcileOfflineAccount,
} from "../lib/offline-store";

function accessEpoch(access: WorkspaceAccess) {
  return JSON.stringify([
    access.kind,
    access.role,
    access.ownerId || "",
    access.securityRevision || 0,
    Object.entries(access.projectRoles || {}).sort(([a], [b]) =>
      a.localeCompare(b),
    ),
  ]);
}

export default function AccountShell() {
  const [sessionGeneration, setSessionGeneration] = useState(0);
  const [callback, setCallback] =
    useState<ReturnType<typeof readAccountCallback>>(null);
  const [account, setAccount] = useState<AccountContext | null>(null),
    [activeId, setActiveId] = useState(""),
    [error, setError] = useState(""),
    [navigationError, setNavigationError] = useState(""),
    [isOffline, setOffline] = useState(false);
  const latest = useRef<AccountContext | null>(null),
    offline = useRef(false),
    allowResume = useRef(true),
    requests = useRef(new AccountRefreshRequests()),
    transitionVersion = useRef(0);
  const sessionChannel = useRef<BroadcastChannel | null>(null);
  const onConnectionChange = useCallback((next: boolean) => {
    offline.current = next;
    setOffline(next);
  }, []);
  const apply = useCallback((next: AccountContext, preferredId?: string) => {
    const sameUser = latest.current?.user?.id === next.user?.id;
    latest.current = next;
    requests.current.invalidate();
    setAccount(next);
    setActiveId((current) => {
      let saved = "";
      try {
        saved =
          localStorage.getItem(
            "projectanvil-workspace-" + (next.user?.id || "guest"),
          ) || "";
      } catch {}
      const proposed = preferredId || (sameUser ? current : saved);
      return next.workspaces.some((workspace) => workspace.id === proposed)
        ? proposed
        : next.workspaces[0]?.id || "";
    });
    setError("");
  }, []);
  const refresh = useCallback(
    (force = false): Promise<void> =>
      requests.current.run(async (ticket) => {
        let unavailable = false,
          denied = false;
        try {
          let response: Response;
          try {
            response = await fetchWithTimeout("/api/account", {
              cache: "no-store",
              credentials: "same-origin",
              signal: ticket.signal,
            });
          } catch (cause) {
            unavailable = true;
            throw cause;
          }
          const status = accountResponseStatus(response.status);
          unavailable = status === "unavailable";
          denied = status === "denied";
          const result = (await response
            .json()
            .catch(() => ({}))) as AccountContext & {
            account?: AccountContext;
            error?: string;
          };
          if (!response.ok)
            throw new Error(
              result.error ||
                (unavailable
                  ? "The local server is temporarily unavailable. Your offline copy and queued changes are kept."
                  : "Unable to open your account."),
            );
          const next = result.account || result;
          if (
            !Array.isArray(next.workspaces) ||
            !(
              next.user === null ||
              (next.user && typeof next.user.id === "string")
            )
          )
            throw new Error(
              "The account response could not be read. Retry the connection.",
            );
          if (!ticket.isCurrent()) return;
          const previousId = latest.current?.user?.id || "guest";
          if (latest.current && previousId !== (next.user?.id || "guest"))
            await forgetOfflineAccount(previousId).catch(() => undefined);
          await reconcileOfflineAccount(next).catch(() => undefined);
          if (!ticket.isCurrent()) return;
          allowResume.current = true;
          onConnectionChange(false);
          apply(next);
        } catch (cause) {
          if (!ticket.isCurrent()) return;
          if (unavailable && allowResume.current) {
            if (latest.current) onConnectionChange(true);
            else {
              const saved = await readOfflineResume().catch(() => null);
              if (saved && ticket.isCurrent()) {
                apply(saved.account, saved.activeId);
                onConnectionChange(true);
                return;
              }
            }
          } else if (denied) {
            allowResume.current = false;
            const previousId = latest.current?.user?.id;
            // Read the last selection before blocking resume. A first-boot denial
            // can then purge its identity's data without restoring that identity's UI.
            const saved = previousId
              ? Promise.resolve(null)
              : readOfflineResume().catch(() => null);
            const cleared = clearOfflineResume().catch(() => undefined);
            latest.current = null;
            setAccount(null);
            setActiveId("");
            onConnectionChange(false);
            const cached = await saved;
            await forgetOfflineAccount(
              previousId || cached?.account.user?.id || "guest",
            ).catch(() => undefined);
            await cleared;
          }
          if (ticket.isCurrent())
            setError(
              cause instanceof Error
                ? cause.message
                : "The account connection could not finish.",
            );
          throw cause;
        }
      }, force),
    [apply, onConnectionChange],
  );
  const authChanged = useCallback(async () => {
    // Authentication succeeded online. Cached identity never substitutes for
    // the fresh lookup after removing the prior UI and device copies.
    transitionVersion.current++;
    requests.current.invalidate();
    allowResume.current = false;
    const previousId = latest.current?.user?.id || "guest";
    latest.current = null;
    setAccount(null);
    setActiveId("");
    setError("");
    setNavigationError("");
    onConnectionChange(false);
    await forgetOfflineAccount(previousId).catch(() => undefined);
    await clearOfflineResume().catch(() => undefined);
    await refresh(true);
  }, [refresh, onConnectionChange]);
  const refreshSession = useCallback(async () => {
    // Password changes rotate this cookie. Retire reads/live polls carrying the
    // previous session without replacing the unchanged account or its workspace.
    requests.current.invalidate();
    setSessionGeneration((generation) => generation + 1);
    await refresh(true);
  }, [refresh]);
  const sessionChanged = useCallback(async () => {
    // Cookies are shared by tabs in this browser; only public identity metadata
    // is broadcast, never a password, session token, or recovery link.
    sessionChannel.current?.postMessage({
      accountId: latest.current?.user?.id,
    });
    await refreshSession();
  }, [refreshSession]);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel("projectanvil-session-change");
    } catch {
      return;
    } // Browser privacy settings can disable cross-tab messaging.
    sessionChannel.current = channel;
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const value = event.data as { accountId?: unknown } | null;
      if (value?.accountId && value.accountId === latest.current?.user?.id)
        void refreshSession().catch(() => {});
    };
    return () => {
      sessionChannel.current = null;
      channel.close();
    };
  }, [refreshSession]);
  useEffect(() => {
    const next = readAccountCallback();
    if (next) {
      clearAccountCallback();
      queueMicrotask(() => setCallback(next));
    }
  }, []);
  useEffect(() => {
    const activeRequests = requests.current;
    queueMicrotask(() => {
      void refresh().catch(() => {});
    });
    const timer = setInterval(() => {
      if (!document.hidden) void refresh().catch(() => {});
    }, 10_000);
    const wake = () => {
      void refresh().catch(() => {});
    };
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      activeRequests.invalidate();
    };
  }, [refresh]);
  const updateAccount = useCallback(
    (next: AccountContext) => {
      if (latest.current?.user?.id === next.user?.id) {
        void reconcileOfflineAccount(next).catch(() => undefined);
        apply(next);
      }
    },
    [apply],
  );
  const switchWorkspace = useCallback(
    async (id: string) => {
      const current = latest.current;
      if (!current?.workspaces.some((workspace) => workspace.id === id)) return;
      setNavigationError("");
      const transition = ++transitionVersion.current;
      const scope = {
        accountId: current.user?.id || "guest",
        workspaceId: activeId,
      };
      await flushDraftGuards(scope);
      if (transition !== transitionVersion.current) return;
      if (hasUnpersistedDrafts(scope)) {
        setNavigationError(
          "Keep this workspace open until your recording or recovery copy can be saved.",
        );
        return;
      }
      if (latest.current?.user?.id !== current.user?.id) return;
      const target = latest.current?.workspaces.find(
        (workspace) => workspace.id === id,
      );
      if (!target) return;
      if (offline.current) {
        try {
          const cached = await readOfflineWorkspace({
            accountId: scope.accountId,
            workspaceId: id,
          });
          if (!cached?.workspace)
            throw new Error(
              "That workspace is not available offline. Connect and save a copy in Workspace settings first.",
            );
          if (accessEpoch(cached.access) !== accessEpoch(target))
            throw new Error(
              "This workspace's access changed. Reconnect and refresh its offline copy before opening it.",
            );
        } catch (cause) {
          if (transition === transitionVersion.current)
            setNavigationError(
              cause instanceof Error
                ? cause.message
                : "This offline workspace could not be opened.",
            );
          return;
        }
      }
      if (
        transition !== transitionVersion.current ||
        latest.current?.user?.id !== current.user?.id ||
        !latest.current?.workspaces.some((workspace) => workspace.id === id)
      )
        return;
      setActiveId(id);
      try {
        localStorage.setItem("projectanvil-workspace-" + scope.accountId, id);
      } catch {}
    },
    [activeId],
  );
  if (account && callback)
    return (
      <AccountAccess
        {...callback}
        account={account}
        policy={account.policy}
        onAuthenticated={async () => {
          setCallback(null);
          await authChanged();
        }}
        onPasswordReset={async () => {
          setCallback({
            initialMode: "login",
            recoveryMessage:
              "Password changed. Sign in with your new password.",
          });
          await authChanged();
        }}
        onClose={() => setCallback(null)}
      />
    );
  if (account?.policy?.mode === "online" && !account.user)
    return (
      <AccountAccess
        policy={account.policy}
        account={account}
        onAuthenticated={authChanged}
      />
    );
  if (!account || !activeId)
    return (
      <main className="loading-page">
        <h1>ProjectAnvil</h1>
        <p>{error || "Opening your workspace…"}</p>
        {error && (
          <button
            className="btn"
            onClick={() => void refresh(true).catch(() => {})}
          >
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
        onSessionChanged: sessionChanged,
        sessionGeneration,
        onChanged: updateAccount,
        refreshAccount: refresh,
        isOffline,
        onConnectionChange,
      }}
    >
      {(navigationError || (error && !isOffline)) && (
        <div className="error-banner account-connection-banner" role="status">
          {navigationError || error}
          {navigationError ? (
            <button onClick={() => setNavigationError("")}>Dismiss</button>
          ) : (
            <button onClick={() => void refresh(true).catch(() => {})}>
              Retry account connection
            </button>
          )}
        </div>
      )}
      <ProjectAnvil key={(account.user?.id || "guest") + ":" + activeId} />
    </WorkspaceScope.Provider>
  );
}
