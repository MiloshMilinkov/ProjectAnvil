-- All tables are additive. Existing workspace and attachment data stays intact.
CREATE TABLE IF NOT EXISTS workspace_write_guards (
  workspace_id text PRIMARY KEY NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token text NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_receipts (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_key text NOT NULL,
  operation_id text NOT NULL,
  payload_hash text NOT NULL,
  created_at text NOT NULL,
  PRIMARY KEY (workspace_id, actor_key, operation_id)
);
CREATE INDEX IF NOT EXISTS workspace_receipts_created_idx ON workspace_receipts(created_at);
CREATE TABLE IF NOT EXISTS entity_tombstones (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity text NOT NULL,
  entity_id text NOT NULL,
  deleted_at text NOT NULL,
  PRIMARY KEY (workspace_id, entity, entity_id)
);
CREATE TABLE IF NOT EXISTS note_history (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  note_id text NOT NULL,
  snapshot_id text NOT NULL,
  content text NOT NULL,
  saved_at text NOT NULL,
  PRIMARY KEY (workspace_id, note_id, snapshot_id)
);
CREATE INDEX IF NOT EXISTS note_history_page_idx ON note_history(workspace_id, note_id, saved_at DESC, snapshot_id DESC);
CREATE TABLE IF NOT EXISTS media_objects (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  media_id text NOT NULL,
  object_key text NOT NULL,
  state text NOT NULL CHECK(state IN ('uploading', 'active', 'retained')),
  created_at text NOT NULL,
  unreferenced_at text,
  PRIMARY KEY (workspace_id, media_id)
);
