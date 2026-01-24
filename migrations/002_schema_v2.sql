-- 002_schema_v2.sql
-- Objetivo: garantir as tabelas/colunas necessárias para o CRM/ERP da Home Fest.
-- OBS: Se alguma coluna já existir, o D1 pode acusar erro em ALTER TABLE. Nesse caso, rode o scripts/upgrade_d1.sql manualmente
-- e ignore as mensagens de "duplicate column".

-- LEADS
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  telefone TEXT,
  email TEXT,
  cidade TEXT,
  bairro TEXT,
  origem TEXT,
  status TEXT DEFAULT 'novo',
  observacoes TEXT,
  criado_em TEXT DEFAULT CURRENT_TIMESTAMP
);

-- CLIENTES
CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER,
  nome TEXT NOT NULL,
  telefone TEXT,
  email TEXT,
  cidade TEXT,
  bairro TEXT,
  criado_em TEXT DEFAULT CURRENT_TIMESTAMP
);

-- EVENTOS (FESTAS)
CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL,
  tipo_evento TEXT,
  data_evento TEXT,
  convidados INTEGER DEFAULT 0,
  valor_total REAL DEFAULT 0,
  status TEXT DEFAULT 'orcamento',
  contrato_numero TEXT,
  forma_pagamento TEXT,
  criado_em TEXT DEFAULT CURRENT_TIMESTAMP
);

-- EVENTO ITENS (CENTRAL DA FESTA)
CREATE TABLE IF NOT EXISTS evento_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evento_id INTEGER NOT NULL,
  categoria TEXT NOT NULL,   -- equipe | bebidas | doces | salgados | decoracao | estrutura | pagamento
  item TEXT NOT NULL,
  quantidade REAL DEFAULT 0,
  unidade TEXT,
  fornecedor TEXT,           -- homefest | cliente | terceiro
  valor_unitario REAL DEFAULT 0,
  valor_total REAL DEFAULT 0,
  status TEXT DEFAULT 'pendente',
  observacao TEXT,
  criado_em TEXT DEFAULT CURRENT_TIMESTAMP
);

-- FINANCEIRO
CREATE TABLE IF NOT EXISTS financeiro (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evento_id INTEGER,
  tipo TEXT NOT NULL, -- entrada | saida
  descricao TEXT,
  valor REAL NOT NULL,
  data_movimento TEXT,
  origem TEXT,
  criado_em TEXT DEFAULT CURRENT_TIMESTAMP
);

-- CONTRATOS (R2)
CREATE TABLE IF NOT EXISTS contratos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evento_id INTEGER NOT NULL,
  arquivo_url TEXT NOT NULL,
  criado_em TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_eventos_cliente ON eventos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_itens_evento ON evento_itens(evento_id);
CREATE INDEX IF NOT EXISTS idx_fin_evento ON financeiro(evento_id);
