import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// A workspace is saved atomically, so edits to links and their target stay together.
export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  data: text('data').notNull(),
  revision: integer('revision').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
});
