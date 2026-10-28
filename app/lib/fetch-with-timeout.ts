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
        "ProjectAnvil took too long to respond. Try again. Keep this page open if you have unsaved changes.",
      );
    if (error instanceof TypeError)
      throw new Error(
        "Cannot reach ProjectAnvil. Check your connection and try again. Keep this page open if you have unsaved changes.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", cancel);
  }
}
