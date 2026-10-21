-- Additive: existing projects, media and diffusion remain untouched.
CREATE TABLE planner_documents (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('plan','directory','rule')),
 name TEXT NOT NULL,
 data_json TEXT NOT NULL CHECK(json_valid(data_json)),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
 created_by TEXT NOT NULL REFERENCES members(email),
 updated_by TEXT NOT NULL REFERENCES members(email),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX planner_listing ON planner_documents(kind,archived,updated_at DESC,id);
CREATE TABLE planner_revisions (
 document_id TEXT NOT NULL REFERENCES planner_documents(id),
 revision INTEGER NOT NULL, data_json TEXT NOT NULL, archived INTEGER NOT NULL,
 actor TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(document_id,revision)
);
CREATE TRIGGER planner_created AFTER INSERT ON planner_documents BEGIN
 INSERT INTO planner_revisions VALUES(NEW.id,NEW.revision,NEW.data_json,NEW.archived,NEW.updated_by,NEW.updated_at);
 INSERT INTO activity(actor,action,target,detail) VALUES(NEW.updated_by,'planner.created',NEW.id,NEW.kind);
END;
CREATE TRIGGER planner_updated AFTER UPDATE ON planner_documents BEGIN
 INSERT INTO planner_revisions VALUES(NEW.id,NEW.revision,NEW.data_json,NEW.archived,NEW.updated_by,NEW.updated_at);
 INSERT INTO activity(actor,action,target,detail) VALUES(NEW.updated_by,'planner.saved',NEW.id,NEW.kind || ' / r' || NEW.revision);
END;
CREATE TABLE planner_tasks (
 plan_id TEXT NOT NULL REFERENCES planner_documents(id),
 task_key TEXT NOT NULL,
 project_id TEXT NOT NULL UNIQUE REFERENCES projects(id),
 source_revision INTEGER NOT NULL,
 actor TEXT NOT NULL REFERENCES members(email),
 PRIMARY KEY(plan_id,task_key)
);
CREATE TRIGGER planner_task_guard BEFORE INSERT ON planner_tasks
WHEN NOT EXISTS(SELECT 1 FROM planner_documents WHERE id=NEW.plan_id AND kind='plan' AND archived=0 AND revision=NEW.source_revision)
 OR NOT EXISTS(SELECT 1 FROM members WHERE email=NEW.actor AND active=1)
 OR (SELECT COUNT(*) FROM planner_tasks WHERE plan_id=NEW.plan_id)>=2000
BEGIN SELECT RAISE(ABORT,'planner_changed'); END;
