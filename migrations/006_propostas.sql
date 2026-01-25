-- 006_propostas.sql
-- Proposals (quotations) linked to events
-- Backward compatible: does not alter existing tables.

CREATE TABLE IF NOT EXISTS propostas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evento_id INTEGER NOT NULL,
  versao INTEGER NOT NULL DEFAULT 1,
  titulo TEXT,
  status TEXT NOT NULL DEFAULT 'rascunho', -- rascunho | enviado | aceito | recusado
  payload_json TEXT NOT NULL, -- serialized proposal data (items, totals, terms, notes)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_propostas_evento ON propostas(evento_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_propostas_evento_versao ON propostas(evento_id, versao);
