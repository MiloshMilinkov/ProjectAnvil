import { env } from "cloudflare:workers";
import { releaseConfigurationReport } from "../../lib/release-config";
import { verifyDatabaseRelease } from "../../lib/auth";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

async function authorized(request: Request): Promise<boolean> {
  const expected = env.PROJECTANVIL_DIAGNOSTICS_TOKEN;
  const provided = request.headers.get("authorization") || "";
  if (
    !expected ||
    expected.length < 32 ||
    expected.length > 256 ||
    expected === env.BETTER_AUTH_SECRET ||
    provided.length > 1024
  )
    return false;
  const encoded = new TextEncoder();
  const digests = await Promise.all(
    [provided, `Bearer ${expected}`].map(
      async (value) =>
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", encoded.encode(value)),
        ),
    ),
  );
  let difference = 0;
  for (let index = 0; index < digests[0].length; index++)
    difference |= digests[0][index] ^ digests[1][index];
  return difference === 0;
}

/** Disabled by default. Reports availability without account, file, or secret details. */
export async function GET(request: Request) {
  if (!(await authorized(request)))
    return Response.json({ message: "Not found." }, { status: 404, headers });
  const checks = {
    configuration: false,
    database: false,
    migrations: false,
    uploads: false,
  };
  checks.configuration = releaseConfigurationReport(env).passed;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all([
        (async () => {
          if (!env.DB) return;
          const result = await env.DB.prepare("SELECT 1 AS available").first<{
            available: number;
          }>();
          checks.database = result?.available === 1;
          await verifyDatabaseRelease(env.DB);
          checks.migrations = true;
        })().catch(() => undefined),
        (async () => {
          if (!env.BUCKET) return;
          await env.BUCKET.list({ prefix: "projectanvil-health/", limit: 1 });
          checks.uploads = true;
        })().catch(() => undefined),
      ]),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 8_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  const ready = Object.values(checks).every(Boolean);
  return Response.json(
    { status: ready ? "ready" : "unavailable", checks },
    { status: ready ? 200 : 503, headers },
  );
}
