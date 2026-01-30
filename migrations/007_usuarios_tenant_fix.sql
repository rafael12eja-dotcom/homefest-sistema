-- migrations/007_usuarios_tenant_fix.sql
-- Align production 'usuarios' schema with the canonical multi-tenant model.
-- This migration is compatible with older prod schema that has 'senha_sha256' but not 'senha_hash'/'salt'.

-- 1) Add missing columns (SQLite supports ADD COLUMN; constraints are limited in ALTER TABLE).
ALTER TABLE usuarios ADD COLUMN senha_hash TEXT;
ALTER TABLE usuarios ADD COLUMN salt TEXT;
ALTER TABLE usuarios ADD COLUMN atualizado_em DATETIME;

-- 2) Backfill password fields from legacy column (sha256(password)).
-- If salt is NULL/empty, auth logic will verify as sha256(password).
UPDATE usuarios
SET senha_hash = COALESCE(senha_hash, senha_sha256)
WHERE senha_hash IS NULL;

-- 3) Ensure tenant is present for legacy rows (must not end up NULL).
-- Prefer existing company id if present; otherwise default to first company row or 1.
UPDATE usuarios
SET empresa_id = COALESCE(
  empresa_id,
  (SELECT id FROM empresa ORDER BY id LIMIT 1),
  1
)
WHERE empresa_id IS NULL;

-- 4) Backfill atualizado_em for legacy rows.
UPDATE usuarios
SET atualizado_em = COALESCE(atualizado_em, criado_em, CURRENT_TIMESTAMP)
WHERE atualizado_em IS NULL;

-- 5) Normalize basic fields to avoid null-related filtering issues.
UPDATE usuarios SET ativo = 1 WHERE ativo IS NULL;
UPDATE usuarios SET perfil = 'vendas' WHERE perfil IS NULL OR trim(perfil) = '';

-- 6) Add indexes / uniqueness per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_empresa_email_unique ON usuarios(empresa_id, email);
CREATE INDEX IF NOT EXISTS idx_usuarios_empresa_id ON usuarios(empresa_id);
