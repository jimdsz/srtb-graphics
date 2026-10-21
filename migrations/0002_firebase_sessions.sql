ALTER TABLE members ADD COLUMN firebase_uid TEXT;
CREATE UNIQUE INDEX members_firebase_uid ON members(firebase_uid) WHERE firebase_uid IS NOT NULL;
CREATE TABLE app_sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL REFERENCES members(email),
  firebase_uid TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX app_sessions_expiry ON app_sessions(expires_at);
CREATE TABLE login_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
