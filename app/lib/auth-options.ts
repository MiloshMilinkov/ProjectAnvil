import { username } from "better-auth/plugins/username";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import type { RuntimeAccountPolicy } from "./account-policy";

export function authOptions(
  database: NonNullable<BetterAuthOptions["database"]>,
  secret: string,
  baseURL: string,
  delivery?: {
    policy: RuntimeAccountPolicy;
    send: (
      email: string,
      url: string,
      kind: "verification" | "reset",
    ) => Promise<void>;
  },
): BetterAuthOptions {
  const usernamePlugin = username({
    minUsernameLength: 3,
    maxUsernameLength: 30,
    immutableUsername: true,
    displayUsername: false,
    usernameValidator: (value) => /^[a-zA-Z0-9_.]{3,30}$/.test(value),
  });
  const policy = delivery?.policy;
  const policyPlugins: BetterAuthPlugin[] =
    policy?.public.mode === "online"
      ? [
          {
            id: "projectanvil-account-policy",
            // Better Auth consumes its database rate limit before onRequest.
            // Policy denials must use that same bucket rather than bypass it.
            async onRequest(request, context) {
              const path = new URL(request.url).pathname;
              if (
                request.method !== "POST" ||
                ![
                  "/api/auth/sign-up/email",
                  "/api/auth/sign-in/username",
                ].includes(path)
              )
                return;
              let body: Record<string, unknown>;
              try {
                body = await request.clone().json();
              } catch {
                return; // The native body validator reports malformed JSON.
              }
              if (!body || typeof body !== "object" || Array.isArray(body))
                return;
              if (path === "/api/auth/sign-up/email") {
                if (
                  typeof body.email !== "string" ||
                  !policy.approvedEmails.has(body.email.toLowerCase())
                )
                  return {
                    response: Response.json(
                      {
                        error:
                          "Registration is available to approved email addresses only.",
                      },
                      { status: 403 },
                    ),
                  };
                return;
              }
              if (
                typeof body.username !== "string" ||
                !/^[A-Za-z0-9_.]{3,30}$/.test(body.username) ||
                typeof body.password !== "string" ||
                !body.password ||
                body.password.length > 128 ||
                (body.rememberMe !== undefined &&
                  typeof body.rememberMe !== "boolean") ||
                (body.callbackURL !== undefined &&
                  typeof body.callbackURL !== "string")
              )
                return; // Preserve the native schema error before checking account policy.
              const user = await context.adapter.findOne<{ email: string }>({
                model: "user",
                where: [
                  { field: "username", value: body.username.toLowerCase() },
                ],
              });
              if (
                user &&
                !policy.approvedEmails.has(user.email.toLowerCase())
              ) {
                // Match the normal unknown-account password work and response.
                await context.password.hash(body.password);
                return {
                  response: Response.json(
                    usernamePlugin.$ERROR_CODES.INVALID_USERNAME_OR_PASSWORD,
                    { status: 401 },
                  ),
                };
              }
            },
          },
        ]
      : [];
  return {
    appName: "ProjectAnvil",
    database,
    secret,
    baseURL,
    trustedOrigins: [baseURL],
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification:
        delivery?.policy.public.verificationRequired || false,
      resetPasswordTokenExpiresIn: 1800,
      revokeSessionsOnPasswordReset: true,
      ...(delivery
        ? {
            sendResetPassword: async ({ user, url }) =>
              delivery.send(user.email, url, "reset"),
          }
        : {}),
    },
    ...(delivery
      ? {
          emailVerification: {
            sendOnSignUp: delivery.policy.public.verificationRequired,
            sendOnSignIn: false,
            autoSignInAfterVerification: false,
            expiresIn: 3600,
            sendVerificationEmail: async ({
              user,
              url,
            }: {
              user: { email: string };
              url: string;
            }) => delivery.send(user.email, url, "verification"),
          },
        }
      : {}),
    plugins: [usernamePlugin, ...policyPlugins],
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    advanced: {
      cookiePrefix: "projectanvil",
      useSecureCookies: baseURL.startsWith("https:"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
      ...(delivery?.policy.public.mode === "online"
        ? { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } }
        : {}),
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/username": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 3 },
        "/send-verification-email": { window: 60, max: 3 },
        "/reset-password": { window: 60, max: 10 },
      },
    },
  };
}
