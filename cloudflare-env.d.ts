declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BETTER_AUTH_SECRET?: string;
    BETTER_AUTH_URL?: string;
    PROJECTANVIL_MODE?: "local" | "online";
    PROJECTANVIL_ALLOWED_EMAILS?: string;
    ACCOUNT_MAILER?: Fetcher;
    PROJECTANVIL_MAIL_PROVIDER?: "resend";
    PROJECTANVIL_MAIL_FROM?: string;
    RESEND_API_KEY?: string;
    PROJECTANVIL_DIAGNOSTICS_TOKEN?: string;
    BUCKET?: R2Bucket;
  }
}
