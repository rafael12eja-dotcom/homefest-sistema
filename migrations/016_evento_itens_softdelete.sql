-- 016_evento_itens_softdelete.sql
-- Add soft-delete + update timestamp to evento_itens (required for Central da Festa modules).
-- Safe additive migration.

ALTER TABLE evento_itens ADD COLUMN ativo INTEGER DEFAULT 1;
ALTER TABLE evento_itens ADD COLUMN atualizado_em DATETIME;
UPDATE evento_itens SET atualizado_em = criado_em WHERE atualizado_em IS NULL;

CREATE INDEX IF NOT EXISTS idx_evento_itens_empresa_evento_ativo ON evento_itens(empresa_id, evento_id, ativo);
