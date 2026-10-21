"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspaceScope } from "./WorkspaceScope";
import {
  readDraft,
  registerDraftGuard,
  removeDraft,
  writeDraft,
  type DraftGuard,
  type DraftScope,
} from "../lib/draft-store";

export function useDraftScope(): DraftScope {
  const { account, activeId } = useWorkspaceScope();
  const accountId = account.user?.id || "guest";
  return useMemo(
    () => ({ accountId, workspaceId: activeId }),
    [accountId, activeId],
  );
}

export function useDraftGuard(
  scope: DraftScope,
  id: string,
  guard: DraftGuard,
): void {
  useEffect(() => registerDraftGuard(scope, id, guard), [scope, id, guard]);
}

/** Optional editor adapter; storage functions can also be used directly with existing editor state. */
export function useRecoverableDraft<T, B = T>(entity: string, id: string) {
  const scope = useDraftScope();
  const [recovered] = useState(() => readDraft<T, B>(scope, entity, id));
  const [error, setError] = useState<string | null>(null);
  const write = useCallback(
    (value: T, baseline: B | null) => {
      const result = writeDraft(scope, entity, id, value, baseline);
      setError(result.error);
      return result;
    },
    [scope, entity, id],
  );
  const clear = useCallback(
    (token?: string) => removeDraft(scope, entity, id, token),
    [scope, entity, id],
  );
  return { scope, recovered, write, clear, error };
}
