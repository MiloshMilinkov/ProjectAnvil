-- Physical bytes and in-flight reservations are independent of editable media metadata.
CREATE TABLE IF NOT EXISTS upload_storage_inventory (
  workspace_id text PRIMARY KEY NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token text NOT NULL,
  ready integer NOT NULL DEFAULT 0 CHECK(ready IN (0, 1)),
  started_at integer NOT NULL
);
CREATE TABLE IF NOT EXISTS upload_storage_objects (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  object_key text NOT NULL,
  bytes integer NOT NULL CHECK(bytes >= 0),
  PRIMARY KEY (workspace_id, object_key)
);
CREATE TABLE IF NOT EXISTS upload_rate_limits (
  bucket_key text PRIMARY KEY NOT NULL,
  count integer NOT NULL CHECK(count > 0),
  started_at integer NOT NULL
);
