"use client";

import { useEffect, useRef, useState } from "react";
import { LockKeyhole, RefreshCw } from "lucide-react";
import type { AccountContext, WorkspaceAccess } from "../lib/access-types";
import type { Notify } from "../lib/types";
import { useWorkspaceFetch, useWorkspaceScope } from "./WorkspaceScope";
import { useWorkspacePermissions } from "./WorkspacePermissions";
import "./teamwork.css";

type Member = { id: string; username: string; role: WorkspaceAccess["role"] };
type Policy = {
  projectId: string;
  restricted: boolean;
  members: { userId: string; role: "viewer" | "editor" }[];
};
type Details = {
  members: Member[];
  projectPermissions: Policy[];
  securityRevision: number;
};

export default function ProjectAccessPanel({
  projectId,
  notify,
}: {
  projectId: string;
  notify: Notify;
}) {
  const { account, activeId, onChanged } = useWorkspaceScope();
  const permissions = useWorkspacePermissions();
  const fetchWorkspace = useWorkspaceFetch();
  const isTeam =
    account.workspaces.find((item) => item.id === activeId)?.kind === "team";
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<Details | null>(null);
  const [restricted, setRestricted] = useState(false);
  const [roles, setRoles] = useState<
    Record<string, "viewer" | "editor" | "none">
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const pending = useRef(false);
  const saveButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open || !isTeam || !permissions.canManage) return;
    const controller = new AbortController();
    void (async () => {
      setError("");
      try {
        const response = await fetchWorkspace(
          `/api/teams?workspaceId=${encodeURIComponent(activeId)}`,
          { signal: controller.signal, cache: "no-store" },
        );
        const result = (await response.json()) as Details & { error?: string };
        if (!response.ok)
          throw new Error(
            result.error || "Project access could not be loaded.",
          );
        if (controller.signal.aborted) return;
        const policy = result.projectPermissions.find(
          (item) => item.projectId === projectId,
        );
        setDetails(result);
        setRestricted(policy?.restricted || false);
        setRoles(
          Object.fromEntries(
            (policy?.members || []).map((member) => [
              member.userId,
              member.role,
            ]),
          ),
        );
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Project access could not be loaded.",
          );
      }
    })();
    return () => controller.abort();
  }, [
    open,
    isTeam,
    permissions.canManage,
    activeId,
    projectId,
    refresh,
    fetchWorkspace,
  ]);
  async function save() {
    if (pending.current || !details) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetchWorkspace("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "project-access",
          workspaceId: activeId,
          projectId,
          restricted,
          members: restricted
            ? Object.entries(roles)
                .filter(([, role]) => role !== "none")
                .map(([userId, role]) => ({ userId, role }))
            : [],
          expectedRevision: details.securityRevision,
        }),
      });
      const result = (await response.json()) as AccountContext & {
        account?: AccountContext;
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error || "Project access could not be saved.");
      onChanged(result.account || result);
      setRefresh((value) => value + 1);
      notify("Project access updated");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Project access could not be saved. Your choices remain available.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
      requestAnimationFrame(() => saveButton.current?.focus());
    }
  }
  if (!isTeam) return null;
  if (!permissions.canManage)
    return (
      <aside className="team-permissions" data-tour="project-permissions">
        <p>
          <strong>Your project access:</strong>{" "}
          {permissions.canEditProject(projectId) ? "Editor" : "Viewer"}. Contact
          an owner or admin to change access.
        </p>
      </aside>
    );
  return (
    <details
      className="team-permissions"
      data-tour="project-permissions"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <LockKeyhole size={18} />
        Project access
      </summary>
      <div className="team-permissions-body">
        <p>
          Owners and admins can always manage this project. Project roles can
          reduce access; a workspace Viewer stays read-only.
        </p>
        {!details && !error && <p role="status">Loading project access…</p>}
        {details && (
          <>
            <label className="form-label">
              Visibility
              <select
                className="field"
                value={restricted ? "restricted" : "team"}
                disabled={busy}
                onChange={(event) =>
                  setRestricted(event.target.value === "restricted")
                }
              >
                <option value="team">Shared with the team</option>
                <option value="restricted">Only selected members</option>
              </select>
            </label>
            {restricted &&
              details.members
                .filter((member) => !["owner", "admin"].includes(member.role))
                .map((member) => (
                  <div className="team-permission-member" key={member.id}>
                    <label htmlFor={`project-role-${member.id}`}>
                      {member.username}
                      <small className="muted">
                        {" "}
                        · Workspace {member.role}
                      </small>
                    </label>
                    <select
                      id={`project-role-${member.id}`}
                      className="field"
                      value={roles[member.id] || "none"}
                      disabled={busy}
                      onChange={(event) =>
                        setRoles((previous) => ({
                          ...previous,
                          [member.id]: event.target.value as
                            | "viewer"
                            | "editor"
                            | "none",
                        }))
                      }
                    >
                      <option value="none">No access</option>
                      <option value="viewer">Viewer</option>
                      <option
                        value="editor"
                        disabled={member.role === "viewer"}
                      >
                        Editor
                      </option>
                    </select>
                  </div>
                ))}
          </>
        )}
        {error && (
          <p role="alert" className="account-error">
            {error}
          </p>
        )}
        <div className="team-permissions-actions">
          <button
            className="btn"
            disabled={busy}
            onClick={() => {
              setDetails(null);
              setRefresh((value) => value + 1);
            }}
          >
            <RefreshCw size={16} />
            Load saved access
          </button>
          <button
            className="btn btn-primary"
            ref={saveButton}
            disabled={busy || !details}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Save project access"}
          </button>
        </div>
      </div>
    </details>
  );
}
