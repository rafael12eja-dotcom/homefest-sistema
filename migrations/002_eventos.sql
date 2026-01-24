-- 002_eventos.sql
-- Garante que a tabela de eventos exista (D1/SQLite)

CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER,
  tipo_evento TEXT,
  data_evento DATE,
  hora_inicio TEXT,
  hora_fim TEXT,
  convidados INTEGER DEFAULT 0,
  endereco TEXT,
  valor_total REAL DEFAULT 0,
  status TEXT DEFAULT 'orcamento',
  observacoes TEXT,
  contrato_numero TEXT,
  forma_pagamento TEXT,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_eventos_cliente ON eventos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_eventos_data ON eventos(data_evento);
