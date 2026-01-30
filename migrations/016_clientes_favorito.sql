-- 016_clientes_favorito.sql
-- Adds a 'favorito' flag to clientes for UI quick pinning.
-- Safe migration: SQLite allows ADD COLUMN with DEFAULT.

ALTER TABLE clientes ADD COLUMN favorito INTEGER NOT NULL DEFAULT 0;
