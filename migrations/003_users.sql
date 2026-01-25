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

