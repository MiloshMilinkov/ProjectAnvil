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
