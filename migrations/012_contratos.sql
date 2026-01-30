
-- 012_contratos.sql (v47)
-- Migração robusta para D1/SQLite com bases legadas imprevisíveis.
-- Objetivo: garantir schema correto para contratos, versões e aceite.
--
-- Nota: como SQLite não suporta ALTER TABLE ... IF EXISTS de forma segura em migrations,
-- e bases legadas podem ter "contratos" com colunas incompatíveis que quebram qualquer SELECT/INSERT,
-- esta migração recria as tabelas de Contratos do zero.
-- (Se você tiver contratos legados importantes, exporte-os antes via wrangler d1 execute.)

PRAGMA foreign_keys=OFF;

DROP TABLE IF EXISTS contrato_aceites;
DROP TABLE IF EXISTS contrato_versoes;
DROP TABLE IF EXISTS contratos;

CREATE TABLE contratos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL,
  cliente_id INTEGER,
  evento_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'rascunho', -- rascunho|enviado|aceito|recusado|cancelado
  versao_atual_id INTEGER,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_contratos_empresa_evento ON contratos (empresa_id, evento_id);
CREATE INDEX idx_contratos_empresa_status ON contratos (empresa_id, status);

CREATE TABLE contrato_versoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL,
  contrato_id INTEGER NOT NULL,
  numero_versao INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'rascunho', -- rascunho|enviado|aceito|substituida
  snapshot_json TEXT NOT NULL,
  hash TEXT NOT NULL,
  criado_por_user_id INTEGER,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (contrato_id) REFERENCES contratos(id)
);

CREATE UNIQUE INDEX uidx_contrato_versoes_unica ON contrato_versoes (empresa_id, contrato_id, numero_versao);
CREATE INDEX idx_contrato_versoes_empresa ON contrato_versoes (empresa_id, contrato_id);

CREATE TABLE contrato_aceites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL,
  contrato_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  nome TEXT,
  documento TEXT,
  ip TEXT,
  user_agent TEXT,
  aceito_em TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (contrato_id) REFERENCES contratos(id)
);

CREATE UNIQUE INDEX uidx_contrato_aceites_token ON contrato_aceites (empresa_id, token_hash);
CREATE INDEX idx_contrato_aceites_contrato ON contrato_aceites (empresa_id, contrato_id);

PRAGMA foreign_keys=ON;
