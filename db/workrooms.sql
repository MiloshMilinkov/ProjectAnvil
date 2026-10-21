CREATE TABLE IF NOT EXISTS `workrooms` (
  `workspace_id` text NOT NULL REFERENCES `workspaces` (`id`) ON DELETE CASCADE,
  `user_key` text NOT NULL,
  `id` text NOT NULL,
  `data` text NOT NULL,
  `revision` integer NOT NULL DEFAULT 1,
  `updated_at` text NOT NULL,
  PRIMARY KEY (`workspace_id`, `user_key`, `id`)
);
