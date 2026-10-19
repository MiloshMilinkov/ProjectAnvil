export interface AccountUser { id: string; username: string; name: string; email: string }
export interface WorkspaceAccess { id: string; name: string; kind: 'guest' | 'personal' | 'team'; role: 'owner' | 'member' }
export interface TeamInvitation { id: string; workspaceId: string; workspaceName: string; invitedBy: string }
export interface AccountContext { user: AccountUser | null; workspaces: WorkspaceAccess[]; invitations: TeamInvitation[] }
