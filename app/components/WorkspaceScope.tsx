"use client";
import { createContext, useContext, useCallback, useMemo } from "react";
import type { AccountContext } from "../lib/access-types";
import { fetchWithTimeout } from "../lib/fetch-with-timeout";
export interface WorkspaceScopeValue {
  account: AccountContext;
  activeId: string;
  onSwitch: (id: string) => Promise<void>;
  onAuthChanged: () => Promise<void>;
  onSessionChanged: () => Promise<void>;
  sessionGeneration: number;
  onChanged: (account: AccountContext) => void;
  refreshAccount: () => Promise<void>;
  isOffline: boolean;
  onConnectionChange: (offline: boolean) => void;
}
export const WorkspaceScope = createContext<WorkspaceScopeValue | null>(null);
export function useWorkspaceScope() {
  const scope = useContext(WorkspaceScope);
  if (!scope) throw new Error("Workspace context is unavailable");
  return scope;
}
export function useWorkspaceFetch() {
  const { activeId, account, sessionGeneration } = useWorkspaceScope();
  // A rotated cookie gets a fresh request scope, retiring old read/live effects
  // while the unchanged account and workspace keep their editor state.
  const requestScope = useMemo(
    () => ({
      workspaceId: activeId,
      accountId: account.user?.id || "guest",
      sessionGeneration,
    }),
    [activeId, account.user?.id, sessionGeneration],
  );
  return useCallback(
    (input: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("X-Workspace-Id", requestScope.workspaceId);
      headers.set("X-Account-Id", requestScope.accountId);
      return fetchWithTimeout(
        input,
        { ...init, headers, credentials: "same-origin" },
        input.startsWith("/api/media") ? 60_000 : 25_000,
      );
    },
    [requestScope],
  );
}
