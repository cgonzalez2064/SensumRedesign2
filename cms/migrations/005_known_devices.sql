-- Browsers/devices each account has signed in from, for the
-- "new sign-in from a device we haven't seen" security e-mail.
CREATE TABLE known_devices (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_hash TEXT    NOT NULL,
    label       TEXT    NOT NULL DEFAULT '',
    first_seen  INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL,
    UNIQUE (user_id, device_hash)
);
