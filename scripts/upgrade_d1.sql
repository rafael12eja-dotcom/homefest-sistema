-- scripts/upgrade_d1.sql
-- Rode no Cloudflare D1 Console SE você já tem tabelas antigas e quer atualizar sem apagar dados.
-- Você pode executar comando a comando. Se der erro de "duplicate column", apenas ignore e siga.

-- LEADS
ALTER TABLE leads ADD COLUMN email TEXT;
ALTER TABLE leads ADD COLUMN cidade TEXT;
ALTER TABLE leads ADD COLUMN bairro TEXT;

-- CLIENTES
ALTER TABLE clientes ADD COLUMN lead_id INTEGER;
ALTER TABLE clientes ADD COLUMN cidade TEXT;
ALTER TABLE clientes ADD COLUMN bairro TEXT;

-- EVENTOS
ALTER TABLE eventos ADD COLUMN tipo_evento TEXT;
ALTER TABLE eventos ADD COLUMN data_evento TEXT;
ALTER TABLE eventos ADD COLUMN convidados INTEGER;
ALTER TABLE eventos ADD COLUMN valor_total REAL;
ALTER TABLE eventos ADD COLUMN status TEXT;
ALTER TABLE eventos ADD COLUMN contrato_numero TEXT;
ALTER TABLE eventos ADD COLUMN forma_pagamento TEXT;

-- EVENTO_ITENS (se não existir, crie)
CREATE TABLE IF NOT EXISTS evento_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evento_id INTEGER NOT NULL,
  categoria TEXT NOT NULL,
  item TEXT NOT NULL,
  quantidade REAL DEFAULT 0,
  unidade TEXT,
  fornecedor TEXT,
  valor_unitario REAL DEFAULT 0,
  valor_total REAL DEFAULT 0,
  status TEXT DEFAULT 'pendente',
  observacao TEXT,
  criado_em TEXT DEFAULT CURRENT_TIMESTAMP
);

-- FINANCEIRO (se não existir, crie)
CREATE TABLE IF NOT EXISTS financeiro (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evento_id INTEGER,
  tipo TEXT NOT NULL,
  descricao TEXT,
  valor REAL NOT NULL,
  data_movimento TEXT,
  origem TEXT,
  criado_em TEXT DEFAULT CURRENT_TIMESTAMP
);

-- CONTRATOS (se não existir, crie)
CREATE TABLE IF NOT EXISTS contratos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evento_id INTEGER NOT NULL,
  arquivo_url TEXT NOT NULL,
  criado_em TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_eventos_cliente ON eventos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_itens_evento ON evento_itens(evento_id);
CREATE INDEX IF NOT EXISTS idx_fin_evento ON financeiro(evento_id);


-- SaaS: EMPRESA + USUARIOS (para múltiplos logins)
-- 003_users.sql
-- SaaS foundation: empresa + usuarios (email + senha)
-- Safe to run multiple times (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS empresa (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  telefone TEXT,
  email TEXT,
  criado_em TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  salt TEXT,
  perfil TEXT NOT NULL DEFAULT 'vendas', -- admin | vendas | financeiro | operacional
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT DEFAULT (datetime('now')),
  atualizado_em TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (empresa_id) REFERENCES empresa(id)
);

CREATE INDEX IF NOT EXISTS idx_usuarios_empresa ON usuarios(empresa_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);

-- Seed empresa Home Fest if empty
INSERT INTO empresa (id, nome, telefone, email)
SELECT 1, 'Home Fest & Eventos', NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM empresa WHERE id = 1);


