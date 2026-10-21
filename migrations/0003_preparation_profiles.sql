-- Additive preparation catalogue only. No programme scheduling or playout state.
CREATE TABLE preparation_profiles (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('programme','preset','voice')),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  template_id TEXT,
  template_version TEXT,
  library_version TEXT,
  data_json TEXT NOT NULL CHECK(json_valid(data_json) AND length(CAST(data_json AS BLOB)) <= 65536),
  favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0,1)),
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_by TEXT NOT NULL REFERENCES members(email),
  updated_by TEXT NOT NULL REFERENCES members(email),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  validated_by TEXT REFERENCES members(email),
  validated_at TEXT,
  CHECK((kind='preset' AND template_id IS NOT NULL AND template_version IS NOT NULL AND library_version IS NOT NULL)
     OR (kind<>'preset' AND template_id IS NULL AND template_version IS NULL AND library_version IS NULL)),
  CHECK((kind='voice' AND validated_by IS NOT NULL AND validated_at IS NOT NULL)
     OR (kind<>'voice' AND validated_by IS NULL AND validated_at IS NULL))
);
CREATE INDEX preparation_profiles_updated ON preparation_profiles(archived,updated_at DESC,id);
CREATE INDEX preparation_profiles_kind ON preparation_profiles(archived,kind,updated_at DESC,id);
CREATE INDEX preparation_profiles_favorites ON preparation_profiles(archived,favorite,updated_at DESC,id);
CREATE TABLE preparation_profile_revisions (
  profile_id TEXT NOT NULL REFERENCES preparation_profiles(id),
  revision INTEGER NOT NULL,
  name TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK(json_valid(data_json) AND length(CAST(data_json AS BLOB)) <= 65536),
  favorite INTEGER NOT NULL CHECK(favorite IN (0,1)),
  archived INTEGER NOT NULL CHECK(archived IN (0,1)),
  actor TEXT NOT NULL REFERENCES members(email),
  created_at TEXT NOT NULL,
  validated_by TEXT REFERENCES members(email),
  validated_at TEXT,
  PRIMARY KEY(profile_id,revision)
);
CREATE TRIGGER preparation_profile_created AFTER INSERT ON preparation_profiles BEGIN
  INSERT INTO preparation_profile_revisions VALUES(NEW.id,NEW.revision,NEW.name,NEW.data_json,NEW.favorite,NEW.archived,NEW.updated_by,NEW.updated_at,NEW.validated_by,NEW.validated_at);
  INSERT INTO activity(actor,action,target,detail) VALUES(NEW.updated_by,'preparation_profile.created',NEW.id,NEW.kind || ' / ' || NEW.name);
END;
CREATE TRIGGER preparation_profile_immutable BEFORE UPDATE ON preparation_profiles
WHEN NEW.id IS NOT OLD.id OR NEW.kind IS NOT OLD.kind OR NEW.created_by IS NOT OLD.created_by
  OR NEW.created_at IS NOT OLD.created_at OR NEW.template_id IS NOT OLD.template_id
  OR NEW.template_version IS NOT OLD.template_version OR NEW.library_version IS NOT OLD.library_version
  OR NEW.revision <> OLD.revision+1
BEGIN SELECT RAISE(ABORT,'preparation_profile_immutable'); END;
CREATE TRIGGER preparation_profile_updated AFTER UPDATE ON preparation_profiles BEGIN
  INSERT INTO preparation_profile_revisions VALUES(NEW.id,NEW.revision,NEW.name,NEW.data_json,NEW.favorite,NEW.archived,NEW.updated_by,NEW.updated_at,NEW.validated_by,NEW.validated_at);
  INSERT INTO activity(actor,action,target,detail) VALUES(NEW.updated_by,
    CASE WHEN OLD.archived <> NEW.archived THEN 'preparation_profile.archive'
         WHEN OLD.favorite <> NEW.favorite THEN 'preparation_profile.favorite'
         ELSE 'preparation_profile.saved' END,
    NEW.id,NEW.kind || ' / r' || NEW.revision || ' / archived=' || NEW.archived || ' / favorite=' || NEW.favorite);
END;
