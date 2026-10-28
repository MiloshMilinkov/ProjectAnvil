export interface AccountUser {
  id: string;
  username: string;
  name: string;
  email: string;
  emailVerified?: boolean;
}
export interface AccountPolicy {
  mode: "local" | "online";
  registration: "open" | "invite-only";
  emailDelivery: "local" | "external" | "disabled";
  verificationRequired: boolean;
}
export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";
export type ProjectRole = "editor" | "viewer";
export interface ProjectPermission {
  projectId: string;
  restricted: boolean;
  members: { userId: string; role: ProjectRole }[];
}
export interface WorkspaceAccess {
  id: string;
  name: string;
  kind: "guest" | "personal" | "team";
  role: WorkspaceRole;
  ownerId?: string;
  securityRevision?: number;
  projectRoles?: Record<string, ProjectRole>;
}
export interface TeamInvitation {
  id: string;
  workspaceId: string;
  workspaceName: string;
  invitedBy: string;
  role?: Exclude<WorkspaceRole, "owner">;
}
export interface AccountContext {
  user: AccountUser | null;
  workspaces: WorkspaceAccess[];
  invitations: TeamInvitation[];
  policy?: AccountPolicy;
}
