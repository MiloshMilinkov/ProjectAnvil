import type {
  AccountEnvironment,
  RuntimeAccountPolicy,
} from "./account-policy";
import { WorkspaceError } from "./workspace-model";
import { accountMailTransport } from "./release-config";

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
  send: typeof fetch = fetch,
): Promise<void> {
  const url = new URL(mail.url);
  if (
    url.origin !== policy.origin ||
    !url.pathname.startsWith("/api/auth/") ||
    url.username ||
    url.password ||
    mail.email.length > 254 ||
    !/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(mail.email) ||
    !["verification", "reset"].includes(mail.kind)
  )
    throw new WorkspaceError("The account link could not be prepared.", 503);
  if (policy.public.mode === "online") {
    const transport = accountMailTransport(configuration);
    if (!transport)
      throw new WorkspaceError("Account email delivery is unavailable.", 503);
    try {
      const options: RequestInit = {
        method: "POST",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mail),
        signal: AbortSignal.timeout(10_000),
      };
      let response: Response;
      if (transport === "binding") {
        response = await configuration.ACCOUNT_MAILER!.fetch(
          "https://account-mail.internal/send",
          options,
        );
      } else {
        const reset = mail.kind === "reset";
        options.headers = {
          ...options.headers,
          Authorization: `Bearer ${configuration.RESEND_API_KEY}`,
        };
        options.body = JSON.stringify({
          from: configuration.PROJECTANVIL_MAIL_FROM,
          to: [mail.email.toLowerCase()],
          subject: reset
            ? "Reset your ProjectAnvil password"
            : "Verify your ProjectAnvil email",
          text: `${reset ? "Reset your password" : "Verify your email address"} using this ProjectAnvil link:\n\n${mail.url}\n\nThis link expires ${reset ? "in 30 minutes" : "in one hour"}. If you did not request it, you can ignore this message.`,
        });
        response = await send("https://api.resend.com/emails", options);
      }
      if (!response.ok) throw new Error("Provider rejected delivery.");
      if (transport === "resend") {
        const result: unknown = await response.json();
        if (
          !result ||
          typeof result !== "object" ||
          !("id" in result) ||
          typeof result.id !== "string" ||
          !result.id
        )
          throw new Error("Provider did not acknowledge delivery.");
      }
    } catch {
      // Provider response bodies and network errors may contain addresses or links.
      throw new WorkspaceError(
        "Account email delivery is temporarily unavailable. Try again later.",
        503,
      );
    }
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
