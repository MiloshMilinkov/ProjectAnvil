import type { Entity, EntityRef } from "./types";

export type ActivityAction =
  | "created"
  | "updated"
  | "deleted"
  | "restored"
  | "renamed"
  | "imported"
  | "reviewed"
  | "voted"
  | "access-changed";
export interface ActivityEntry {
  id: string;
  sequence: number;
  actor: string;
  entity: Entity | "workspace";
  entityId: string;
  projectId: string;
  title: string;
  action: ActivityAction;
  fields: string[];
  createdAt: string;
  revision: number;
  reference?: EntityRef;
}
export interface ActivityPage {
  entries: ActivityEntry[];
  nextCursor: string | null;
}
export interface WorkspaceNotification {
  id: string;
  reason: "mention" | "watch";
  read: boolean;
  createdAt: string;
  activity: ActivityEntry;
}
export interface NotificationPage {
  entries: WorkspaceNotification[];
  nextCursor: string | null;
  unreadCount: number;
  available: boolean;
}
export interface WatchState {
  watching: boolean;
  available: boolean;
}
