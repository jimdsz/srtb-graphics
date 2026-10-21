-- Assignment is not a project-sharing permission. Existing private drafts stay
-- in their personal ledger, including historic parallel copies.
CREATE TABLE planner_assignments (
 plan_id TEXT NOT NULL REFERENCES planner_documents(id),task_key TEXT NOT NULL,
 owner TEXT NOT NULL REFERENCES members(email),revision INTEGER NOT NULL DEFAULT 1,
 updated_by TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(plan_id,task_key)
);
CREATE TRIGGER planner_assignment_guard BEFORE INSERT ON planner_assignments
 WHEN NOT EXISTS(SELECT 1 FROM planner_documents WHERE id=NEW.plan_id AND kind='plan' AND archived=0)
 OR NOT EXISTS(SELECT 1 FROM members m JOIN channel_members cm ON cm.email=m.email JOIN planner_documents p ON p.channel_id=cm.channel_id WHERE p.id=NEW.plan_id AND m.email=NEW.owner AND m.active=1)
 BEGIN SELECT RAISE(ABORT,'planner_assignment_invalid'); END;
CREATE TRIGGER planner_team_task_guard BEFORE INSERT ON planner_personal_tasks
 WHEN EXISTS(SELECT 1 FROM planner_assignments a WHERE a.plan_id=NEW.plan_id
 AND (NEW.task_key=a.task_key OR substr(NEW.task_key,1,length(a.task_key)+2)=a.task_key||':r')
 AND a.owner<>NEW.actor)
 BEGIN SELECT RAISE(ABORT,'planner_assignment_conflict'); END;
CREATE TRIGGER planner_assignment_update_guard BEFORE UPDATE ON planner_assignments
 WHEN NOT EXISTS(SELECT 1 FROM planner_documents WHERE id=NEW.plan_id AND kind='plan' AND archived=0)
 OR NOT EXISTS(SELECT 1 FROM members m JOIN channel_members cm ON cm.email=m.email JOIN planner_documents p ON p.channel_id=cm.channel_id WHERE p.id=NEW.plan_id AND m.email=NEW.owner AND m.active=1)
 BEGIN SELECT RAISE(ABORT,'planner_assignment_invalid'); END;
