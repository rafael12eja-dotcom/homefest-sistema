-- PHASE 2.3 — MÓDULO DE EQUIPE DO EVENTO

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS equipe_cargos (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo            TEXT NOT NULL UNIQUE,
  nome              TEXT NOT NULL,
  descricao         TEXT,
  ordem             INTEGER NOT NULL DEFAULT 0,

  calc_tipo         TEXT NOT NULL DEFAULT 'FIXED',    -- FIXED | PER_GUEST
  calc_divisor      INTEGER,                          -- ex: 20
  calc_min          INTEGER NOT NULL DEFAULT 0,
  calc_round        TEXT NOT NULL DEFAULT 'CEIL',      -- CEIL | FLOOR | ROUND

  custo_padrao      REAL NOT NULL DEFAULT 0,

  ativo             INTEGER NOT NULL DEFAULT 1,
  criado_em         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS evento_equipe (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  evento_id          INTEGER NOT NULL,
  cargo_id           INTEGER NOT NULL,

  quantidade         INTEGER NOT NULL DEFAULT 0,
  custo_unitario     REAL NOT NULL DEFAULT 0,
  custo_total        REAL NOT NULL DEFAULT 0,

  auto_calculado     INTEGER NOT NULL DEFAULT 1,
  observacao         TEXT,
  atualizado_em      TEXT NOT NULL DEFAULT (datetime('now')),
  criado_em          TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(evento_id, cargo_id),
  FOREIGN KEY(evento_id) REFERENCES eventos(id) ON DELETE CASCADE,
  FOREIGN KEY(cargo_id)  REFERENCES equipe_cargos(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_evento_equipe_evento ON evento_equipe(evento_id);
CREATE INDEX IF NOT EXISTS idx_evento_equipe_cargo  ON evento_equipe(cargo_id);

INSERT OR IGNORE INTO equipe_cargos
(codigo,nome,descricao,ordem,calc_tipo,calc_divisor,calc_min,calc_round,custo_padrao)
VALUES
('WAITER','Garçom','1 garçom a cada 20 convidados',10,'PER_GUEST',20,1,'CEIL',0),
('COOK','Cozinheiro(a)','Responsável pelo preparo e finalização',20,'FIXED',NULL,1,'CEIL',0),
('KITCHEN_ASST','Auxiliar de Cozinha','Apoio operacional de cozinha',30,'FIXED',NULL,0,'CEIL',0),
('COORDINATOR','Coordenador(a)','Coordenação e controle do evento',40,'FIXED',NULL,1,'CEIL',0),
('BBQ_CHEF','Churrasqueiro(a)','Quando aplicável (churrasco)',50,'FIXED',NULL,0,'CEIL',0),
('KIDS_MONITOR','Monitor(a) Infantil','Quando aplicável (kids)',60,'FIXED',NULL,0,'CEIL',0);
