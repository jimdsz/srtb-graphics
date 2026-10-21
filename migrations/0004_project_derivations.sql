-- Immutable preparation provenance only; no playout, approval or media upload.
CREATE TABLE derivation_batches (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  source_project_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK(source_revision>0),
  source_template_id TEXT NOT NULL,
  source_template_version TEXT NOT NULL,
  source_library_version TEXT NOT NULL,
  source_snapshot_json TEXT NOT NULL CHECK(json_valid(source_snapshot_json) AND length(CAST(source_snapshot_json AS BLOB))<=131072),
  source_snapshot_sha256 TEXT NOT NULL CHECK(length(source_snapshot_sha256)=64 AND source_snapshot_sha256 NOT GLOB '*[^0-9a-f]*'),
  mapping_version TEXT NOT NULL,
  media_refs_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(media_refs_json) AND json_type(media_refs_json)='array' AND length(CAST(media_refs_json AS BLOB))<=131072),
  voice_refs_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(voice_refs_json) AND json_type(voice_refs_json)='array' AND length(CAST(voice_refs_json AS BLOB))<=131072),
  target_count INTEGER NOT NULL CHECK(target_count BETWEEN 1 AND 8),
  created_by TEXT NOT NULL REFERENCES members(email),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(created_by,request_id),
  FOREIGN KEY(source_project_id,source_revision) REFERENCES revisions(project_id,revision)
);
CREATE INDEX derivation_batches_source ON derivation_batches(source_project_id,created_at DESC,id);
CREATE TABLE project_derivations (
  batch_id TEXT NOT NULL REFERENCES derivation_batches(id),
  project_id TEXT NOT NULL UNIQUE,
  initial_revision INTEGER NOT NULL DEFAULT 1 CHECK(initial_revision=1),
  target_key TEXT NOT NULL CHECK(target_key IN ('ba-vertical','ba-portrait','popup-1','popup-2','popup-3','popup-follow','tds','replay',
    'ba-day-time-tv','ba-day-time-portrait','ba-day-time-vertical','ba-tomorrow-tv','ba-tomorrow-portrait','ba-tomorrow-vertical',
    'ba-today-tv','ba-today-portrait','ba-today-vertical','ba-tonight-tv','ba-tonight-portrait','ba-tonight-vertical','ba-now-tv','ba-now-portrait','ba-now-vertical')),
  label TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 7),
  warnings_json TEXT NOT NULL CHECK(json_valid(warnings_json) AND json_type(warnings_json)='array' AND length(CAST(warnings_json AS BLOB))<=16384),
  announcement_json TEXT CHECK(announcement_json IS NULL OR (json_valid(announcement_json) AND json_type(announcement_json)='object' AND length(CAST(announcement_json AS BLOB))<=16384)),
  PRIMARY KEY(batch_id,target_key),
  UNIQUE(batch_id,ordinal),
  FOREIGN KEY(project_id,initial_revision) REFERENCES revisions(project_id,revision)
);
CREATE TRIGGER derivation_source_guard BEFORE INSERT ON derivation_batches
WHEN NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.source_project_id AND revision=NEW.source_revision AND archived=0
  AND template_id=NEW.source_template_id AND template_version=NEW.source_template_version AND library_version=NEW.source_library_version)
BEGIN SELECT RAISE(ABORT,'derivation_source_conflict'); END;
CREATE TRIGGER derivation_actor_guard BEFORE INSERT ON derivation_batches
WHEN NOT EXISTS(SELECT 1 FROM members WHERE email=NEW.created_by AND active=1 AND role IN ('admin','designer','broadcaster'))
BEGIN SELECT RAISE(ABORT,'derivation_actor_inactive'); END;
CREATE TRIGGER derivation_media_guard BEFORE INSERT ON derivation_batches
WHEN EXISTS(SELECT 1 FROM json_each(NEW.media_refs_json) ref WHERE NOT EXISTS(
  SELECT 1 FROM media WHERE id=json_extract(ref.value,'$.id') AND mime_type=json_extract(ref.value,'$.mimeType') AND status='ready'))
BEGIN SELECT RAISE(ABORT,'derivation_media_unavailable'); END;
CREATE TRIGGER derivation_voice_guard BEFORE INSERT ON derivation_batches
WHEN EXISTS(SELECT 1 FROM json_each(NEW.voice_refs_json) ref WHERE NOT EXISTS(
  SELECT 1 FROM preparation_profiles p JOIN preparation_profile_revisions r ON r.profile_id=p.id
  WHERE p.id=json_extract(ref.value,'$.profileId') AND p.kind='voice' AND p.archived=0
    AND p.revision=json_extract(ref.value,'$.currentRevision') AND r.revision=json_extract(ref.value,'$.revision') AND r.archived=0
    AND r.data_json=json_extract(ref.value,'$.dataJson') AND r.validated_by=json_extract(ref.value,'$.validatedBy')
    AND r.validated_at=json_extract(ref.value,'$.validatedAt')))
BEGIN SELECT RAISE(ABORT,'derivation_voice_conflict'); END;
CREATE TRIGGER derivation_batch_immutable BEFORE UPDATE ON derivation_batches
BEGIN SELECT RAISE(ABORT,'derivation_batch_immutable'); END;
CREATE TRIGGER project_derivation_immutable BEFORE UPDATE ON project_derivations
BEGIN SELECT RAISE(ABORT,'project_derivation_immutable'); END;
