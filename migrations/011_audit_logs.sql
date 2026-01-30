-- 011_audit_logs.sql
-- Objetivo: auditoria mínima tenant-scoped (Fase 1.2)
-- Regra: nunca logar dados sensíveis. Apenas meta: usuário, ação, módulo, rota, ids.
-- Importante: sempre filtrar por empresa_id em consultas (fail-closed).

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  user_email TEXT,
  perfil TEXT,

  acao TEXT NOT NULL,         -- create | update | delete (padronizado)
  modulo TEXT NOT NULL,       -- clientes | leads | eventos | financeiro | ...
  rota TEXT NOT NULL,         -- /api/...
  metodo TEXT NOT NULL,       -- HTTP method

  entidade TEXT,              -- tabela/entidade alvo (opcional)
  entidade_id INTEGER,        -- id do registro alvo (opcional)

  ip TEXT,
  user_agent TEXT,

  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_empresa_criado_em ON audit_logs (empresa_id, criado_em);
CREATE INDEX IF NOT EXISTS idx_audit_logs_empresa_modulo_acao_em ON audit_logs (empresa_id, modulo, acao, criado_em);
CREATE INDEX IF NOT EXISTS idx_audit_logs_empresa_user_em ON audit_logs (empresa_id, user_id, criado_em);
