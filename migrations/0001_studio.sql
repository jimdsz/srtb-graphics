PRAGMA foreign_keys = ON;
CREATE TABLE members (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','designer','broadcaster')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO members(email,name,role,updated_by)
VALUES('admin@example.com','Jimmy de Souza','admin','initialisation autorisée');
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  template_id TEXT NOT NULL,
  template_version TEXT NOT NULL,
  library_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','rejected')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  data_json TEXT NOT NULL CHECK(json_valid(data_json)),
  created_by TEXT NOT NULL REFERENCES members(email),
  updated_by TEXT NOT NULL REFERENCES members(email),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1))
);
CREATE INDEX projects_updated ON projects(archived,updated_at DESC);
CREATE TABLE revisions (
  project_id TEXT NOT NULL REFERENCES projects(id),
  revision INTEGER NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK(json_valid(data_json)),
  actor TEXT NOT NULL REFERENCES members(email),
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id,revision)
);
CREATE TABLE activity (
  id INTEGER PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX activity_created ON activity(id DESC);
CREATE TRIGGER project_created AFTER INSERT ON projects BEGIN
  INSERT INTO revisions VALUES(NEW.id,NEW.revision,NEW.title,NEW.status,NEW.data_json,NEW.updated_by,NEW.updated_at);
  INSERT INTO activity(actor,action,target,detail) VALUES(NEW.updated_by,'project.created',NEW.id,NEW.title);
END;
CREATE TRIGGER project_updated AFTER UPDATE ON projects BEGIN
  INSERT INTO revisions VALUES(NEW.id,NEW.revision,NEW.title,NEW.status,NEW.data_json,NEW.updated_by,NEW.updated_at);
  INSERT INTO activity(actor,action,target,detail) VALUES(NEW.updated_by,
    CASE WHEN OLD.archived <> NEW.archived THEN 'project.archive' WHEN OLD.status <> NEW.status THEN 'project.status' ELSE 'project.saved' END,
    NEW.id,NEW.status || ' / r' || NEW.revision);
END;
CREATE TRIGGER member_created AFTER INSERT ON members BEGIN
  INSERT INTO activity(actor,action,target,detail) VALUES(NEW.updated_by,'member.invited',NEW.email,NEW.role);
END;
CREATE TRIGGER member_updated AFTER UPDATE ON members BEGIN
  INSERT INTO activity(actor,action,target,detail) VALUES(NEW.updated_by,'member.updated',NEW.email,NEW.role || ' / active=' || NEW.active);
END;
CREATE TRIGGER preserve_last_admin BEFORE UPDATE ON members
WHEN OLD.role='admin' AND OLD.active=1 AND (NEW.role<>'admin' OR NEW.active=0)
AND (SELECT COUNT(*) FROM members WHERE role='admin' AND active=1)=1
BEGIN SELECT RAISE(ABORT,'last_admin'); END;
CREATE TABLE media (
  id TEXT PRIMARY KEY,
  object_key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK(bytes > 0 AND bytes <= 2147483648),
  status TEXT NOT NULL CHECK(status IN ('uploading','ready','failed')),
  upload_id TEXT,
  operation_token TEXT,
  operation_until INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES members(email),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE media_parts (
  media_id TEXT NOT NULL REFERENCES media(id),
  part_number INTEGER NOT NULL,
  etag TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  PRIMARY KEY(media_id,part_number)
);
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  revision INTEGER NOT NULL,
  author TEXT NOT NULL REFERENCES members(email),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
