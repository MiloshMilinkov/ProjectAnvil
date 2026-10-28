"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import {
  Check,
  ChevronDown,
  Home,
  LoaderCircle,
  LogIn,
  LogOut,
  Mail,
  Plus,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import type { AccountContext, WorkspaceAccess } from "../lib/access-types";
import "./accounts.css";
import { flushDraftGuards, hasUnpersistedDrafts } from "../lib/draft-store";
import { useDraftScope } from "./useRecoverableDraft";
import TeamRoleEditor from "./TeamRoleEditor";
import {
  AccountAccess,
  AccountSecurity,
  AccountDialog,
  Busy,
  accountRequest as request,
  readableAccountError as readableError,
} from "./AccountAccess";
import { useWorkspaceScope } from "./WorkspaceScope";

type MaybeAsync = void | Promise<void>;
type AccountMenuProps = {
  account: AccountContext;
  onAuthChanged: () => MaybeAsync;
  onOpenTeams: () => void;
};
type WorkspaceSwitcherProps = {
  account: AccountContext;
  activeId: string;
  onSwitch: (id: string) => MaybeAsync;
  onManage: () => void;
};
type TeamManagerProps = {
  account: AccountContext;
  activeId: string;
  onChanged: (account: AccountContext) => MaybeAsync;
  onSwitch: (id: string) => MaybeAsync;
  notify: (message: string) => void;
  onSignIn?: () => void;
};
type TeamDetails = {
  members: { id: string; username: string; role: WorkspaceAccess["role"] }[];
  invitations: {
    id: string;
    username: string;
    role?: WorkspaceAccess["role"];
  }[];
  securityRevision?: number;
};
type ConfirmAction = {
  action: "remove" | "leave" | "cancel" | "transfer";
  title: string;
  description: string;
  workspaceId: string;
  userId?: string;
  invitationId?: string;
  expectedOwnerId?: string;
};
const usernamePattern = /^[A-Za-z0-9_.]{3,30}$/;
function useDismiss(
  open: boolean,
  close: () => void,
  ref: RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    const key = (event: KeyboardEvent) => {
      if (!ref.current?.contains(event.target as Node)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        ref.current
          ?.querySelector<HTMLButtonElement>("[aria-expanded]")
          ?.focus();
      }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        const buttons = Array.from(
          ref.current.querySelectorAll<HTMLButtonElement>(
            '[role="menu"] button:not([disabled])',
          ),
        );
        if (!buttons.length) return;
        event.preventDefault();
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : event.key === "ArrowDown"
                ? (index + 1) % buttons.length
                : index < 0
                  ? buttons.length - 1
                  : (index - 1 + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [open, close, ref]);
}

export function AccountMenu({
  account,
  onAuthChanged,
  onOpenTeams,
}: AccountMenuProps) {
  const { isOffline } = useWorkspaceScope();
  const scope = useDraftScope();
  const submitting = useRef(false);
  const [open, setOpen] = useState(false),
    [auth, setAuth] = useState<"login" | "register" | null>(null),
    [security, setSecurity] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const menu = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []),
    closeAuth = useCallback(() => setAuth(null), []),
    closeSecurity = useCallback(() => setSecurity(false), []);
  useDismiss(open, close, menu);
  async function prepareChange() {
    await flushDraftGuards(scope);
    if (hasUnpersistedDrafts(scope))
      throw new Error(
        "Keep this page open until your recording or recovery copy can be saved.",
      );
  }
  async function signOut() {
    if (submitting.current) return;
    if (isOffline) {
      setError(
        "Connect to ProjectAnvil to sign out. You can remove the offline copy from Workspace settings while disconnected.",
      );
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await prepareChange();
      await request(
        "/api/auth/sign-out",
        {},
        undefined,
        account.user?.id || "guest",
      );
      await onAuthChanged();
      setOpen(false);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <div className="account-menu" ref={menu}>
        {account.user ? (
          <button
            type="button"
            className="account-trigger"
            aria-label={"Account: " + account.user.username}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => {
              setError("");
              setOpen((value) => !value);
            }}
          >
            <span className="account-avatar" aria-hidden="true">
              {account.user.username.slice(0, 2).toUpperCase()}
            </span>
            <span className="account-trigger-name">
              {account.user.username}
            </span>
            <ChevronDown size={14} />
          </button>
        ) : (
          <button
            type="button"
            className="account-trigger account-guest-trigger"
            onClick={() => {
              setOpen(false);
              setAuth("login");
            }}
            aria-label="Sign in or create account"
          >
            <UserRound size={17} />
            <span>Sign in</span>
          </button>
        )}
        {open && account.user && (
          <div
            className="account-dropdown"
            role="menu"
            aria-label="Account options"
          >
            <div className="account-identity">
              <strong>{account.user.username}</strong>
              <span>{account.user.email}</span>
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                menu.current
                  ?.querySelector<HTMLButtonElement>(":scope > button")
                  ?.focus();
                setOpen(false);
                setSecurity(true);
              }}
              disabled={isOffline}
            >
              <ShieldCheck size={17} />
              Account security
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenTeams();
              }}
            >
              <Users size={17} />
              Teams & workspaces
              {account.invitations.length > 0 && (
                <span className="account-count">
                  {account.invitations.length}
                </span>
              )}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={signOut}
              disabled={busy}
            >
              <LogOut size={17} />
              <Busy busy={busy}>Sign out</Busy>
            </button>
            {error && (
              <p role="alert" className="account-error">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
      {auth && (
        <AccountAccess
          policy={account.policy}
          account={account}
          initialMode={auth}
          onAuthenticated={onAuthChanged}
          onClose={closeAuth}
          prepareChange={prepareChange}
        />
      )}
      {security && (
        <AccountSecurity
          account={account}
          onAuthChanged={onAuthChanged}
          onClose={closeSecurity}
          prepareChange={prepareChange}
        />
      )}
    </>
  );
}

