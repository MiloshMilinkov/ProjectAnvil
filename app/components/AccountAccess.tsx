"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Eye, EyeOff, LoaderCircle, UserRound, X } from "lucide-react";
import type { AccountContext, AccountPolicy } from "../lib/access-types";
import { fetchWithTimeout } from "../lib/fetch-with-timeout";
import { useDialog } from "./useDialog";
import { useWorkspaceScope } from "./WorkspaceScope";
import "./accounts.css";

type AccessMode =
  | "login"
  | "register"
  | "forgot"
  | "verify"
  | "reset"
  | "verified";
type MaybeAsync = void | Promise<void>;
const usernamePattern = /^[A-Za-z0-9_.]{3,30}$/;
const localPolicy: AccountPolicy = {
  mode: "local",
  registration: "open",
  emailDelivery: "local",
  verificationRequired: false,
};

export const readableAccountError = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Couldn't complete the request. Try again.";

/** Account identity is checked by the server, including reads and session changes. */
export async function accountRequest<T>(
  url: string,
  body?: unknown,
  signal?: AbortSignal,
  expectedAccount = "guest",
): Promise<T> {
  const response = await fetchWithTimeout(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "X-Account-Id": expectedAccount,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    credentials: "same-origin",
    cache: "no-store",
    signal,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = (await response.json().catch(() => null)) as {
    error?: string | { message?: string };
    message?: string;
  } | null;
  if (!response.ok) {
    const message =
      typeof result?.error === "string"
        ? result.error
        : result?.error?.message || result?.message;
    throw new Error(
      message ||
        (response.status === 429
          ? "Too many attempts. Wait a moment and try again."
          : "Couldn't complete the request. Try again."),
    );
  }
  return result as T;
}

export function Busy({
  busy,
  children,
}: {
  busy: boolean;
  children: ReactNode;
}) {
  return (
    <>
      {busy && (
        <LoaderCircle
          size={16}
          className="account-spinner"
          aria-hidden="true"
        />
      )}
      {children}
    </>
  );
}

export function AccountDialog({
  title,
  onClose,
  children,
  labelId,
  busy = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  labelId: string;
  busy?: boolean;
}) {
  const container = useRef<HTMLElement>(null);
  useDialog(container, onClose, busy);
  return createPortal(
    <div
      className="account-dialog-shade"
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={container}
        className="account-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
      >
        <header className="account-dialog-heading">
          <div className="account-dialog-mark">
            <UserRound size={22} aria-hidden="true" />
          </div>
          <h2 id={labelId}>{title}</h2>
          <button
            type="button"
            className="account-icon-button"
            aria-label="Close account dialog"
            onClick={onClose}
            disabled={busy}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}

/** Links contain credentials. Keep them only in component memory, never browser storage. */
export function readAccountCallback(): {
  initialMode: AccessMode;
  recoveryToken?: string;
  recoveryError?: string;
  recoveryMessage?: string;
} | null {
  const url = new URL(window.location.href);
  const action = url.searchParams.get("account");
  if (action !== "reset" && action !== "verified") return null;
  const token = url.searchParams.get("token") || "";
  return {
    initialMode: action === "verified" ? "verified" : "reset",
    ...(action === "reset"
      ? { recoveryToken: token.length <= 4096 ? token : "" }
      : {}),
    ...(url.searchParams.has("error") ||
    (action === "reset" && (!token || token.length > 4096))
      ? {
          recoveryError:
            "This link is invalid or has expired. Request a new link.",
        }
      : {}),
  };
}

export function clearAccountCallback() {
  const url = new URL(window.location.href);
  for (const key of ["account", "token", "error", "error_description"])
    url.searchParams.delete(key);
  window.history.replaceState(
    window.history.state,
    "",
    url.pathname + url.search + url.hash,
  );
}

function deliveryHelp(policy: AccountPolicy) {
  return policy.emailDelivery === "local"
    ? "This local version doesn't send email. Use the account-mail command in the setup guide to open your private link."
    : policy.emailDelivery === "disabled"
      ? "Account email is unavailable. Contact the person who manages this installation."
      : "Check your inbox and spam folder.";
}

export function AccountAccess({
  policy = localPolicy,
  account,
  onAuthenticated,
  onPasswordReset,
  onClose,
  initialMode = "login",
  recoveryToken,
  recoveryError = "",
  recoveryMessage = "",
  prepareChange,
}: {
  policy?: AccountPolicy;
  account?: AccountContext;
  onAuthenticated: () => MaybeAsync;
  onClose?: () => void;
  initialMode?: AccessMode;
  recoveryToken?: string;
  recoveryError?: string;
  recoveryMessage?: string;
  prepareChange?: () => MaybeAsync;
  onPasswordReset?: () => MaybeAsync;
}) {
  const [mode, setMode] = useState<AccessMode>(initialMode);
  const [busy, setBusy] = useState(false),
    [show, setShow] = useState(false),
    [error, setError] = useState(recoveryError),
    [message, setMessage] = useState(recoveryMessage);
  const [email, setEmail] = useState(account?.user?.email || "");
  const submitting = useRef(false),
    heading = useId(),
    feedback = useId();
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.querySelector<HTMLInputElement>("input:enabled")?.focus();
  }, [mode]);
  const expectedAccount = account?.user?.id || "guest";
  const emailAvailable = policy.emailDelivery !== "disabled";
  const title =
    mode === "login"
      ? "Welcome back"
      : mode === "register"
        ? "Create your account"
        : mode === "forgot"
          ? "Reset your password"
          : mode === "verify"
            ? "Verify your email"
            : mode === "reset"
              ? "Choose a new password"
              : "Email verification";
  function navigate(next: AccessMode) {
    setMode(next);
    setError("");
    setMessage("");
    setShow(false);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setError("");
    setMessage("");
    const values = new FormData(event.currentTarget);
    const username = String(values.get("username") || "").trim(),
      password = String(values.get("password") || "");
    if (
      (mode === "login" || mode === "register") &&
      !usernamePattern.test(username)
    ) {
      setError(
        "Choose a username with 3–30 letters, numbers, underscores, or dots.",
      );
      return;
    }
    if (mode === "register" || mode === "reset") {
      if (password.length < 12 || password.length > 128) {
        setError("Use a password with 12–128 characters.");
        return;
      }
      if (password !== String(values.get("confirmPassword") || "")) {
        setError("The passwords do not match.");
        return;
      }
    }
    if (mode === "reset" && !recoveryToken) {
      setError("This link is invalid or has expired. Request a new link.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const callbackURL = window.location.origin + "/?account=verified";
      if (mode === "forgot" || mode === "verify") {
        await accountRequest(
          mode === "forgot"
            ? "/api/auth/request-password-reset"
            : "/api/auth/send-verification-email",
          mode === "forgot"
            ? {
                email: email.trim(),
                redirectTo: window.location.origin + "/?account=reset",
              }
            : { email: email.trim(), callbackURL },
          undefined,
          expectedAccount,
        );
        setMessage("If this email matches an account, check for a link.");
      } else if (mode === "reset") {
        await prepareChange?.();
        await accountRequest(
          "/api/auth/reset-password",
          { token: recoveryToken, newPassword: password },
          undefined,
          expectedAccount,
        );
        clearAccountCallback();
        navigate("login");
        setMessage(
          "Your password has been changed. Sign in with your new password. Previous sessions have been signed out.",
        );
        await onPasswordReset?.();
      } else {
        await prepareChange?.();
        const result = await accountRequest<{ token?: string | null }>(
          mode === "register"
            ? "/api/auth/sign-up/email"
            : "/api/auth/sign-in/username",
          mode === "register"
            ? {
                email: email.trim(),
                name: username,
                username,
                password,
                callbackURL,
              }
            : { username, password },
          undefined,
          expectedAccount,
        );
        if (
          mode === "register" &&
          policy.verificationRequired &&
          !result?.token
        ) {
          navigate("verify");
          setMessage("Account created. Verify your email before signing in.");
        } else {
          await onAuthenticated();
          onClose?.();
        }
      }
    } catch (cause) {
      setError(readableAccountError(cause));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const contents = (
    <>
      {(mode === "login" || mode === "register") && (
        <div className="account-auth-tabs" aria-label="Account access">
          <button
            type="button"
            aria-pressed={mode === "login"}
            disabled={busy}
            onClick={() => navigate("login")}
          >
            Sign in
          </button>
          <button
            type="button"
            aria-pressed={mode === "register"}
            disabled={busy}
            onClick={() => navigate("register")}
          >
            Register
          </button>
        </div>
      )}
      <p className="account-intro">
        {mode === "login"
          ? "Sign in to open your workspaces."
          : mode === "register"
            ? policy.registration === "invite-only"
              ? "Registration is limited to approved email addresses. Your account starts with a private workspace."
              : "Your account includes a private workspace. You can join teams later."
            : mode === "forgot"
              ? "Enter the email address used for your ProjectAnvil account."
              : mode === "verify"
                ? "Request a verification link for your email address."
                : mode === "reset"
                  ? "Choose a new ProjectAnvil password. Resetting signs out previous sessions."
                  : error
                    ? "Request a new verification link to continue."
                    : "Your email has been verified. You can now sign in."}
      </p>
      {message && (
        <p className="account-success" role="status">
          {message}
        </p>
      )}
      {mode === "verified" ? (
        <>
          {error && (
            <p role="alert" className="account-error">
              {error}
            </p>
          )}
          <button
            className="account-button account-primary"
            type="button"
            onClick={() => {
              clearAccountCallback();
              navigate(error ? "verify" : "login");
            }}
          >
            {error ? "Request verification link" : "Continue to sign in"}
          </button>
        </>
      ) : (
        <form
          ref={form}
          onSubmit={submit}
          className="account-auth-form"
          key={mode}
          aria-describedby={error ? feedback : undefined}
        >
          {(mode === "register" || mode === "forgot" || mode === "verify") && (
            <label className="account-field">
              <span>Email address</span>
              <input
                data-initial-focus
                type="email"
                name="email"
                autoComplete="email"
                autoCapitalize="none"
                required
                maxLength={254}
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={busy}
              />
              {mode === "register" && (
                <small>
                  Use your email address and create a separate ProjectAnvil
                  password.
                </small>
              )}
            </label>
          )}
          {(mode === "login" || mode === "register") && (
            <label className="account-field">
              <span>Username</span>
              <input
                data-initial-focus={mode === "login" ? true : undefined}
                type="text"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                minLength={3}
                maxLength={30}
                pattern="[A-Za-z0-9_.]{3,30}"
                placeholder="e.g. alex"
                disabled={busy}
              />
              {mode === "register" && (
                <small>
                  3–30 letters, numbers, underscores, or dots. Usernames are not
                  case-sensitive.
                </small>
              )}
            </label>
          )}
          {(mode === "login" || mode === "register" || mode === "reset") && (
            <label className="account-field">
              <span>{mode === "reset" ? "New password" : "Password"}</span>
              <div className="account-password">
                <input
                  data-initial-focus={mode === "reset" ? true : undefined}
                  type={show ? "text" : "password"}
                  name="password"
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  required
                  minLength={mode === "login" ? undefined : 12}
                  maxLength={128}
                  disabled={busy}
                />
                <button
                  className="account-icon-button"
                  type="button"
                  aria-label={show ? "Hide password" : "Show password"}
                  aria-pressed={show}
                  onClick={() => setShow((value) => !value)}
                  disabled={busy}
                >
                  {show ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {mode !== "login" && (
                <small>
                  12–128 characters. Use a password you have not used elsewhere.
                </small>
              )}
            </label>
          )}
          {(mode === "register" || mode === "reset") && (
            <label className="account-field">
              <span>Confirm password</span>
              <input
                type={show ? "text" : "password"}
                name="confirmPassword"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                disabled={busy}
              />
            </label>
          )}
          {error && (
            <p role="alert" className="account-error" id={feedback}>
              {error}
            </p>
          )}
          <button
            className="account-button account-primary account-submit"
            type="submit"
            disabled={
              busy ||
              ((mode === "forgot" || mode === "verify") && !emailAvailable) ||
              (mode === "reset" && !recoveryToken)
            }
          >
            <Busy busy={busy}>
              {mode === "register"
                ? "Create account"
                : mode === "forgot"
                  ? "Request reset link"
                  : mode === "verify"
                    ? "Request verification link"
                    : mode === "reset"
                      ? "Save new password"
                      : "Sign in"}
            </Busy>
          </button>
        </form>
      )}
      <div className="account-access-actions">
        {mode === "login" && (
          <>
            <button
              className="account-button account-subtle"
              type="button"
              disabled={busy || !emailAvailable}
              onClick={() => navigate("forgot")}
            >
              Forgot password?
            </button>
            <button
              className="account-button account-subtle"
              type="button"
              disabled={busy || !emailAvailable}
              onClick={() => navigate("verify")}
            >
              Verify email
            </button>
          </>
        )}
        {mode !== "login" && mode !== "register" && mode !== "verified" && (
          <button
            className="account-button"
            type="button"
            disabled={busy}
            onClick={() => {
              clearAccountCallback();
              navigate("login");
            }}
          >
            Back to sign in
          </button>
        )}
        {mode === "reset" && error && (
          <button
            className="account-button"
            type="button"
            disabled={busy}
            onClick={() => {
              clearAccountCallback();
              navigate("forgot");
            }}
          >
            Request new reset link
          </button>
        )}
      </div>
      {(mode === "forgot" || mode === "verify") && (
        <p className="account-intro">{deliveryHelp(policy)}</p>
      )}
      <p className="account-footnote">
        {policy.mode === "local"
          ? "Guest work stays in its existing workspace when you sign in."
          : "Sign-in is required. Each account opens only its private and authorized team workspaces."}
      </p>
    </>
  );
  if (onClose)
    return (
      <AccountDialog
        title={title}
        labelId={heading}
        onClose={onClose}
        busy={busy}
      >
        {contents}
      </AccountDialog>
    );
  return (
    <main className="account-entry">
      <section className="account-dialog" aria-labelledby={heading}>
        <header className="account-dialog-heading">
          <div className="account-dialog-mark">
            <UserRound size={22} aria-hidden="true" />
          </div>
          <h1 id={heading}>{title}</h1>
        </header>
        {contents}
      </section>
    </main>
  );
}

type AccountSession = {
  id: string;
  userAgent?: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
};
const dateLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unavailable" : date.toLocaleString();
};

export function AccountSecurity({
  account,
  onAuthChanged,
  onClose,
  prepareChange,
}: {
  account: AccountContext;
  onAuthChanged: () => MaybeAsync;
  onClose: () => void;
  prepareChange: () => MaybeAsync;
}) {
  const { onSessionChanged } = useWorkspaceScope();
  const [sessions, setSessions] = useState<AccountSession[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState("");
  const [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const active = useRef(true),
    submitting = useRef(false),
    id = useId();
  const user = account.user,
    policy = account.policy || localPolicy;
  const accountId = user?.id || "guest";
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const result = await accountRequest<{ sessions: AccountSession[] }>(
        "/api/account/sessions",
        undefined,
        signal,
        accountId,
      );
      if (!Array.isArray(result?.sessions))
        throw new Error("Couldn't load your sessions. Try again.");
      if (active.current) setSessions(result.sessions);
    },
    [accountId],
  );
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    void load(controller.signal)
      .catch((cause) => {
        if (active.current) setError(readableAccountError(cause));
      })
      .finally(() => {
        if (active.current) setLoading(false);
      });
    return () => {
      active.current = false;
      controller.abort();
    };
  }, [load]);
  async function action(key: string, run: () => Promise<void>) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(key);
    setError("");
    setMessage("");
    try {
      await run();
    } catch (cause) {
      if (active.current) setError(readableAccountError(cause));
    } finally {
      submitting.current = false;
      if (active.current) setBusy("");
    }
  }
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      values = new FormData(form);
    const password = String(values.get("newPassword") || "");
    if (password.length < 12 || password.length > 128) {
      setError("Use a password with 12–128 characters.");
      return;
    }
    if (password !== String(values.get("confirmPassword") || "")) {
      setError("The passwords do not match.");
      return;
    }
    await action("password", async () => {
      await prepareChange();
      await accountRequest(
        "/api/auth/change-password",
        {
          currentPassword: String(values.get("currentPassword") || ""),
          newPassword: password,
          revokeOtherSessions: true,
        },
        undefined,
        accountId,
      );
      await onSessionChanged();
      form.reset();
      setMessage("Password changed. Other sessions have been signed out.");
      await load();
    });
  }
  if (!user) return null;
  return (
    <AccountDialog
      title="Account security"
      labelId={id}
      onClose={onClose}
      busy={!!busy}
    >
      <div className="account-security" data-tour="account-security">
        <section aria-labelledby={`${id}-email`}>
          <h3 id={`${id}-email`}>Email verification</h3>
          <p className="account-security-email">{user.email}</p>
          <p>{user.emailVerified ? "Verified" : "Not verified yet"}</p>
          {!user.emailVerified && (
            <button
              className="account-button"
              type="button"
              disabled={!!busy || policy.emailDelivery === "disabled"}
              onClick={() =>
                void action("verify", async () => {
                  await accountRequest(
                    "/api/auth/send-verification-email",
                    {
                      email: user.email,
                      callbackURL:
                        window.location.origin + "/?account=verified",
                    },
                    undefined,
                    accountId,
                  );
                  setMessage(
                    "A verification link has been prepared. " +
                      deliveryHelp(policy),
                  );
                })
              }
            >
              <Busy busy={busy === "verify"}>Request verification link</Busy>
            </button>
          )}
        </section>
        <details>
          <summary>Change password</summary>
          <p>
            Changing your password signs out other sessions. This session stays
            open.
          </p>
          <form className="account-auth-form" onSubmit={changePassword}>
            <label className="account-field">
              <span>Current password</span>
              <input
                type="password"
                name="currentPassword"
                autoComplete="current-password"
                required
                maxLength={128}
                disabled={!!busy}
              />
            </label>
            <label className="account-field">
              <span>New password</span>
              <input
                type="password"
                name="newPassword"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                disabled={!!busy}
              />
              <small>12–128 characters.</small>
            </label>
            <label className="account-field">
              <span>Confirm new password</span>
              <input
                type="password"
                name="confirmPassword"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                disabled={!!busy}
              />
            </label>
            <button
              className="account-button account-primary"
              type="submit"
              disabled={!!busy}
            >
              <Busy busy={busy === "password"}>Change password</Busy>
            </button>
          </form>
        </details>
        <section aria-labelledby={`${id}-sessions`}>
          <h3 id={`${id}-sessions`}>Signed-in sessions</h3>
          <p>
            Sign out browsers you no longer use. Saved offline copies can still
            be read while disconnected.
          </p>
          {loading ? (
            <p role="status">Loading sessions…</p>
          ) : (
            <ul className="account-session-list">
              {sessions.map((session) => (
                <li key={session.id}>
                  <div>
                    <strong>
                      {session.current ? "This session" : "Another session"}
                    </strong>
                    <span>
                      {session.userAgent?.slice(0, 180) ||
                        "Browser details unavailable"}
                    </span>
                    <small>
                      Started {dateLabel(session.createdAt)} · Expires{" "}
                      {dateLabel(session.expiresAt)}
                    </small>
                  </div>
                  <button
                    className="account-button"
                    type="button"
                    disabled={!!busy}
                    onClick={() =>
                      void action(session.id, async () => {
                        if (session.current) {
                          await prepareChange();
                          await accountRequest(
                            "/api/auth/sign-out",
                            {},
                            undefined,
                            accountId,
                          );
                          await onAuthChanged();
                          onClose();
                        } else {
                          await accountRequest(
                            "/api/account/sessions",
                            { action: "revoke", sessionId: session.id },
                            undefined,
                            accountId,
                          );
                          await load();
                          setMessage("That session has been signed out.");
                        }
                      })
                    }
                  >
                    <Busy busy={busy === session.id}>
                      {session.current ? "Sign out here" : "Sign out"}
                    </Busy>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="account-access-actions">
            <button
              className="account-button"
              type="button"
              disabled={!!busy || loading}
              onClick={() =>
                void action("refresh", async () => {
                  await load();
                  setMessage("Sessions refreshed.");
                })
              }
            >
              <Busy busy={busy === "refresh"}>Refresh sessions</Busy>
            </button>
            <button
              className="account-button"
              type="button"
              disabled={
                !!busy ||
                loading ||
                !sessions.some((session) => !session.current)
              }
              onClick={() =>
                void action("others", async () => {
                  await accountRequest(
                    "/api/account/sessions",
                    { action: "revoke-others" },
                    undefined,
                    accountId,
                  );
                  await load();
                  setMessage("Other sessions have been signed out.");
                })
              }
            >
              <Busy busy={busy === "others"}>Sign out other sessions</Busy>
            </button>
          </div>
        </section>
        {error && (
          <p className="account-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="account-success" role="status">
            {message}
          </p>
        )}
      </div>
    </AccountDialog>
  );
}
