import type {
  AccountEnvironment,
  RuntimeAccountPolicy,
} from "./account-policy";
import { WorkspaceError } from "./workspace-model";

type AccountMail = {
  email: string;
  url: string;
  kind: "verification" | "reset";
};

/** Local links never leave this installation or appear in HTTP responses/logs. */
export async function deliverAccountMail(
  database: D1Database,
  configuration: AccountEnvironment,
  policy: RuntimeAccountPolicy,
  mail: AccountMail,
): Promise<void> {
  const url = new URL(mail.url);
  if (url.origin !== policy.origin || !url.pathname.startsWith("/api/auth/"))
    throw new WorkspaceError("The account link could not be prepared.", 503);
  if (policy.public.mode === "online") {
    if (!configuration.ACCOUNT_MAILER)
      throw new WorkspaceError("Account email delivery is unavailable.", 503);
    const response = await configuration.ACCOUNT_MAILER.fetch(
      "https://account-mail.internal/send",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mail),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok)
      throw new WorkspaceError(
        "Account email delivery is temporarily unavailable. Try again later.",
        503,
      );
    return;
  }
  const now = Date.now();
  await database.batch([
    database
      .prepare("DELETE FROM account_mail_outbox WHERE expires_at <= ?")
      .bind(now),
    database
      .prepare(
        "INSERT INTO account_mail_outbox (id,email,kind,url,created_at,expires_at) VALUES (?,?,?,?,?,?)",
      )
      .bind(
        crypto.randomUUID(),
        mail.email.toLowerCase(),
        mail.kind,
        mail.url,
        now,
        now + (mail.kind === "reset" ? 1_800_000 : 3_600_000),
      ),
    database.prepare(
      "DELETE FROM account_mail_outbox WHERE id NOT IN (SELECT id FROM account_mail_outbox ORDER BY created_at DESC, id DESC LIMIT 100)",
    ),
  ]);
}
