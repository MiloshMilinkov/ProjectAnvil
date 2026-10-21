/** Apply a bounded wait without losing an upstream cancellation signal. */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeout = 25_000,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) cancel();
  else init.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut)
      throw new Error(
        "The local server did not respond in time. Your unsaved edits are kept for recovery. Retry when the server is ready.",
      );
    if (error instanceof TypeError)
      throw new Error(
        "Cannot reach ProjectAnvil. Keep the local server running, then retry. Unsaved changes remain available for recovery.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", cancel);
  }
}
