-- «Quitar dispositivos registrados» (October 2026): someone who manages users,
-- the person (Mi cuenta) or the console removes an account's authenticator
-- app and remembered browsers. At the next sign-in, after the password, a
-- 6-digit code sent to the account's e-mail stands in for the app; then the
-- person registers the new device (required until they do).
ALTER TABLE users ADD COLUMN two_factor_reenroll_at INTEGER;

-- Sign-in challenges answered with a code sent by e-mail ('email'): the
-- code's keyed hash and how many times it was sent (3 at most).
ALTER TABLE login_challenges ADD COLUMN kind TEXT NOT NULL DEFAULT 'totp';
ALTER TABLE login_challenges ADD COLUMN code_hash TEXT;
ALTER TABLE login_challenges ADD COLUMN sends INTEGER NOT NULL DEFAULT 0;
