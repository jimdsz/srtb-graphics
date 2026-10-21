-- Additive only: no existing account or content is deleted by migration.
-- The metadata deletion is atomic; durable external cleanup never blocks the
-- rest of the team. The deleted email cannot be reauthorized until completion.
-- Provenance-only anonymisation must preserve an independent assignment even
-- if its owner was since suspended. Changes to ownership remain fully checked.
DROP TRIGGER planner_assignment_update_guard;
CREATE TRIGGER planner_assignment_update_guard BEFORE UPDATE OF owner,plan_id,task_key ON planner_assignments
 WHEN NOT EXISTS(SELECT 1 FROM planner_documents WHERE id=NEW.plan_id AND kind='plan' AND archived=0)
 OR NOT EXISTS(SELECT 1 FROM members m JOIN channel_members cm ON cm.email=m.email JOIN planner_documents p ON p.channel_id=cm.channel_id WHERE p.id=NEW.plan_id AND m.email=NEW.owner AND m.active=1)
 BEGIN SELECT RAISE(ABORT,'planner_assignment_invalid'); END;
CREATE TABLE member_purge_clock (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
INSERT INTO member_purge_clock VALUES(1,0);
CREATE TABLE member_purge_previews (
 token TEXT PRIMARY KEY, actor TEXT NOT NULL, email TEXT NOT NULL, version INTEGER NOT NULL,
 uid TEXT, impact_json TEXT NOT NULL CHECK(json_valid(impact_json)), expires_at INTEGER NOT NULL
);
CREATE TABLE member_purge_jobs (
 slot INTEGER PRIMARY KEY CHECK(slot=1), id TEXT NOT NULL UNIQUE, email TEXT NOT NULL,
 uid TEXT, impact_json TEXT NOT NULL CHECK(json_valid(impact_json)),
 identity_deleted INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE member_purge_objects (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES member_purge_jobs(id), object_key TEXT NOT NULL, upload_id TEXT
);
CREATE TABLE member_purge_guards (id TEXT PRIMARY KEY, matched INTEGER NOT NULL CHECK(matched=1));
CREATE TRIGGER member_delete_last_admin BEFORE DELETE ON members
 WHEN OLD.role='admin' AND OLD.active=1 AND (SELECT COUNT(*) FROM members WHERE role='admin' AND active=1)=1
 BEGIN SELECT RAISE(ABORT,'last_admin'); END;
CREATE TRIGGER member_purge_reinvite BEFORE INSERT ON members
 WHEN EXISTS(SELECT 1 FROM member_purge_jobs WHERE email=NEW.email COLLATE NOCASE)
 BEGIN SELECT RAISE(ABORT,'member_purge_busy'); END;
CREATE TRIGGER purge_clock_members_insert AFTER INSERT ON members
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_members_update AFTER UPDATE ON members
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_members_delete AFTER DELETE ON members
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_projects_insert AFTER INSERT ON projects
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_projects_update AFTER UPDATE ON projects
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_projects_delete AFTER DELETE ON projects
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_revisions_insert AFTER INSERT ON revisions
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_revisions_update AFTER UPDATE ON revisions
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_revisions_delete AFTER DELETE ON revisions
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_activity_insert AFTER INSERT ON activity
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_activity_update AFTER UPDATE ON activity
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_activity_delete AFTER DELETE ON activity
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_media_insert AFTER INSERT ON media
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_media_update AFTER UPDATE ON media
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_media_delete AFTER DELETE ON media
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_media_parts_insert AFTER INSERT ON media_parts
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_media_parts_update AFTER UPDATE ON media_parts
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_media_parts_delete AFTER DELETE ON media_parts
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_comments_insert AFTER INSERT ON comments
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_comments_update AFTER UPDATE ON comments
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_comments_delete AFTER DELETE ON comments
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_preparation_profiles_insert AFTER INSERT ON preparation_profiles
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_preparation_profiles_update AFTER UPDATE ON preparation_profiles
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_preparation_profiles_delete AFTER DELETE ON preparation_profiles
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_preparation_profile_revisions_insert AFTER INSERT ON preparation_profile_revisions
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_preparation_profile_revisions_update AFTER UPDATE ON preparation_profile_revisions
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_preparation_profile_revisions_delete AFTER DELETE ON preparation_profile_revisions
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_derivation_batches_insert AFTER INSERT ON derivation_batches
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_derivation_batches_update AFTER UPDATE ON derivation_batches
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_derivation_batches_delete AFTER DELETE ON derivation_batches
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_project_derivations_insert AFTER INSERT ON project_derivations
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_project_derivations_update AFTER UPDATE ON project_derivations
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_project_derivations_delete AFTER DELETE ON project_derivations
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_planner_documents_insert AFTER INSERT ON planner_documents
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_planner_documents_update AFTER UPDATE ON planner_documents
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_planner_documents_delete AFTER DELETE ON planner_documents
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_planner_revisions_insert AFTER INSERT ON planner_revisions
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_planner_revisions_update AFTER UPDATE ON planner_revisions
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_planner_revisions_delete AFTER DELETE ON planner_revisions
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_planner_tasks_insert AFTER INSERT ON planner_tasks
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_planner_tasks_update AFTER UPDATE ON planner_tasks
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_planner_tasks_delete AFTER DELETE ON planner_tasks
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_planner_personal_tasks_insert AFTER INSERT ON planner_personal_tasks
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_planner_personal_tasks_update AFTER UPDATE ON planner_personal_tasks
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_planner_personal_tasks_delete AFTER DELETE ON planner_personal_tasks
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_channels_insert AFTER INSERT ON channels
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_channels_update AFTER UPDATE ON channels
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_channels_delete AFTER DELETE ON channels
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_channel_members_insert AFTER INSERT ON channel_members
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_channel_members_update AFTER UPDATE ON channel_members
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_channel_members_delete AFTER DELETE ON channel_members
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_programmes_insert AFTER INSERT ON programmes
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_programmes_update AFTER UPDATE ON programmes
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_programmes_delete AFTER DELETE ON programmes
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_programme_revisions_insert AFTER INSERT ON programme_revisions
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_programme_revisions_update AFTER UPDATE ON programme_revisions
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_programme_revisions_delete AFTER DELETE ON programme_revisions
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_planner_assignments_insert AFTER INSERT ON planner_assignments
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_planner_assignments_update AFTER UPDATE ON planner_assignments
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_planner_assignments_delete AFTER DELETE ON planner_assignments
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_habit_observations_insert AFTER INSERT ON habit_observations
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_habit_observations_update AFTER UPDATE ON habit_observations
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_habit_observations_delete AFTER DELETE ON habit_observations
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_habit_decisions_insert AFTER INSERT ON habit_decisions
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_habit_decisions_update AFTER UPDATE ON habit_decisions
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_habit_decisions_delete AFTER DELETE ON habit_decisions
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_habit_decision_revisions_insert AFTER INSERT ON habit_decision_revisions
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_habit_decision_revisions_update AFTER UPDATE ON habit_decision_revisions
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
CREATE TRIGGER purge_clock_habit_decision_revisions_delete AFTER DELETE ON habit_decision_revisions
 WHEN EXISTS(SELECT 1 FROM member_purge_previews WHERE expires_at>unixepoch()*1000)
 BEGIN UPDATE member_purge_clock SET version=version+1 WHERE id=1; END;
