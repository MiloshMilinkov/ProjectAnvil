/** Nonces belong to one document response, never to a caller or application build. */
function createNonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function contentSecurityPolicy(nonce?: string): string {
  return [
    "default-src 'none'",
    nonce
      ? `script-src 'nonce-${nonce}' 'strict-dynamic'`
      : "script-src 'self'",
    "script-src-attr 'none'",
    // React positioning, KaTeX markup and Mermaid SVG styles require inline CSS.
    // This exception authorizes styles only; script evaluation remains blocked.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: http: https:",
    "media-src 'self' blob:",
    "font-src 'self'",
    // Web references retain their existing opaque-origin iframe sandbox.
    "frame-src 'self' blob: http: https:",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ");
}

/** Seed Vinext's native nonce pipeline before rendering HTML or RSC streams. */
export function createSecurityContext(request: Request): {
  request: Request;
  nonce: string;
  policy: string;
} {
  const nonce = createNonce();
  const policy = contentSecurityPolicy(nonce);
  const headers = new Headers(request.headers);
  // A caller cannot select the renderer's nonce or weaken its request policy.
  headers.delete("Content-Security-Policy-Report-Only");
  headers.delete("x-nonce");
  headers.set("Content-Security-Policy", policy);
  headers.set("x-csp-nonce", nonce);
  return { request: new Request(request, { headers }), nonce, policy };
}

/** Add browser protections without buffering bodies or weakening route policies. */
export function secureResponse(
  request: Request,
  response: Response,
  policy = contentSecurityPolicy(),
): Response {
  // Upgrade responses cannot be reconstructed with the standard Response API.
  if (response.status === 101) return response;
  const secured = new Response(response.body, response);
  secured.headers.set("X-Content-Type-Options", "nosniff");
  secured.headers.set("Referrer-Policy", "no-referrer");
  secured.headers.set("X-Frame-Options", "SAMEORIGIN");
  secured.headers.set(
    "Permissions-Policy",
    "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)",
  );
  // Attachment routes retain their stricter sandbox rather than this app policy.
  if (!secured.headers.has("Content-Security-Policy"))
    secured.headers.set("Content-Security-Policy", policy);
  if (secured.headers.get("Content-Type")?.includes("text/html")) {
    // Shared HTTP caches must not replay document nonces. The service worker
    // separately keeps an anonymous shell and renews its nonce before serving it.
    secured.headers.set("Cache-Control", "private, no-store");
    secured.headers.delete("ETag");
    secured.headers.delete("Last-Modified");
  }
  const url = new URL(request.url);
  if (url.protocol === "https:")
    secured.headers.set("Strict-Transport-Security", "max-age=31536000");
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    secured.headers.set("Cache-Control", "private, no-store");
    secured.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  }
  return secured;
}
