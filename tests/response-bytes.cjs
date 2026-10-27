const assert = require("node:assert/strict");
const { readDownloadBlob } = require("./compiled/app/lib/response-bytes");
const encoder = new TextEncoder();

async function main() {
  const exact = await readDownloadBlob(
    new Response("hello", {
      headers: {
        "Content-Length": "5",
        "Content-Type": "text/plain;charset=utf-8",
      },
    }),
    5,
  );
  assert.equal(await exact.text(), "hello");
  assert.equal(exact.type, "text/plain;charset=utf-8");
  assert.equal(
    (
      await readDownloadBlob(
        new Response(null, { headers: { "Content-Length": "0" } }),
        0,
      )
    ).size,
    0,
  );
  assert.equal(
    await (await readDownloadBlob(new Response("hello"), 5)).text(),
    "hello",
  );

  let oversizedHeaderCancelled = false;
  const oversizedHeader = new Response(
    new ReadableStream({
      cancel() {
        oversizedHeaderCancelled = true;
      },
    }),
    { headers: { "Content-Length": "1000" } },
  );
  await assert.rejects(
    readDownloadBlob(oversizedHeader, 10),
    /exceeds the allowed size/,
  );
  assert(
    oversizedHeaderCancelled,
    "Rejecting an oversized header cancels its unread body",
  );

  let oversizedStreamCancelled = false;
  const oversizedStream = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(11));
      },
      cancel() {
        oversizedStreamCancelled = true;
      },
    }),
  );
  await assert.rejects(
    readDownloadBlob(oversizedStream, 10),
    /exceeds the allowed size/,
  );
  assert(
    oversizedStreamCancelled,
    "A body without a size header is still bounded and cancelled",
  );
  await assert.rejects(
    readDownloadBlob(
      new Response("longer", { headers: { "Content-Length": "2" } }),
      20,
    ),
    /exceeds its declared size/,
  );
  await assert.rejects(
    readDownloadBlob(
      new Response("short", { headers: { "Content-Length": "9" } }),
      20,
    ),
    /ended before its declared size/,
  );
  await assert.rejects(
    readDownloadBlob(
      new Response(null, { headers: { "Content-Length": "9" } }),
      20,
    ),
    /ended before its declared size/,
  );
  for (const value of ["-1", "NaN", "2,2", "1.5", "9007199254740992"])
    await assert.rejects(
      readDownloadBlob(
        new Response("a", { headers: { "Content-Length": value } }),
        20,
      ),
      /invalid size header/,
    );

  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  let preflightCancelled = false;
  await assert.rejects(
    readDownloadBlob(
      new Response(
        new ReadableStream({
          cancel() {
            preflightCancelled = true;
          },
        }),
      ),
      5,
      alreadyAborted.signal,
    ),
    { name: "AbortError" },
  );
  assert(
    preflightCancelled,
    "Already-aborted downloads release an acquired response body",
  );

  let activeCancelled = false;
  let firstChunk;
  const chunkArrived = new Promise((resolve) => {
    firstChunk = resolve;
  });
  const controller = new AbortController();
  const pending = readDownloadBlob(
    new Response(
      new ReadableStream({
        start(source) {
          source.enqueue(encoder.encode("one"));
        },
        pull() {
          firstChunk();
        },
        cancel() {
          activeCancelled = true;
        },
      }),
    ),
    100,
    controller.signal,
  );
  await chunkArrived;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert(
    activeCancelled,
    "An abort after response headers cancels a reader waiting for another body chunk",
  );

  const backing = new Uint8Array(10000);
  backing.set([1, 2, 3]);
  const view = new Uint8Array(backing.buffer, 0, 3);
  let pulls = 0;
  const copied = await readDownloadBlob(
    new Response(
      new ReadableStream({
        pull(source) {
          if (!pulls++) source.enqueue(view);
          else {
            backing.fill(9);
            source.close();
          }
        },
      }),
    ),
    3,
  );
  assert.deepEqual(
    [...new Uint8Array(await copied.arrayBuffer())],
    [1, 2, 3],
    "Chunks are copied without retaining or later observing their larger backing buffer",
  );

  // Compressed HTTP bodies are decoded by fetch before this helper sees them.
  const decoded = await readDownloadBlob(
    new Response("decoded", {
      headers: { "Content-Encoding": "gzip", "Content-Length": "3" },
    }),
    10,
  );
  assert.equal(await decoded.text(), "decoded");
  await assert.rejects(
    readDownloadBlob(
      new Response("decoded", {
        headers: { "Content-Encoding": "gzip", "Content-Length": "3" },
      }),
      5,
    ),
    /exceeds the allowed size/,
  );
  await assert.rejects(readDownloadBlob(new Response("a"), -1), RangeError);
  console.log(
    "PASS: bounded download streams, declared-length verification, decoded response limits, backing-buffer copies, and cancellation after headers.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
