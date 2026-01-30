-- 008_padronizacao_tenant.sql
-- Cloudflare D1 migration
-- NOTE: D1 migrations are executed atomically by the platform; do NOT use BEGIN/COMMIT.
-- NOTE: SQLite does not allow adding a column with a non-constant DEFAULT via ALTER TABLE.

-- USUARIOS already receives atualizado_em in migration 007_usuarios_tenant_fix.sql.
-- Do NOT touch usuarios here to avoid duplicate-column failures.

-- ================================
-- CLIENTES
-- ================================
ALTER TABLE clientes ADD COLUMN ativo INTEGER DEFAULT 1;
ALTER TABLE clientes ADD COLUMN atualizado_em DATETIME;
UPDATE clientes SET atualizado_em = criado_em WHERE atualizado_em IS NULL;

-- ================================
-- LEADS
-- ================================
ALTER TABLE leads ADD COLUMN ativo INTEGER DEFAULT 1;
ALTER TABLE leads ADD COLUMN atualizado_em DATETIME;
UPDATE leads SET atualizado_em = criado_em WHERE atualizado_em IS NULL;

-- ================================
-- EVENTOS
-- ================================
ALTER TABLE eventos ADD COLUMN ativo INTEGER DEFAULT 1;
ALTER TABLE eventos ADD COLUMN atualizado_em DATETIME;
UPDATE eventos SET atualizado_em = criado_em WHERE atualizado_em IS NULL;

-- ================================
-- FINANCEIRO
-- ================================
ALTER TABLE financeiro ADD COLUMN ativo INTEGER DEFAULT 1;
ALTER TABLE financeiro ADD COLUMN atualizado_em DATETIME;
UPDATE financeiro SET atualizado_em = criado_em WHERE atualizado_em IS NULL;