const workspaceLabel = (workspace: WorkspaceAccess) =>
  workspace.kind === "team"
    ? "Team workspace"
    : workspace.kind === "personal"
      ? "Private personal workspace"
      : "Guest workspace";

export function WorkspaceSwitcher({
  account,
  activeId,
  onSwitch,
  onManage,
}: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const menu = useRef<HTMLDivElement>(null),
    close = useCallback(() => setOpen(false), []);
  const selected =
    account.workspaces.find((workspace) => workspace.id === activeId) ||
    account.workspaces[0];
  useDismiss(open, close, menu);
  async function choose(id: string) {
    if (busy) return;
    setBusy(id);
    setError("");
    try {
      await onSwitch(id);
      setOpen(false);
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="account-workspace-switcher" ref={menu}>
      <button
        type="button"
        className="account-workspace-trigger"
        aria-label={
          "Switch workspace: " + (selected?.name || "Guest workspace")
        }
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          setOpen((value) => !value);
          setError("");
        }}
      >
        <span className="account-workspace-icon">
          {selected?.kind === "team" ? <Users size={19} /> : <Home size={19} />}
        </span>
        <span>
          <strong>{selected?.name || "Guest workspace"}</strong>
          <small>
            {selected ? workspaceLabel(selected) : "Guest workspace"}
          </small>
        </span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Your workspaces"
          className="account-workspace-dropdown"
        >
          <span className="account-menu-caption">Workspaces</span>
          {account.workspaces.map((workspace) => (
            <button
              role="menuitemradio"
              aria-checked={workspace.id === activeId}
              type="button"
              key={workspace.id}
              disabled={!!busy}
              onClick={() => choose(workspace.id)}
            >
              {workspace.kind === "team" ? (
                <Users size={17} />
              ) : (
                <Home size={17} />
              )}
              <span>
                <strong>{workspace.name}</strong>
                <small>{workspaceLabel(workspace)}</small>
              </span>
              {busy === workspace.id ? (
                <LoaderCircle size={16} className="account-spinner" />
              ) : (
                workspace.id === activeId && <Check size={16} />
              )}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className="account-manage-workspaces"
            onClick={() => {
              setOpen(false);
              onManage();
            }}
          >
            <Plus size={17} />
            {account.user ? "Teams & workspaces" : "About workspaces"}
            {account.invitations.length > 0 && (
              <span className="account-count">
                {account.invitations.length}
              </span>
            )}
          </button>
          {error && (
            <p role="alert" className="account-error">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function TeamManager({
  account,
  activeId,
  onChanged,
  onSwitch,
  notify,
  onSignIn,
}: TeamManagerProps) {
  const [teamName, setTeamName] = useState(""),
    [inviteName, setInviteName] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const [inviteRole, setInviteRole] = useState<"admin" | "editor" | "viewer">(
    "editor",
  );
  const [roleFocus, setRoleFocus] = useState("");
  const [detailsResult, setDetailsResult] = useState<{
    key: string;
    details: TeamDetails | null;
    error: string;
  } | null>(null);
  const actionPending = useRef(false);
  const userId = account.user?.id || "";
  const active = account.workspaces.find(
      (workspace) => workspace.id === activeId,
    ),
    teams = account.workspaces.filter((workspace) => workspace.kind === "team"),
    personal = account.workspaces.find(
      (workspace) => workspace.kind === "personal",
    ),
    teamActive = active?.kind === "team",
    owner = teamActive && active.role === "owner",
    manager = teamActive && (owner || active.role === "admin"),
    confirmId = useId();
  const detailsKey = `${activeId}:${userId}:${revision}:${active?.securityRevision || 0}`;
  const effectiveInviteRole =
    !owner && inviteRole === "admin" ? "editor" : inviteRole;
  const details =
    detailsResult?.key === detailsKey ? detailsResult.details : null;
  const detailsError =
    detailsResult?.key === detailsKey ? detailsResult.error : "";
  const loading = !!userId && teamActive && detailsResult?.key !== detailsKey;
  useEffect(() => {
    if (!userId || !teamActive) return;
    const controller = new AbortController();
    request<TeamDetails>(
      "/api/teams?workspaceId=" + encodeURIComponent(activeId),
      undefined,
      controller.signal,
      userId,
    )
      .then((result) => {
        if (!controller.signal.aborted)
          setDetailsResult({ key: detailsKey, details: result, error: "" });
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setDetailsResult({
            key: detailsKey,
            details: null,
            error: readableError(e),
          });
        }
      });
    return () => controller.abort();
  }, [activeId, teamActive, userId, detailsKey]);
  async function action(
    key: string,
    body: Record<string, string>,
    success: string,
    after?: (next: AccountContext) => MaybeAsync,
  ) {
    if (actionPending.current) return;
    actionPending.current = true;
    setBusy(key);
    setError("");
    try {
      const result = await request<
        AccountContext | { account: AccountContext }
      >("/api/teams", body, undefined, account.user?.id || "guest");
      const next = "account" in result ? result.account : result;
      await onChanged(next);
      await after?.(next);
      setRevision((value) => value + 1);
      notify(success);
      setConfirm(null);
    } catch (e) {
      setError(readableError(e));
    } finally {
      actionPending.current = false;
      setBusy("");
    }
  }
  async function switchWorkspace(id: string) {
    if (actionPending.current) return;
    actionPending.current = true;
    setBusy("switch");
    setError("");
    try {
      await onSwitch(id);
    } catch (e) {
      setError(readableError(e));
    } finally {
      actionPending.current = false;
      setBusy("");
    }
  }
  async function createTeam(event: FormEvent) {
    event.preventDefault();
    const name = teamName.trim();
    if (!name) return;
    const previous = new Set(teams.map((workspace) => workspace.id));
    await action(
      "create",
      { action: "create", name },
      "Team workspace created",
      async (next) => {
        setTeamName("");
        const created = next.workspaces.find(
          (workspace) =>
            workspace.kind === "team" && !previous.has(workspace.id),
        );
        if (created) await onSwitch(created.id);
      },
    );
  }
  async function invite(event: FormEvent) {
    event.preventDefault();
    const username = inviteName.trim();
    if (!usernamePattern.test(username)) {
      setError(
        "Enter a username with 3–30 letters, numbers, underscores, or dots.",
      );
      return;
    }
    await action(
      "invite",
      {
        action: "invite",
        workspaceId: activeId,
        username,
        role: effectiveInviteRole,
      },
      "Invitation sent in ProjectAnvil",
      () => setInviteName(""),
    );
  }
  const closeConfirm = useCallback(() => setConfirm(null), []);
  if (!account.user)
    return (
      <section className="page account-team-page">
        <header className="account-page-heading">
          <h1>Teams & workspaces</h1>
          <p>
            Personal workspaces are private. Team workspaces let you share
            projects.
          </p>
        </header>
        <div className="account-model-grid">
          <article className="account-card">
            <Home size={23} />
            <h2>Personal workspace</h2>
            <p>
              Register or sign in to keep projects, tasks, notes, and media
              private to your account.
            </p>
          </article>
          <article className="account-card">
            <Users size={23} />
            <h2>Team workspace</h2>
            <p>
              Create a team or accept an invitation. Roles and project access
              control who can read or edit connected work.
            </p>
          </article>
        </div>
        <section className="account-card account-guest-explanation">
          <h2>Guest work is still here</h2>
          <p>
            Your existing guest workspace is kept separately. Creating an
            account does not copy it into a team or share it with anyone.
          </p>
          {onSignIn && (
            <button
              type="button"
              className="account-button account-primary"
              onClick={onSignIn}
            >
              <LogIn size={17} />
              Sign in or register
            </button>
          )}
        </section>
      </section>
    );
  return (
    <section className="page account-team-page">
      <header className="account-page-heading">
        <h1>Teams & workspaces</h1>
        <p>Manage your workspaces, invitations, and team members.</p>
      </header>
      <div className="account-workspace-explanation">
        <p>
          <strong>Sharing work</strong> Team roles and project permissions
          control access. Adding a name to a task does not share the workspace.
        </p>
      </div>
      {error && (
        <p role="alert" className="account-error account-page-error">
          {error}
        </p>
      )}
      {account.invitations.length > 0 && (
        <section className="account-card account-invitations">
          <div className="account-section-heading">
            <Mail size={20} />
            <h2>Team invitations</h2>
            <span className="account-count">{account.invitations.length}</span>
          </div>
          <p>
            Invitations appear here. Accept one to join the shared workspace.
          </p>
          {account.invitations.map((invitation) => (
            <div className="account-invitation-row" key={invitation.id}>
              <div>
                <strong>{invitation.workspaceName}</strong>
                <span>Invited by {invitation.invitedBy}</span>
              </div>
              <div className="account-row-actions">
                <button
                  className="account-button"
                  type="button"
                  disabled={!!busy}
                  onClick={() =>
                    action(
                      "decline-" + invitation.id,
                      { action: "decline", invitationId: invitation.id },
                      "Invitation declined",
                    )
                  }
                >
                  <Busy busy={busy === "decline-" + invitation.id}>
                    Decline
                  </Busy>
                </button>
                <button
                  className="account-button account-primary"
                  type="button"
                  disabled={!!busy}
                  onClick={() =>
                    action(
                      "accept-" + invitation.id,
                      { action: "accept", invitationId: invitation.id },
                      "You joined " + invitation.workspaceName,
                      () => onSwitch(invitation.workspaceId),
                    )
                  }
                >
                  <Busy busy={busy === "accept-" + invitation.id}>
                    Accept invitation
                  </Busy>
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
      <div className="account-workspace-grid">
        {personal && (
          <article
            className={
              "account-card account-workspace-card " +
              (activeId === personal.id ? "account-is-active" : "")
            }
          >
            <div className="account-section-heading">
              <Home size={21} />
              <span className="account-kind">PERSONAL</span>
              {activeId === personal.id && (
                <span className="account-active-label">
                  <Check size={14} />
                  Current
                </span>
              )}
            </div>
            <h2>{personal.name}</h2>
            <p>
              Only you can open the projects, notes, and tasks in this
              workspace.
            </p>
            <button
              type="button"
              className="account-button"
              disabled={!!busy || activeId === personal.id}
              onClick={() => switchWorkspace(personal.id)}
            >
              {activeId === personal.id
                ? "Current workspace"
                : "Open personal workspace"}
            </button>
          </article>
        )}
        {teams.map((workspace) => (
          <article
            key={workspace.id}
            className={
              "account-card account-workspace-card " +
              (activeId === workspace.id ? "account-is-active" : "")
            }
          >
            <div className="account-section-heading">
              <Users size={21} />
              <span className="account-kind">
                TEAM · {workspace.role.toUpperCase()}
              </span>
              {activeId === workspace.id && (
                <span className="account-active-label">
                  <Check size={14} />
                  Current
                </span>
              )}
            </div>
            <h2>{workspace.name}</h2>
            <p>Your role determines what you can view or edit.</p>
            <button
              type="button"
              className="account-button"
              disabled={!!busy || activeId === workspace.id}
              onClick={() => switchWorkspace(workspace.id)}
            >
              {activeId === workspace.id
                ? "Current workspace"
                : "Open team workspace"}
            </button>
          </article>
        ))}
        <article className="account-card account-create-team">
          <div className="account-section-heading">
            <Plus size={21} />
            <h2>Create a team</h2>
          </div>
          <p>Create a shared workspace and invite people by username.</p>
          <form onSubmit={createTeam}>
            <label className="account-field">
              <span>Team name</span>
              <input
                name="teamName"
                value={teamName}
                onChange={(event) => setTeamName(event.target.value)}
                required
                maxLength={80}
                placeholder="e.g. Design team"
                disabled={!!busy}
              />
            </label>
            <button
              type="submit"
              className="account-button account-primary"
              disabled={!!busy || !teamName.trim()}
            >
              <Busy busy={busy === "create"}>Create team workspace</Busy>
            </button>
          </form>
        </article>
      </div>
      {teamActive && (
        <section
          className="account-card account-members-panel"
          data-tour="team-roles"
        >
          <div className="account-section-heading">
            <Users size={22} />
            <h2>{active.name} members</h2>
            {owner && <span className="account-role">You are the owner</span>}
          </div>
          <p>
            Viewers read shared work. Editors make changes. Admins manage
            members and project access. The owner can also transfer ownership.
          </p>
          {loading && (
            <div className="account-loading" role="status">
              <LoaderCircle className="account-spinner" size={20} />
              Loading members…
            </div>
          )}
          {detailsError && (
            <div className="account-error" role="alert">
              {detailsError}
              <button
                className="account-button"
                type="button"
                onClick={() => setRevision((value) => value + 1)}
              >
                Try again
              </button>
            </div>
          )}
          {details && (
            <>
              <ul className="account-member-list">
                {details.members.map((member) => (
                  <li key={member.id}>
                    <span className="account-avatar">
                      {member.username.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="account-member-name">
                      <strong>
                        {member.username}
                        {member.id === account.user!.id && (
                          <small> (you)</small>
                        )}
                      </strong>
                      <span>
                        {member.role.charAt(0).toUpperCase() +
                          member.role.slice(1)}
                      </span>
                    </span>
                    {manager &&
                      member.role !== "owner" &&
                      (owner || member.role !== "admin") &&
                      member.id !== userId && (
                        <TeamRoleEditor
                          key={`${member.id}:${member.role}`}
                          username={member.username}
                          role={member.role}
                          allowAdmin={owner}
                          focusRequested={roleFocus === member.id}
                          disabled={!!busy}
                          onSave={(role) =>
                            void action(
                              `role-${member.id}`,
                              {
                                action: "set-role",
                                workspaceId: activeId,
                                userId: member.id,
                                role,
                                expectedRole: member.role,
                              },
                              "Team role updated",
                              () => setRoleFocus(member.id),
                            )
                          }
                        />
                      )}
                    {owner && member.role !== "owner" && (
                      <button
                        className="account-button"
                        type="button"
                        disabled={!!busy}
                        data-tour="ownership-transfer"
                        onClick={() =>
                          setConfirm({
                            action: "transfer",
                            title: `Transfer ownership to ${member.username}?`,
                            description:
                              "They will become the owner of this team workspace. You will remain an admin. Only the new owner can transfer ownership again.",
                            workspaceId: activeId,
                            userId: member.id,
                            expectedOwnerId: userId,
                          })
                        }
                      >
                        Make owner
                      </button>
                    )}
                    {manager &&
                      member.role !== "owner" &&
                      (owner || member.role !== "admin") &&
                      member.id !== userId && (
                        <button
                          type="button"
                          className="account-button account-subtle"
                          disabled={!!busy}
                          onClick={() =>
                            setConfirm({
                              action: "remove",
                              title: "Remove " + member.username + "?",
                              description:
                                "They will lose access to this team workspace. Existing shared work stays in the workspace.",
                              workspaceId: activeId,
                              userId: member.id,
                            })
                          }
                        >
                          Remove
                        </button>
                      )}
                  </li>
                ))}
              </ul>
              {manager && (
                <>
                  <div className="account-invite-area">
                    <h3>Invite a teammate</h3>
                    <p>
                      They need a ProjectAnvil account. They&apos;ll see the
                      invitation in Teams &amp; workspaces.
                    </p>
                    <form onSubmit={invite}>
                      <label className="account-field">
                        <span>Username</span>
                        <input
                          name="inviteUsername"
                          value={inviteName}
                          onChange={(event) =>
                            setInviteName(event.target.value)
                          }
                          autoComplete="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          required
                          minLength={3}
                          maxLength={30}
                          pattern="[A-Za-z0-9_.]{3,30}"
                          placeholder="Teammate’s username"
                          disabled={!!busy}
                        />
                      </label>
                      <label className="account-field">
                        <span>Invitation role</span>
                        <select
                          className="field"
                          value={effectiveInviteRole}
                          disabled={!!busy}
                          onChange={(event) =>
                            setInviteRole(
                              event.target.value as
                                | "admin"
                                | "editor"
                                | "viewer",
                            )
                          }
                        >
                          <option value="viewer">Viewer</option>
                          <option value="editor">Editor</option>
                          {owner && <option value="admin">Admin</option>}
                        </select>
                      </label>
                      <button
                        className="account-button account-primary"
                        type="submit"
                        disabled={!!busy || !inviteName.trim()}
                      >
                        <Busy busy={busy === "invite"}>Send invitation</Busy>
                      </button>
                    </form>
                  </div>
                  {details.invitations.length > 0 && (
                    <div className="account-pending">
                      <h3>Pending invitations</h3>
                      {details.invitations.map((invitation) => (
                        <div
                          className="account-pending-row"
                          key={invitation.id}
                        >
                          <span>
                            <strong>{invitation.username}</strong>
                            <small>
                              {invitation.role || "editor"} · Waiting for
                              acceptance
                            </small>
                          </span>
                          <button
                            type="button"
                            className="account-button account-subtle"
                            disabled={!!busy}
                            onClick={() =>
                              setConfirm({
                                action: "cancel",
                                title: "Cancel this invitation?",
                                description:
                                  invitation.username +
                                  " will no longer be able to accept this invitation.",
                                workspaceId: activeId,
                                invitationId: invitation.id,
                              })
                            }
                          >
                            Cancel invitation
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              {!owner && (
                <div className="account-leave-area">
                  <p>
                    Leave this team to remove your access. Shared work stays
                    with the team.
                  </p>
                  <button
                    className="account-button account-danger"
                    type="button"
                    disabled={!!busy}
                    onClick={() =>
                      setConfirm({
                        action: "leave",
                        title: "Leave " + active.name + "?",
                        description:
                          "You will lose access to this team workspace. An owner can invite you again later.",
                        workspaceId: activeId,
                      })
                    }
                  >
                    Leave team
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}
      {confirm && (
        <AccountDialog
          labelId={confirmId}
          busy={!!busy}
          title={confirm.title}
          onClose={closeConfirm}
        >
          <p className="account-confirm-description">{confirm.description}</p>
          {error && (
            <p role="alert" className="account-error">
              {error}
            </p>
          )}
          <div className="account-confirm-actions">
            <button
              type="button"
              className="account-button"
              onClick={closeConfirm}
              disabled={!!busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="account-button account-danger"
              disabled={!!busy}
              onClick={() =>
                action(
                  "confirm",
                  {
                    action: confirm.action,
                    workspaceId: confirm.workspaceId,
                    ...(confirm.userId ? { userId: confirm.userId } : {}),
                    ...(confirm.invitationId
                      ? { invitationId: confirm.invitationId }
                      : {}),
                    ...(confirm.expectedOwnerId
                      ? { expectedOwnerId: confirm.expectedOwnerId }
                      : {}),
                  },
                  confirm.action === "leave"
                    ? "You left the team"
                    : confirm.action === "remove"
                      ? "Team member removed"
                      : confirm.action === "transfer"
                        ? "Workspace ownership transferred"
                        : "Invitation cancelled",
                  confirm.action === "leave"
                    ? (next) => {
                        const fallback = next.workspaces.find(
                          (workspace) => workspace.kind === "personal",
                        );
                        if (fallback) return onSwitch(fallback.id);
                      }
                    : undefined,
                )
              }
            >
              <Busy busy={busy === "confirm"}>
                {confirm.action === "leave"
                  ? "Leave team"
                  : confirm.action === "remove"
                    ? "Remove member"
                    : confirm.action === "transfer"
                      ? "Transfer ownership"
                      : "Cancel invitation"}
              </Busy>
            </button>
          </div>
        </AccountDialog>
      )}
    </section>
  );
}
