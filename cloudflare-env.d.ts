declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BETTER_AUTH_SECRET?: string;
    BETTER_AUTH_URL?: string;
    PROJECTANVIL_MODE?: "local" | "online";
    PROJECTANVIL_ALLOWED_EMAILS?: string;
    ACCOUNT_MAILER?: Fetcher;
    BUCKET?: R2Bucket;
  }
}
