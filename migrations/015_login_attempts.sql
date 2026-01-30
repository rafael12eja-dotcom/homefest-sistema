-- 015_login_attempts.sql
-- Rate limiting storage for login attempts (defense-in-depth).

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  email TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time
  ON login_attempts (ip, criado_em);

CREATE INDEX IF NOT EXISTS idx_login_attempts_email_time
  ON login_attempts (email, criado_em);
