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
