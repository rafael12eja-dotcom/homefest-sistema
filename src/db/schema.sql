-- src/db/schema.sql
-- Canonical schema (must stay aligned with migrations/*.sql)
-- Latest: includes migrations up to 008_padronizacao_tenant.sql

PRAGMA foreign_keys = ON;

-- TENANT
CREATE TABLE IF NOT EXISTS empresa (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  telefone TEXT,
  email TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- USERS
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL,
  nome TEXT NOT NULL,
  email TEXT NOT NULL,
  -- Legacy column kept for backward compatibility with older prod data.
  senha_sha256 TEXT,
  -- Canonical auth columns
  senha_hash TEXT NOT NULL,
  salt TEXT,
  perfil TEXT NOT NULL DEFAULT 'vendas',
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (empresa_id) REFERENCES empresa(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_empresa_email_unique ON usuarios(empresa_id, email);
CREATE INDEX IF NOT EXISTS idx_usuarios_empresa_id ON usuarios(empresa_id);

-- RBAC v2 (module permissions)
CREATE TABLE IF NOT EXISTS perfis_permissoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL,
  perfil TEXT NOT NULL,
  modulo TEXT NOT NULL,
  acao TEXT NOT NULL,
  permitido INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (empresa_id) REFERENCES empresa(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_perfis_permissoes_unique
  ON perfis_permissoes(empresa_id, perfil, modulo, acao);

CREATE INDEX IF NOT EXISTS idx_perfis_permissoes_lookup
  ON perfis_permissoes(empresa_id, perfil);

-- LEADS
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL,
  nome TEXT NOT NULL,
  telefone TEXT,
  email TEXT,
  cidade TEXT,
  bairro TEXT,
  origem TEXT,
  status TEXT NOT NULL DEFAULT 'novo',
  observacoes TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (empresa_id) REFERENCES empresa(id)
);

CREATE INDEX IF NOT EXISTS idx_leads_empresa_status ON leads(empresa_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_empresa_nome ON leads(empresa_id, nome);

-- LEAD NOTES (history)
CREATE TABLE IF NOT EXISTS lead_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  note TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lead_notes_lead ON lead_notes(lead_id);

-- CLIENTES
CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL,
  lead_id INTEGER,
  nome TEXT NOT NULL,
  telefone TEXT,
  email TEXT,
  cidade TEXT,
  bairro TEXT,
  cep TEXT,
  endereco TEXT,
  numero TEXT,
  complemento TEXT,
  estado TEXT,
  observacoes TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (empresa_id) REFERENCES empresa(id)
);

CREATE INDEX IF NOT EXISTS idx_clientes_empresa_nome ON clientes(empresa_id, nome);

-- EVENTOS
CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL,
  cliente_id INTEGER NOT NULL,
  tipo_evento TEXT,
  data_evento TEXT,
  convidados INTEGER NOT NULL DEFAULT 0,
  valor_total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'orcamento',
  contrato_numero TEXT,
  forma_pagamento TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (empresa_id) REFERENCES empresa(id),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id)
);

CREATE INDEX IF NOT EXISTS idx_eventos_empresa_data ON eventos(empresa_id, data_evento);
CREATE INDEX IF NOT EXISTS idx_eventos_empresa_cliente ON eventos(empresa_id, cliente_id);

-- EVENTO ITENS
CREATE TABLE IF NOT EXISTS evento_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL,
  evento_id INTEGER NOT NULL,
  categoria TEXT NOT NULL,
  item TEXT NOT NULL,
  quantidade REAL NOT NULL DEFAULT 0,
  unidade TEXT,
  fornecedor TEXT,
  valor_unitario REAL NOT NULL DEFAULT 0,
  valor_total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pendente',
  observacao TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (empresa_id) REFERENCES empresa(id),
  FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_evento_itens_evento ON evento_itens(evento_id);
CREATE INDEX IF NOT EXISTS idx_evento_itens_empresa_evento ON evento_itens(empresa_id, evento_id);

-- FINANCEIRO
CREATE TABLE IF NOT EXISTS financeiro (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL,
  evento_id INTEGER,
  tipo TEXT NOT NULL, -- entrada | saida
  descricao TEXT,
  valor REAL NOT NULL,
  data_movimento TEXT NOT NULL,
  origem TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (empresa_id) REFERENCES empresa(id),
  FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_fin_empresa_evento ON financeiro(empresa_id, evento_id);



-- FINANCEIRO REAL (PASSO 5)
-- A/R: Títulos (contas a receber) por evento/contrato
CREATE TABLE IF NOT EXISTS ar_titulos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL,
  evento_id INTEGER NOT NULL,
  contrato_id INTEGER,
  descricao TEXT,
  valor_total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'aberto', -- aberto | quitado | cancelado
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (empresa_id) REFERENCES empresa(id),
  FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE,
  FOREIGN KEY (contrato_id) REFERENCES contratos(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ar_titulos_empresa_evento ON ar_titulos(empresa_id, evento_id);

-- A/R: Parcelas
CREATE TABLE IF NOT EXISTS ar_parcelas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL,
  titulo_id INTEGER NOT NULL,
  numero INTEGER NOT NULL DEFAULT 1,
  vencimento TEXT NOT NULL,
  valor REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'aberta', -- aberta | paga | cancelada
  pago_em TEXT,
  forma_pagamento TEXT,
  observacao TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (empresa_id) REFERENCES empresa(id),
  FOREIGN KEY (titulo_id) REFERENCES ar_titulos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ar_parcelas_empresa_venc ON ar_parcelas(empresa_id, vencimento);
CREATE INDEX IF NOT EXISTS idx_ar_parcelas_empresa_titulo ON ar_parcelas(empresa_id, titulo_id);

-- A/P: Contas a pagar
CREATE TABLE IF NOT EXISTS ap_contas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL,
  evento_id INTEGER NOT NULL,
  evento_item_id INTEGER,
  fornecedor TEXT,
  categoria TEXT,
  descricao TEXT NOT NULL,
  vencimento TEXT NOT NULL,
  valor REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'aberta', -- aberta | paga | cancelada
  pago_em TEXT,
  forma_pagamento TEXT,
  observacao TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (empresa_id) REFERENCES empresa(id),
  FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE,
  FOREIGN KEY (evento_item_id) REFERENCES evento_itens(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ap_contas_empresa_venc ON ap_contas(empresa_id, vencimento);
CREATE INDEX IF NOT EXISTS idx_ap_contas_empresa_evento ON ap_contas(empresa_id, evento_id);
-- CONTRATOS (Fase 2.1)
CREATE TABLE IF NOT EXISTS contratos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL,
  cliente_id INTEGER,
  evento_id INTEGER,
  proposta_versao_id INTEGER,
  status TEXT NOT NULL DEFAULT 'rascunho',
  versao_atual_id INTEGER,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contratos_empresa_evento ON contratos (empresa_id, evento_id);
CREATE INDEX IF NOT EXISTS idx_contratos_empresa_cliente ON contratos (empresa_id, cliente_id);

CREATE TABLE IF NOT EXISTS contrato_versoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL,
  contrato_id INTEGER NOT NULL,
  numero_versao INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'rascunho',
  snapshot_json TEXT NOT NULL,
  hash TEXT NOT NULL,
  gerado_em TEXT,
  criado_por_user_id INTEGER,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (contrato_id) REFERENCES contratos(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contrato_versoes_contrato_numero ON contrato_versoes (contrato_id, numero_versao);
CREATE INDEX IF NOT EXISTS idx_contrato_versoes_empresa_contrato ON contrato_versoes (empresa_id, contrato_id, criado_em);

CREATE TABLE IF NOT EXISTS contrato_aceites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL,
  contrato_versao_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  nome TEXT,
  documento TEXT,
  ip TEXT,
  user_agent TEXT,
  aceito_em TEXT,
  FOREIGN KEY (contrato_versao_id) REFERENCES contrato_versoes(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contrato_aceites_token ON contrato_aceites (token_hash);
CREATE INDEX IF NOT EXISTS idx_contrato_aceites_empresa_versao ON contrato_aceites (empresa_id, contrato_versao_id, aceito_em);


-- Caixa (ledger)

CREATE TABLE IF NOT EXISTS caixa_lancamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL,
  evento_id INTEGER,
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada','saida')),
  categoria TEXT NOT NULL,
  descricao TEXT,
  valor REAL NOT NULL,
  data_movimento TEXT NOT NULL, -- ISO YYYY-MM-DD
  metodo TEXT, -- ex: pix, dinheiro, transferencia
  referencia TEXT, -- ex: patrimonio, retirada_socios, aporte
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_caixa_empresa_data ON caixa_lancamentos(empresa_id, data_movimento);
CREATE INDEX IF NOT EXISTS idx_caixa_empresa_evento ON caixa_lancamentos(empresa_id, evento_id);




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

PRAGMA foreign_keys=ON;
