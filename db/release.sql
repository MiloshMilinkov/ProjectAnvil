-- Local account recovery links stay private and expire; they are never served by an API.
CREATE TABLE IF NOT EXISTS account_mail_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('verification', 'reset')),
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS account_mail_outbox_expiry_idx ON account_mail_outbox(expires_at);
CREATE INDEX IF NOT EXISTS account_mail_outbox_email_idx ON account_mail_outbox(email);
