function cancelled(): DOMException {
  return new DOMException("The download was cancelled.", "AbortError");
}

/** Read a download without trusting a server's size header or holding oversized
 * bodies in memory. The caller's signal remains active after fetch headers. */
export async function readDownloadBlob(
  response: Response,
  limit: number,
  signal?: AbortSignal,
): Promise<Blob> {
  if (!Number.isSafeInteger(limit) || limit < 0)
    throw new RangeError("Choose a nonnegative download byte limit.");
  const body = response.body;
  const discardBody = () => {
    if (body && !body.locked) void body.cancel().catch(() => undefined);
  };
  if (signal?.aborted) {
    discardBody();
    throw cancelled();
  }
  const header = response.headers.get("Content-Length");
  let declared: number | undefined;
  if (header !== null) {
    if (!/^\d+$/.test(header.trim()) || !Number.isSafeInteger(Number(header))) {
      discardBody();
      throw new Error("The download has an invalid size header.");
    }
    declared = Number(header);
    if (declared > limit) {
      discardBody();
      throw new Error("The download exceeds the allowed size.");
    }
  }
  // Fetch decodes compressed responses. Their Content-Length describes wire
  // bytes, so only unencoded bodies can be compared directly with that header.
  const encoding = response.headers
    .get("Content-Encoding")
    ?.trim()
    .toLowerCase();
  const exactLength =
    !encoding || encoding === "identity" ? declared : undefined;
  if (!body) {
    if (exactLength !== undefined && exactLength !== 0)
      throw new Error("The download ended before its declared size.");
    return new Blob([], { type: response.headers.get("Content-Type") || "" });
  }
  const reader = body.getReader();
  const stop = () => {
    void reader.cancel(cancelled()).catch(() => undefined);
  };
  signal?.addEventListener("abort", stop, { once: true });
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  try {
    if (signal?.aborted) {
      stop();
      throw cancelled();
    }
    while (true) {
      const result = await reader.read();
      if (signal?.aborted) throw cancelled();
      if (result.done) break;
      if (!(result.value instanceof Uint8Array))
        throw new Error("The download returned an invalid binary stream.");
      const next = total + result.value.byteLength;
      if (next > limit)
        throw new Error("The download exceeds the allowed size.");
      if (exactLength !== undefined && next > exactLength)
        throw new Error("The download exceeds its declared size.");
      // Copy only the view's bytes; a small view must not retain a much larger
      // backing buffer supplied by a streaming source.
      chunks.push(new Uint8Array(result.value));
      total = next;
    }
    if (exactLength !== undefined && total !== exactLength)
      throw new Error("The download ended before its declared size.");
    if (signal?.aborted) throw cancelled();
    return new Blob(chunks, {
      type: response.headers.get("Content-Type") || "",
    });
  } catch (error) {
    void reader.cancel(error).catch(() => undefined);
    if (signal?.aborted) throw cancelled();
    throw error;
  } finally {
    signal?.removeEventListener("abort", stop);
    reader.releaseLock();
  }
}
