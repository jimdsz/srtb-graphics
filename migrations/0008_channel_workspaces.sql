CREATE TABLE channels (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, logo TEXT NOT NULL DEFAULT '',
 accent TEXT NOT NULL DEFAULT '#EFBD32', timezone TEXT NOT NULL DEFAULT 'Africa/Porto-Novo',
 revision INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0,
 created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO channels(id,name,created_by) VALUES('benin-tv','Bénin TV','migration');
CREATE TABLE channel_members (
 channel_id TEXT NOT NULL REFERENCES channels(id), email TEXT NOT NULL REFERENCES members(email) ON DELETE CASCADE,
 PRIMARY KEY(channel_id,email)
);
INSERT INTO channel_members SELECT 'benin-tv',email FROM members;
CREATE TRIGGER member_default_channel AFTER INSERT ON members BEGIN
 INSERT OR IGNORE INTO channel_members VALUES('benin-tv',NEW.email);
END;
-- SQLite cannot add a REFERENCES column with a non-null default on populated
-- tables. Additive scope columns preserve every legacy row; guards enforce the
-- channel relation without rebuilding tables or their revision triggers.
ALTER TABLE projects ADD COLUMN channel_id TEXT NOT NULL DEFAULT 'benin-tv';
ALTER TABLE media ADD COLUMN channel_id TEXT NOT NULL DEFAULT 'benin-tv';
ALTER TABLE preparation_profiles ADD COLUMN channel_id TEXT NOT NULL DEFAULT 'benin-tv';
ALTER TABLE planner_documents ADD COLUMN channel_id TEXT NOT NULL DEFAULT 'benin-tv';
CREATE TRIGGER project_channel_insert BEFORE INSERT ON projects WHEN NOT EXISTS(SELECT 1 FROM channels WHERE id=NEW.channel_id) BEGIN SELECT RAISE(ABORT,'unknown_channel'); END;
CREATE TRIGGER project_channel_update BEFORE UPDATE OF channel_id ON projects WHEN NEW.channel_id<>OLD.channel_id BEGIN SELECT RAISE(ABORT,'channel_immutable'); END;
CREATE TRIGGER media_channel_insert BEFORE INSERT ON media WHEN NOT EXISTS(SELECT 1 FROM channels WHERE id=NEW.channel_id) BEGIN SELECT RAISE(ABORT,'unknown_channel'); END;
CREATE TRIGGER media_channel_update BEFORE UPDATE OF channel_id ON media WHEN NEW.channel_id<>OLD.channel_id BEGIN SELECT RAISE(ABORT,'channel_immutable'); END;
CREATE TRIGGER profile_channel_insert BEFORE INSERT ON preparation_profiles WHEN NOT EXISTS(SELECT 1 FROM channels WHERE id=NEW.channel_id) BEGIN SELECT RAISE(ABORT,'unknown_channel'); END;
CREATE TRIGGER profile_channel_update BEFORE UPDATE OF channel_id ON preparation_profiles WHEN NEW.channel_id<>OLD.channel_id BEGIN SELECT RAISE(ABORT,'channel_immutable'); END;
CREATE TRIGGER planner_channel_insert BEFORE INSERT ON planner_documents WHEN NOT EXISTS(SELECT 1 FROM channels WHERE id=NEW.channel_id) BEGIN SELECT RAISE(ABORT,'unknown_channel'); END;
CREATE TRIGGER planner_channel_update BEFORE UPDATE OF channel_id ON planner_documents WHEN NEW.channel_id<>OLD.channel_id BEGIN SELECT RAISE(ABORT,'channel_immutable'); END;
CREATE INDEX projects_channel ON projects(channel_id,archived,updated_at DESC);
CREATE INDEX media_channel ON media(channel_id,status);
CREATE INDEX profiles_channel ON preparation_profiles(channel_id,kind,archived);
CREATE INDEX planner_channel ON planner_documents(channel_id,kind,archived);
CREATE TABLE programmes (
 id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channels(id),
 name TEXT NOT NULL, identity TEXT NOT NULL, data_json TEXT NOT NULL CHECK(json_valid(data_json)),
 revision INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0,
 updated_by TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(channel_id,identity)
);
CREATE TABLE programme_revisions (
 programme_id TEXT NOT NULL REFERENCES programmes(id),revision INTEGER NOT NULL,data_json TEXT NOT NULL,
 actor TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(programme_id,revision)
);
CREATE TRIGGER programme_created AFTER INSERT ON programmes BEGIN
 INSERT INTO programme_revisions VALUES(NEW.id,NEW.revision,NEW.data_json,NEW.updated_by,NEW.updated_at);
END;
CREATE TRIGGER programme_updated AFTER UPDATE ON programmes BEGIN
 INSERT INTO programme_revisions VALUES(NEW.id,NEW.revision,NEW.data_json,NEW.updated_by,NEW.updated_at);
END;
