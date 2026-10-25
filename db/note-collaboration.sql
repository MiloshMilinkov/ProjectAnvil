CREATE TABLE IF NOT EXISTS note_collaboration (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  note_id text NOT NULL,
  generation text NOT NULL,
  document_update text NOT NULL,
  content_hash text NOT NULL,
  updated_at text NOT NULL,
  PRIMARY KEY(workspace_id, note_id)
);
CREATE TABLE IF NOT EXISTS note_presence (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  note_id text NOT NULL,
  actor_id text NOT NULL,
  tab_id text NOT NULL,
  display_name text NOT NULL,
  seen_at text NOT NULL,
  PRIMARY KEY(workspace_id, note_id, actor_id, tab_id)
);
CREATE INDEX IF NOT EXISTS note_presence_seen_idx ON note_presence(workspace_id, note_id, seen_at);
CREATE INDEX IF NOT EXISTS note_presence_cleanup_idx ON note_presence(workspace_id, seen_at);
