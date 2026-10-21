-- Retain the identity reference and production history while withdrawing access.
-- Reauthorisation must be an explicit administrator action, never a login side effect.
ALTER TABLE members ADD COLUMN removed_at TEXT;
CREATE TRIGGER member_removed_inactive BEFORE UPDATE ON members
WHEN NEW.removed_at IS NOT NULL AND NEW.active<>0
BEGIN SELECT RAISE(ABORT,'removed_member_active'); END;
CREATE TRIGGER member_removed_inactive_insert BEFORE INSERT ON members
WHEN NEW.removed_at IS NOT NULL AND NEW.active<>0
BEGIN SELECT RAISE(ABORT,'removed_member_active'); END;
