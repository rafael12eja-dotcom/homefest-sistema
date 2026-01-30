-- 014_caixa.sql
-- Caixa da empresa (ledger)
PRAGMA foreign_keys=OFF;

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

PRAGMA foreign_keys=ON;
