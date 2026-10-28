import type { AccountPolicy } from "./access-types";
import { WorkspaceError } from "./workspace-model";

export interface AccountEnvironment {
  PROJECTANVIL_MODE?: string;
  PROJECTANVIL_ALLOWED_EMAILS?: string;
  BETTER_AUTH_URL?: string;
  ACCOUNT_MAILER?: { fetch: typeof fetch };
}

export interface RuntimeAccountPolicy {
  origin: string;
  approvedEmails: ReadonlySet<string>;
  public: AccountPolicy;
}

export function isLoopback(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

/** Configuration is authoritative; a request header can never enable guest access. */
export function accountPolicy(
  configuration: AccountEnvironment,
  requestURL: string,
): RuntimeAccountPolicy {
  const mode = configuration.PROJECTANVIL_MODE || "local";
  if (mode !== "local" && mode !== "online")
    throw new WorkspaceError("Choose a valid application access mode.", 503);
  const requested = new URL(requestURL);
  let configured: URL;
  try {
    configured = new URL(configuration.BETTER_AUTH_URL || requested.origin);
  } catch {
    throw new WorkspaceError(
      "Configure a valid account address before starting.",
      503,
    );
  }
  if (
    configured.username ||
    configured.password ||
    configured.search ||
    configured.hash ||
    configured.pathname !== "/" ||
    !["http:", "https:"].includes(configured.protocol)
  )
    throw new WorkspaceError(
      "The account address must be an application origin.",
      503,
    );
  if (
    mode === "local" &&
    (!isLoopback(requested.hostname) || !isLoopback(configured.hostname))
  )
    throw new WorkspaceError(
      "Local mode is available only on this computer. Online access must be configured separately.",
      503,
    );
  if (configured.origin !== requested.origin)
    throw new WorkspaceError(
      "Open ProjectAnvil at its configured account address.",
      403,
    );
  const approvedEmails = new Set(
    (configuration.PROJECTANVIL_ALLOWED_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  if (
    approvedEmails.size > 200 ||
    [...approvedEmails].some(
      (email) => !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email),
    )
  )
    throw new WorkspaceError(
      "Configure up to 200 valid approved email addresses.",
      503,
    );
  if (
    mode === "online" &&
    (!configuration.BETTER_AUTH_URL ||
      configured.protocol !== "https:" ||
      !approvedEmails.size ||
      !configuration.ACCOUNT_MAILER)
  )
    throw new WorkspaceError(
      "Online mode needs an HTTPS account address, approved email addresses, and an account email service.",
      503,
    );
  return {
    origin: configured.origin,
    approvedEmails,
    public: {
      mode,
      registration: mode === "local" ? "open" : "invite-only",
      emailDelivery: mode === "local" ? "local" : "external",
      verificationRequired: mode === "online",
    },
  };
}

export function emailApproved(
  policy: RuntimeAccountPolicy,
  email: string,
): boolean {
  return (
    policy.public.mode === "local" ||
    policy.approvedEmails.has(email.toLowerCase())
  );
}

/** Recovery links may return only to this app, never to an external callback. */
export function accountCallback(
  value: unknown,
  origin: string,
  kind: "reset" | "verified",
): string {
  const expected = `${origin}/?account=${kind}`;
  if (value === undefined || value === "") return expected;
  if (typeof value !== "string" || value !== expected)
    throw new WorkspaceError(
      "Use the account recovery link from this application.",
      400,
    );
  return expected;
}
