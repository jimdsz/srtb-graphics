-- Independent of membership: recovery never grants application access.
CREATE TABLE recovery_barriers (
 email TEXT PRIMARY KEY COLLATE NOCASE,
 operation TEXT NOT NULL,
 blocked_until INTEGER NOT NULL,
 changed_at INTEGER NOT NULL
);
