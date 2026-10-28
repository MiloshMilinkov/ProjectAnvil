/** Add browser protections without buffering bodies or weakening route policies. */
export function secureResponse(request: Request, response: Response): Response {
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
  // RSC streaming, Markdown media, PDF previews and recording retain their
  // existing sources. Attachments already carry a stricter sandbox policy.
  if (!secured.headers.has("Content-Security-Policy"))
    secured.headers.set(
      "Content-Security-Policy",
      "base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
    );
  const url = new URL(request.url);
  if (url.protocol === "https:")
    secured.headers.set("Strict-Transport-Security", "max-age=31536000");
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    secured.headers.set("Cache-Control", "private, no-store");
    secured.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  }
  return secured;
}
