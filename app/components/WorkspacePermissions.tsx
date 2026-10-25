"use client";

import type { EntityRef, Workspace } from "../lib/types";
import { useWorkspaceScope } from "./WorkspaceScope";

/** Interface permissions mirror server checks; the server remains authoritative. */
export function useWorkspacePermissions(workspace?: Workspace) {
  const { account, activeId } = useWorkspaceScope();
  const access = account.workspaces.find((item) => item.id === activeId);
  const role = access?.role || "viewer";
  const canManage = role === "owner" || role === "admin";
  const canCreate = canManage || role === "editor";
  function canEditProject(projectId: string): boolean {
    if (!canCreate) return false;
    if (
      projectId &&
      projectId !== "all" &&
      workspace &&
      !workspace.projects.some((project) => project.id === projectId)
    )
      return false;
    if (canManage || !projectId || projectId === "all") return true;
    return access?.projectRoles?.[projectId] !== "viewer";
  }
  function canEditRef(reference: EntityRef): boolean {
    if (reference.type === "project") return canEditProject(reference.id);
    const item =
      reference.type === "note"
        ? workspace?.notes.find((note) => note.id === reference.id)
        : workspace?.tasks.find((task) => task.id === reference.id);
    return !!item && canEditProject(item.projectId);
  }
  return { role, canCreate, canManage, canEditProject, canEditRef };
}
