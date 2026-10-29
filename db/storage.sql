-- Durable deletion claims keep file cleanup safe across database/bucket failures.
-- A claimed identifier cannot be imported or restored as a live attachment.
CREATE TABLE IF NOT EXISTS storage_media_purges (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  media_id text NOT NULL,
  object_key text NOT NULL,
  claimed_at text NOT NULL,
  deleted_at text,
  PRIMARY KEY (workspace_id, media_id)
);
