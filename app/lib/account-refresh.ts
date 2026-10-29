import type { AccountContext } from "./access-types";

/** Only changes to effective access should replace the current workspace view. */
export function workspacePermissionKey(
  account: AccountContext,
  activeId: string,
) {
  const access = account.workspaces.find(
    (workspace) => workspace.id === activeId,
  );
  // Owners and admins always have every project; their map also grows when a
  // project is created, without changing what they are allowed to see or edit.
  const projectRoles =
    access?.role === "owner" || access?.role === "admin"
      ? []
      : Object.entries(access?.projectRoles || {}).sort(([left], [right]) =>
          left.localeCompare(right),
        );
  return JSON.stringify([
    account.user?.id || "guest",
    activeId,
    access?.role,
    access?.securityRevision || 0,
    projectRoles,
  ]);
}

/** Unchanged polls keep request callbacks stable; all public account fields count. */
export function retainUnchangedAccount(
  current: AccountContext | null,
  next: AccountContext,
): AccountContext {
  return current && JSON.stringify(current) === JSON.stringify(next)
    ? current
    : next;
}

export interface AccountRequestTicket {
  signal: AbortSignal;
  isCurrent: () => boolean;
}

/** Polls share one bounded request; authentication changes replace it explicitly. */
export class AccountRefreshRequests {
  private generation = 0;
  private active?: { controller: AbortController; promise: Promise<void> };

  invalidate() {
    this.generation++;
    this.active?.controller.abort();
    this.active = undefined;
  }

  run(
    work: (ticket: AccountRequestTicket) => Promise<void>,
    force = false,
  ): Promise<void> {
    if (force) this.invalidate();
    if (this.active) return this.active.promise;
    const generation = ++this.generation;
    const controller = new AbortController();
    const ticket = {
      signal: controller.signal,
      isCurrent: () => generation === this.generation,
    };
    const slot = {
      controller,
      promise: Promise.resolve().then(() => work(ticket)),
    };
    slot.promise = slot.promise.finally(() => {
      if (this.active === slot) this.active = undefined;
    });
    this.active = slot;
    return slot.promise;
  }
}

export function accountResponseStatus(status: number) {
  if (status >= 200 && status < 300) return "ready";
  if ([401, 403, 404, 409].includes(status)) return "denied";
  if (status >= 500 || [408, 429].includes(status)) return "unavailable";
  return "failed";
}
