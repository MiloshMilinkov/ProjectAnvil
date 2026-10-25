CREATE TABLE IF NOT EXISTS `workspace_access` (
  `id` text PRIMARY KEY NOT NULL REFERENCES `workspaces` (`id`) ON DELETE CASCADE,
  `kind` text NOT NULL CHECK (`kind` IN ('personal', 'team')),
  `owner_user_id` text NOT NULL REFERENCES `user` (`id`) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS `appmembers` (
  `workspace_id` text NOT NULL REFERENCES `workspace_access` (`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `user` (`id`) ON DELETE CASCADE,
  `role` text NOT NULL CHECK (`role` IN ('owner', 'member')),
  PRIMARY KEY (`workspace_id`, `user_id`)
);
CREATE INDEX IF NOT EXISTS `appmembers_user_idx` ON `appmembers` (`user_id`);
CREATE TABLE IF NOT EXISTS `appinvites` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL REFERENCES `workspace_access` (`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `user` (`id`) ON DELETE CASCADE,
  `invited_by` text NOT NULL REFERENCES `user` (`id`) ON DELETE CASCADE,
  `created_at` text NOT NULL,
  UNIQUE (`workspace_id`, `user_id`)
);
CREATE INDEX IF NOT EXISTS `appinvites_user_idx` ON `appinvites` (`user_id`);

-- Preserve the original membership CHECK constraint and its existing records.
-- Effective non-owner roles live here; an older member defaults to editor.
CREATE TABLE IF NOT EXISTS `appmember_roles` (
  `workspace_id` text NOT NULL,
  `user_id` text NOT NULL,
  `role` text NOT NULL CHECK (`role` IN ('admin', 'editor', 'viewer')),
  PRIMARY KEY (`workspace_id`, `user_id`),
  FOREIGN KEY (`workspace_id`, `user_id`) REFERENCES `appmembers` (`workspace_id`, `user_id`) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS `appinvite_roles` (
  `invitation_id` text PRIMARY KEY NOT NULL REFERENCES `appinvites` (`id`) ON DELETE CASCADE,
  `role` text NOT NULL CHECK (`role` IN ('admin', 'editor', 'viewer'))
);
CREATE TABLE IF NOT EXISTS `workspace_security` (
  `workspace_id` text PRIMARY KEY NOT NULL REFERENCES `workspaces` (`id`) ON DELETE CASCADE,
  `revision` integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS `workspace_security_guards` (
  `workspace_id` text PRIMARY KEY NOT NULL REFERENCES `workspaces` (`id`) ON DELETE CASCADE,
  `token` text NOT NULL
);
CREATE TABLE IF NOT EXISTS `project_permissions` (
  `workspace_id` text NOT NULL REFERENCES `workspaces` (`id`) ON DELETE CASCADE,
  `project_id` text NOT NULL,
  `restricted` integer NOT NULL DEFAULT 0 CHECK (`restricted` IN (0, 1)),
  PRIMARY KEY (`workspace_id`, `project_id`)
);
CREATE TABLE IF NOT EXISTS `project_members` (
  `workspace_id` text NOT NULL,
  `project_id` text NOT NULL,
  `user_id` text NOT NULL,
  `role` text NOT NULL CHECK (`role` IN ('editor', 'viewer')),
  PRIMARY KEY (`workspace_id`, `project_id`, `user_id`),
  FOREIGN KEY (`workspace_id`, `project_id`) REFERENCES `project_permissions` (`workspace_id`, `project_id`) ON DELETE CASCADE,
  FOREIGN KEY (`workspace_id`, `user_id`) REFERENCES `appmembers` (`workspace_id`, `user_id`) ON DELETE CASCADE
);
