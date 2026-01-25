-- 005_clientes_v2.sql
-- Objetivo: expandir cadastro de clientes (endereço e observações).

ALTER TABLE clientes ADD COLUMN cep TEXT;
ALTER TABLE clientes ADD COLUMN endereco TEXT;
ALTER TABLE clientes ADD COLUMN numero TEXT;
ALTER TABLE clientes ADD COLUMN complemento TEXT;
ALTER TABLE clientes ADD COLUMN estado TEXT;
ALTER TABLE clientes ADD COLUMN observacoes TEXT;
