import type { Entity, Workspace } from "./types";

export interface TrashEntry {
  id: string;
  entity: Entity;
  entityId: string;
  title: string;
  deletedAt: string;
  restorable: boolean;
  unavailableReason?: string;
}

export interface TrashPage {
  entries: TrashEntry[];
  nextCursor: string | null;
}

export interface WorkspaceMutationResult {
  workspace: Workspace;
  warnings: string[];
}

export interface TrashRecord {
  entity: Entity;
  item: Record<string, unknown> & { id: string };
}

export interface TrashSnapshot {
  version: 1;
  primary: TrashRecord;
  removed: TrashRecord[];
  changed: {
    entity: Entity;
    id: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }[];
}

export interface TrashWrite {
  id: string;
  entity: Entity;
  entityId: string;
  title: string;
  snapshot: TrashSnapshot;
}

export interface TrashRestore {
  id: string;
  deletedAt: string;
  restored: { entity: Entity; id: string }[];
  warnings: string[];
}

export interface TrashCommit {
  deleted?: TrashWrite;
  restore?: TrashRestore;
}
