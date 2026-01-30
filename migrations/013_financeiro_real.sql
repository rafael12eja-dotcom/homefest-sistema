-- 013_financeiro_real.sql
-- PASSO 5 — Financeiro real
-- Regras:
-- - multi-tenant: empresa_id obrigatório
-- - fail-closed
-- - compatível com legado: tabela financeiro permanece

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
