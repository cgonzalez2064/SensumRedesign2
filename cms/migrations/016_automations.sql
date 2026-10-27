-- Automations and account controls (October 2026).

-- Temporary access: the account is turned off after access_until (checked at
-- every request and by the scheduled check, which also warns 3 days before).
ALTER TABLE users ADD COLUMN access_until INTEGER;
ALTER TABLE users ADD COLUMN access_warned_at INTEGER;
-- A password given by someone who manages users stops working after this
-- time if the person has not replaced it (must_change_password).
ALTER TABLE users ADD COLUMN temp_password_expires_at INTEGER;
-- Automatic deactivation for inactivity (Seguridad): the warning went out.
ALTER TABLE users ADD COLUMN inactive_warned_at INTEGER;
-- Invitations: the automatic reminder (with a fresh link) and the notice to
-- whoever invited that it expired, each sent once per invitation.
ALTER TABLE users ADD COLUMN invite_reminded_at INTEGER;
ALTER TABLE users ADD COLUMN invite_expiry_notified_at INTEGER;

-- "Pedir acceso": someone asks for permissions they don't have; whoever
-- manages users grants or declines it.
CREATE TABLE access_requests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permissions TEXT    NOT NULL,
    message     TEXT    NOT NULL DEFAULT '',
    status      TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'granted', 'declined', 'cancelled')),
    created_at  INTEGER NOT NULL,
    resolved_at INTEGER,
    resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX access_requests_status ON access_requests(status, created_at);

-- Two-step sign-in: browsers remembered for 30 days (when the owner allows it).
-- Only a hash of the cookie is kept.
CREATE TABLE trusted_devices (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT    NOT NULL UNIQUE,
    label        TEXT    NOT NULL DEFAULT '',
    created_at   INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL
);
CREATE INDEX trusted_devices_user ON trusted_devices(user_id);

-- Prospectos: who follows each lead up, the reminder when it waits too long,
-- and whether the visitor got the automatic confirmation.
ALTER TABLE leads ADD COLUMN assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN followup_sent_at INTEGER;
ALTER TABLE leads ADD COLUMN confirmation_sent INTEGER NOT NULL DEFAULT 0;
CREATE INDEX leads_assigned ON leads(assigned_to, status);
