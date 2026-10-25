CREATE TABLE IF NOT EXISTS workspace_activity (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  action TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS workspace_activity_page_idx ON workspace_activity(workspace_id,seq DESC);
CREATE INDEX IF NOT EXISTS workspace_activity_entity_idx ON workspace_activity(workspace_id,entity_type,entity_id,seq DESC);
CREATE TABLE IF NOT EXISTS workspace_watchers (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('note','task','project')),
  entity_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id,user_id,entity_type,entity_id)
);
CREATE INDEX IF NOT EXISTS workspace_watchers_entity_idx ON workspace_watchers(workspace_id,entity_type,entity_id);
CREATE TABLE IF NOT EXISTS workspace_notifications (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  activity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(reason IN ('mention','watch')),
  created_at TEXT NOT NULL,
  last_notified_at TEXT NOT NULL,
  read_at TEXT,
  UNIQUE(workspace_id,user_id,entity_type,entity_id,reason)
);
CREATE INDEX IF NOT EXISTS workspace_notifications_page_idx ON workspace_notifications(workspace_id,user_id,created_at DESC,id DESC);
