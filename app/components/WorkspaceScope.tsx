"use client";
import { createContext, useContext, useCallback } from "react";
import type { AccountContext } from "../lib/access-types";
import { fetchWithTimeout } from "../lib/fetch-with-timeout";
export interface WorkspaceScopeValue {
  account: AccountContext;
  activeId: string;
  onSwitch: (id: string) => Promise<void>;
  onAuthChanged: () => Promise<void>;
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
  const { activeId, account } = useWorkspaceScope();
  return useCallback(
    (input: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("X-Workspace-Id", activeId);
      headers.set("X-Account-Id", account.user?.id || "guest");
      return fetchWithTimeout(
        input,
        { ...init, headers, credentials: "same-origin" },
        input.startsWith("/api/media") ? 60_000 : 25_000,
      );
    },
    [activeId, account.user?.id],
  );
}
