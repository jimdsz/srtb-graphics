CREATE TABLE habit_observations (
 channel_id TEXT NOT NULL REFERENCES channels(id),programme TEXT NOT NULL,
 source_hash TEXT NOT NULL,plan_id TEXT NOT NULL REFERENCES planner_documents(id),
 plan_revision INTEGER NOT NULL,candidate TEXT NOT NULL CHECK(json_valid(candidate)),
 actor TEXT NOT NULL,confirmed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(channel_id,programme,source_hash)
);
CREATE TABLE habit_write_guards (id TEXT PRIMARY KEY,matched INTEGER NOT NULL CHECK(matched=1));
CREATE TABLE habit_decisions (
 id TEXT PRIMARY KEY,channel_id TEXT NOT NULL REFERENCES channels(id),programme TEXT NOT NULL,
 candidate TEXT NOT NULL CHECK(json_valid(candidate)),state TEXT NOT NULL CHECK(state IN ('approved','disabled','forgotten')),
 rule_id TEXT REFERENCES planner_documents(id),rule_revision INTEGER,revision INTEGER NOT NULL DEFAULT 1,
 actor TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(channel_id,programme)
);
CREATE TABLE habit_decision_revisions (
 decision_id TEXT NOT NULL REFERENCES habit_decisions(id),revision INTEGER NOT NULL,
 candidate TEXT NOT NULL,state TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(decision_id,revision)
);
CREATE TRIGGER habit_decision_created AFTER INSERT ON habit_decisions BEGIN
 INSERT INTO habit_decision_revisions VALUES(NEW.id,NEW.revision,NEW.candidate,NEW.state,NEW.actor,NEW.updated_at);
END;
CREATE TRIGGER habit_decision_updated AFTER UPDATE ON habit_decisions BEGIN
 INSERT INTO habit_decision_revisions VALUES(NEW.id,NEW.revision,NEW.candidate,NEW.state,NEW.actor,NEW.updated_at);
END;
