/** Keeps update observation identical for online startup and offline resumption. */
export function createAppUpdateObserver(
  onState: (worker: ServiceWorker) => void,
) {
  let registration: ServiceWorkerRegistration | null = null;
  let candidate: ServiceWorker | null = null;
  let removeRegistrationListener: (() => void) | undefined;
  const workers = new Map<ServiceWorker, () => void>();

  function watch(worker: ServiceWorker | null) {
    if (!worker || workers.has(worker)) return;
    const changed = () => {
      if (workers.has(worker) && candidate === worker) onState(worker);
      if (worker.state === "redundant" || worker.state === "activated") {
        worker.removeEventListener("statechange", changed);
        workers.delete(worker);
      }
    };
    workers.set(worker, changed);
    worker.addEventListener("statechange", changed);
    changed();
  }
  function disconnect() {
    removeRegistrationListener?.();
    removeRegistrationListener = undefined;
    for (const [worker, listener] of workers)
      worker.removeEventListener("statechange", listener);
    workers.clear();
    registration = null;
    candidate = null;
  }
  function observe(incoming: ServiceWorkerRegistration) {
    if (registration !== incoming) {
      disconnect();
      registration = incoming;
      const found = () => {
        candidate = incoming.installing || incoming.waiting;
        watch(candidate);
      };
      incoming.addEventListener("updatefound", found);
      removeRegistrationListener = () =>
        incoming.removeEventListener("updatefound", found);
    }
    candidate = incoming.installing || incoming.waiting;
    watch(candidate);
  }
  return { observe, disconnect };
}
