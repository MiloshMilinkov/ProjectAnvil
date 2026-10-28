import { username } from "better-auth/plugins/username";
import type { BetterAuthOptions } from "better-auth";
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
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 30,
        immutableUsername: true,
        displayUsername: false,
        usernameValidator: (value) => /^[a-zA-Z0-9_.]{3,30}$/.test(value),
      }),
    ],
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
