-- 010_tenant_columns_backfill_safe.sql
-- Objetivo: corrigir bancos legados (pré-multi-tenant) que não possuem empresa_id em tabelas core.
-- Esta migration:
--  1) adiciona empresa_id nas tabelas que ainda não possuem;
--  2) faz backfill SOMENTE quando existir exatamente 1 empresa cadastrada (determinístico, sem "fallback empresa 1");
--  3) mantém dados antigos acessíveis e não quebra produção.

-- ================================
-- Helper: obter "empresa única" (se existir)
-- ================================
-- Usamos subquery repetida nos UPDATEs para manter compatibilidade com D1/SQLite.

-- ================================
-- CLIENTES
-- ================================
ALTER TABLE clientes ADD COLUMN empresa_id INTEGER;
UPDATE clientes
SET empresa_id = (SELECT id FROM empresa LIMIT 1)
WHERE empresa_id IS NULL
  AND (SELECT COUNT(1) FROM empresa) = 1;

CREATE INDEX IF NOT EXISTS idx_clientes_empresa_nome ON clientes(empresa_id, nome);

-- ================================
-- EVENTOS
-- ================================
ALTER TABLE eventos ADD COLUMN empresa_id INTEGER;
UPDATE eventos
SET empresa_id = (SELECT id FROM empresa LIMIT 1)
WHERE empresa_id IS NULL
  AND (SELECT COUNT(1) FROM empresa) = 1;

CREATE INDEX IF NOT EXISTS idx_eventos_empresa_data ON eventos(empresa_id, data_evento);
CREATE INDEX IF NOT EXISTS idx_eventos_empresa_cliente ON eventos(empresa_id, cliente_id);

-- ================================
-- LEADS
-- ================================
ALTER TABLE leads ADD COLUMN empresa_id INTEGER;
UPDATE leads
SET empresa_id = (SELECT id FROM empresa LIMIT 1)
WHERE empresa_id IS NULL
  AND (SELECT COUNT(1) FROM empresa) = 1;

CREATE INDEX IF NOT EXISTS idx_leads_empresa_status ON leads(empresa_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_empresa_nome ON leads(empresa_id, nome);

-- ================================
-- FINANCEIRO
-- ================================
ALTER TABLE financeiro ADD COLUMN empresa_id INTEGER;
UPDATE financeiro
SET empresa_id = (SELECT id FROM empresa LIMIT 1)
WHERE empresa_id IS NULL
  AND (SELECT COUNT(1) FROM empresa) = 1;

CREATE INDEX IF NOT EXISTS idx_fin_empresa_evento ON financeiro(empresa_id, evento_id);

-- ================================
-- EVENTO_ITENS
-- ================================
ALTER TABLE evento_itens ADD COLUMN empresa_id INTEGER;
UPDATE evento_itens
SET empresa_id = (SELECT id FROM empresa LIMIT 1)
WHERE empresa_id IS NULL
  AND (SELECT COUNT(1) FROM empresa) = 1;

CREATE INDEX IF NOT EXISTS idx_evento_itens_empresa_evento ON evento_itens(empresa_id, evento_id);

-- Nota: Em ambientes com múltiplas empresas já existentes e dados antigos sem empresa_id,
-- esses registros permanecerão com empresa_id NULL (fail-closed: não aparecem em listagens tenantadas).
