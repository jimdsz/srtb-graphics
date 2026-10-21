-- Existing and future projects become private; authors and privileged roles retain access.
ALTER TABLE projects ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','team'));
CREATE INDEX projects_owner_listing ON projects(created_by,archived,updated_at DESC,id);
-- Keep the previous planner ledger intact. New production is per operator.
CREATE TABLE planner_personal_tasks (
 plan_id TEXT NOT NULL REFERENCES planner_documents(id),
 task_key TEXT NOT NULL,
 project_id TEXT NOT NULL UNIQUE REFERENCES projects(id),
 source_revision INTEGER NOT NULL,
 actor TEXT NOT NULL REFERENCES members(email),
 PRIMARY KEY(plan_id,task_key,actor)
);
INSERT INTO planner_personal_tasks SELECT plan_id,task_key,project_id,source_revision,actor FROM planner_tasks;
CREATE TRIGGER planner_personal_task_guard BEFORE INSERT ON planner_personal_tasks
WHEN NOT EXISTS(SELECT 1 FROM planner_documents WHERE id=NEW.plan_id AND kind='plan' AND archived=0 AND revision=NEW.source_revision)
 OR NOT EXISTS(SELECT 1 FROM members WHERE email=NEW.actor AND active=1)
 OR (SELECT COUNT(*) FROM planner_personal_tasks WHERE plan_id=NEW.plan_id AND actor=NEW.actor)>=2000
BEGIN SELECT RAISE(ABORT,'planner_changed'); END;
