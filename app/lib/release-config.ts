/** Shared, side-effect-free configuration checks used by the server and local preflight. */
export interface ReleaseEnvironment {
  PROJECTANVIL_MODE?: string;
  PROJECTANVIL_ALLOWED_EMAILS?: string;
  BETTER_AUTH_URL?: string;
  BETTER_AUTH_SECRET?: string;
  PROJECTANVIL_MAIL_PROVIDER?: string;
  PROJECTANVIL_MAIL_FROM?: string;
  RESEND_API_KEY?: string;
  PROJECTANVIL_DIAGNOSTICS_TOKEN?: string;
  ACCOUNT_MAILER?: { fetch: typeof fetch };
}

export class ReleaseConfigurationError extends Error {
  status: number;
  constructor(message: string, status = 503) {
    super(message);
    this.name = "ReleaseConfigurationError";
    this.status = status;
  }
}

export function isLoopback(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

export function accountMailTransport(configuration: ReleaseEnvironment) {
  if (
    typeof configuration.ACCOUNT_MAILER?.fetch === "function" &&
    !configuration.PROJECTANVIL_MAIL_PROVIDER
  )
    return "binding" as const;
  if (
    configuration.PROJECTANVIL_MAIL_PROVIDER === "resend" &&
    !configuration.ACCOUNT_MAILER &&
    /^re_[A-Za-z0-9_-]{12,}$/.test(configuration.RESEND_API_KEY || "") &&
    (configuration.PROJECTANVIL_MAIL_FROM?.length || 0) <= 320 &&
    /^(?:[^<>\r\n]{1,80} <)?[^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+>?$/.test(
      configuration.PROJECTANVIL_MAIL_FROM || "",
    ) &&
    configuration.PROJECTANVIL_MAIL_FROM!.includes("<") ===
      configuration.PROJECTANVIL_MAIL_FROM!.endsWith(">")
  )
    return "resend" as const;
  return null;
}

export function resolveAccountConfiguration(
  configuration: ReleaseEnvironment,
  requestURL: string,
) {
  const mode = configuration.PROJECTANVIL_MODE || "local";
  if (mode !== "local" && mode !== "online")
    throw new ReleaseConfigurationError(
      "Choose a valid application access mode.",
    );
  let requested: URL;
  let configured: URL;
  try {
    requested = new URL(requestURL);
    configured = new URL(configuration.BETTER_AUTH_URL || requested.origin);
  } catch {
    throw new ReleaseConfigurationError(
      "Configure a valid account address before starting.",
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
    throw new ReleaseConfigurationError(
      "The account address must be an application origin.",
    );
  if (
    mode === "local" &&
    (!isLoopback(requested.hostname) || !isLoopback(configured.hostname))
  )
    throw new ReleaseConfigurationError(
      "Local mode is available only on this computer. Online access must be configured separately.",
    );
  if (configured.origin !== requested.origin)
    throw new ReleaseConfigurationError(
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
      (email) =>
        email.length > 254 || !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email),
    )
  )
    throw new ReleaseConfigurationError(
      "Configure up to 200 valid approved email addresses.",
    );
  if (
    mode === "online" &&
    (!configuration.BETTER_AUTH_URL ||
      configured.protocol !== "https:" ||
      !approvedEmails.size ||
      !accountMailTransport(configuration))
  )
    throw new ReleaseConfigurationError(
      "Online mode needs an HTTPS account address, approved email addresses, and a configured account email service.",
    );
  return {
    origin: configured.origin,
    approvedEmails,
    public: {
      mode,
      registration: mode === "local" ? "open" : "invite-only",
      emailDelivery: mode === "local" ? "local" : "external",
      verificationRequired: mode === "online",
    } as const,
  };
}

/** Redacted configuration evidence only; this never contacts mail, storage, or hosting. */
export function releaseConfigurationReport(configuration: ReleaseEnvironment) {
  const mode = configuration.PROJECTANVIL_MODE || "local";
  const checks: { name: string; passed: boolean }[] = [];
  let policy: ReturnType<typeof resolveAccountConfiguration> | undefined;
  try {
    policy = resolveAccountConfiguration(
      configuration,
      configuration.BETTER_AUTH_URL || "http://127.0.0.1:5173",
    );
    checks.push({ name: "access-policy", passed: true });
  } catch {
    checks.push({ name: "access-policy", passed: false });
  }
  checks.push({
    name: "account-secret",
    passed: (configuration.BETTER_AUTH_SECRET?.length || 0) >= 32,
  });
  const token = configuration.PROJECTANVIL_DIAGNOSTICS_TOKEN;
  checks.push({
    name: "private-diagnostics",
    passed:
      (mode === "local" && !token) ||
      (!!token &&
        token.length >= 32 &&
        token.length <= 256 &&
        token !== configuration.BETTER_AUTH_SECRET),
  });
  return {
    format: 1,
    mode: policy?.public.mode || (mode === "online" ? "online" : "invalid"),
    passed: checks.every((check) => check.passed),
    checks,
    mail:
      policy?.public.mode === "local"
        ? "local-outbox"
        : accountMailTransport(configuration) || "unconfigured",
    remoteResourcesVerified: false,
    note: "Configuration only. No database, mail provider, domain, backup schedule, or hosted resource was contacted or verified.",
  };
}
