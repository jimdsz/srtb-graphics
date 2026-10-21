-- Additive only. Legacy names stay intact and are checked by the application
-- before their first identity edit. The index serialises subsequent writes.
ALTER TABLE channels ADD COLUMN name_key TEXT;
CREATE UNIQUE INDEX channels_name_key_unique ON channels(name_key) WHERE name_key IS NOT NULL;
CREATE INDEX projects_channel_validation ON projects(channel_id,archived,status,updated_at DESC,id);
