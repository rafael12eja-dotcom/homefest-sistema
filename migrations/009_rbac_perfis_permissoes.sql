-- 009_rbac_perfis_permissoes.sql
-- RBAC v2 compatible with Cloudflare D1 (SQLite)
-- Fail-closed permission model

CREATE TABLE IF NOT EXISTS perfis_permissoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL,
  perfil TEXT NOT NULL,
  modulo TEXT NOT NULL,
  acao TEXT NOT NULL,
  permitido INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_perfis_permissoes_unique
  ON perfis_permissoes (empresa_id, perfil, modulo, acao);

CREATE INDEX IF NOT EXISTS idx_perfis_permissoes_lookup
  ON perfis_permissoes (empresa_id, perfil);

WITH
tenants(id) AS (
  SELECT DISTINCT empresa_id FROM usuarios WHERE empresa_id IS NOT NULL
),
modules(modulo) AS (
  VALUES
    ('dashboard'),
    ('leads'),
    ('clientes'),
    ('eventos'),
    ('financeiro'),
    ('usuarios'),
    ('propostas')
),
actions(acao) AS (
  VALUES
    ('read'),
    ('create'),
    ('update'),
    ('delete')
),
seed(empresa_id, perfil, modulo, acao, permitido) AS (

  -- ADMIN
  SELECT t.id, 'admin', m.modulo, a.acao, 1
  FROM tenants t
  CROSS JOIN modules m
  CROSS JOIN actions a

  UNION ALL

  -- VENDAS
  SELECT t.id, 'vendas', m.modulo, a.acao,
    CASE
      WHEN m.modulo IN ('dashboard','leads','clientes','eventos','propostas') THEN 1
      ELSE 0
    END
  FROM tenants t
  CROSS JOIN modules m
  CROSS JOIN actions a

  UNION ALL

  -- FINANCEIRO
  SELECT t.id, 'financeiro', m.modulo, a.acao,
    CASE
      WHEN m.modulo IN ('dashboard','financeiro') THEN 1
      WHEN m.modulo = 'eventos' AND a.acao = 'read' THEN 1
      ELSE 0
    END
  FROM tenants t
  CROSS JOIN modules m
  CROSS JOIN actions a

  UNION ALL

  -- OPERACIONAL
  SELECT t.id, 'operacional', m.modulo, a.acao,
    CASE
      WHEN m.modulo = 'eventos' AND a.acao IN ('read','update') THEN 1
      WHEN m.modulo = 'clientes' AND a.acao = 'read' THEN 1
      WHEN m.modulo = 'dashboard' AND a.acao = 'read' THEN 1
      ELSE 0
    END
  FROM tenants t
  CROSS JOIN modules m
  CROSS JOIN actions a
)

INSERT INTO perfis_permissoes (
  empresa_id, perfil, modulo, acao, permitido, ativo, criado_em, atualizado_em
)
SELECT
  s.empresa_id,
  s.perfil,
  s.modulo,
  s.acao,
  s.permitido,
  1,
  datetime('now'),
  datetime('now')
FROM seed s
WHERE NOT EXISTS (
  SELECT 1 FROM perfis_permissoes p
  WHERE p.empresa_id = s.empresa_id
    AND p.perfil = s.perfil
    AND p.modulo = s.modulo
    AND p.acao = s.acao
);
