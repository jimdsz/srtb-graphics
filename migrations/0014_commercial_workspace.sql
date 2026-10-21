-- Additive separation: retain existing member identities and all Graphics rows.
-- The commercial role is represented by tool_scope so the existing role CHECK
-- and the many foreign keys/triggers on members do not require a table rebuild.
ALTER TABLE members ADD COLUMN tool_scope TEXT NOT NULL DEFAULT 'graphics' CHECK(tool_scope IN ('graphics','commercial'));
ALTER TABLE media ADD COLUMN tool_scope TEXT NOT NULL DEFAULT 'graphics' CHECK(tool_scope IN ('graphics','commercial'));
CREATE INDEX media_tool_owner ON media(tool_scope,created_by,status,created_at DESC);
CREATE TRIGGER member_commercial_role_insert BEFORE INSERT ON members
 WHEN NEW.tool_scope='commercial' AND NEW.role<>'designer'
 BEGIN SELECT RAISE(ABORT,'invalid_commercial_role'); END;
CREATE TRIGGER member_commercial_role_update BEFORE UPDATE ON members
 WHEN NEW.tool_scope='commercial' AND NEW.role<>'designer'
 BEGIN SELECT RAISE(ABORT,'invalid_commercial_role'); END;
DROP TRIGGER member_default_channel;
CREATE TRIGGER member_default_channel AFTER INSERT ON members WHEN NEW.tool_scope='graphics' BEGIN
 INSERT OR IGNORE INTO channel_members VALUES('benin-tv',NEW.email);
END;
CREATE TRIGGER member_tool_scope_changed AFTER UPDATE OF tool_scope ON members WHEN OLD.tool_scope<>NEW.tool_scope BEGIN
 DELETE FROM app_sessions WHERE email=NEW.email;
 DELETE FROM channel_members WHERE email=NEW.email AND NEW.tool_scope='commercial';
 INSERT OR IGNORE INTO channel_members SELECT 'benin-tv',NEW.email WHERE NEW.tool_scope='graphics';
END;
CREATE TRIGGER media_tool_scope_immutable BEFORE UPDATE OF tool_scope ON media WHEN OLD.tool_scope<>NEW.tool_scope
 BEGIN SELECT RAISE(ABORT,'media_scope_immutable'); END;

CREATE TABLE commercial_projects (
 id TEXT PRIMARY KEY,
 title TEXT NOT NULL,
 template_id TEXT NOT NULL DEFAULT 'COMMUNIQUES_ORIGINAL_AMELIORE',
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 data_json TEXT NOT NULL CHECK(json_valid(data_json)),
 created_by TEXT NOT NULL REFERENCES members(email),
 updated_by TEXT NOT NULL REFERENCES members(email),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1))
);
CREATE INDEX commercial_projects_owner ON commercial_projects(created_by,archived,updated_at DESC);
CREATE TABLE commercial_revisions (
 project_id TEXT NOT NULL REFERENCES commercial_projects(id),
 revision INTEGER NOT NULL,
 title TEXT NOT NULL,
 data_json TEXT NOT NULL CHECK(json_valid(data_json)),
 archived INTEGER NOT NULL,
 actor TEXT NOT NULL REFERENCES members(email),
 created_at TEXT NOT NULL,
 PRIMARY KEY(project_id,revision)
);
CREATE TRIGGER commercial_project_created AFTER INSERT ON commercial_projects BEGIN
 INSERT INTO commercial_revisions VALUES(NEW.id,NEW.revision,NEW.title,NEW.data_json,NEW.archived,NEW.updated_by,NEW.updated_at);
 INSERT INTO activity(actor,action,target,detail) VALUES(NEW.updated_by,'commercial.created',NEW.id,NEW.title);
END;
CREATE TRIGGER commercial_project_updated AFTER UPDATE ON commercial_projects BEGIN
 INSERT INTO commercial_revisions VALUES(NEW.id,NEW.revision,NEW.title,NEW.data_json,NEW.archived,NEW.updated_by,NEW.updated_at);
 INSERT INTO activity(actor,action,target,detail) VALUES(NEW.updated_by,CASE WHEN OLD.archived<>NEW.archived THEN 'commercial.archive' ELSE 'commercial.saved' END,NEW.id,'r'||NEW.revision);
END;
CREATE TRIGGER commercial_project_owner_immutable BEFORE UPDATE OF created_by ON commercial_projects WHEN OLD.created_by<>NEW.created_by
 BEGIN SELECT RAISE(ABORT,'commercial_owner_immutable'); END;
CREATE TRIGGER purge_clock_commercial_projects_insert AFTER INSERT ON commercial_projects WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_commercial_projects_update AFTER UPDATE ON commercial_projects WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_commercial_projects_delete AFTER DELETE ON commercial_projects WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_commercial_revisions_insert AFTER INSERT ON commercial_revisions WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_commercial_revisions_update AFTER UPDATE ON commercial_revisions WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_commercial_revisions_delete AFTER DELETE ON commercial_revisions WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
